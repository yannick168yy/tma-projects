import { randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getStorageProvider } from './storage/index.js'
import { parseImageDataUrl } from './home-content.service.js'
import { childLogger } from '../lib/logger.js'

// TG 群发:bot 私聊向全体 TG 用户推送运营消息(仿 TonPlay 图+文案+内联按钮)。
// 受众 = bg_user_identity 里 telegram / telegram_oidc(OIDC sub 即数字 tg id)去重;
// 后台创建任务 → 测试发送 → 开始群发,tick 按 cursor 断点续发,重启不丢进度。

const log = childLogger('broadcast')

export type TbStatus = 'draft' | 'sending' | 'done' | 'canceled'
export type TbButtonKind = 'url' | 'webapp'

export interface TbButton { text: string; kind: TbButtonKind; url: string }

export interface TgBroadcast {
  id: number
  title: string
  content: string
  imageKey: string | null
  imageUrl: string | null
  buttons: TbButton[] | null
  status: TbStatus
  total: number
  sentCount: number
  failedCount: number
  blockedCount: number
  createdBy: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface TbFail {
  id: number
  tgId: string
  userId: string | null
  blocked: boolean
  error: string | null
  createdAt: string
}

// 与 home-content 图片同一 serve 路由(/api/v1/home/images/…,key 必须 home/ 前缀)
function imageUrl(key: string | null): string | null {
  if (!key) return null
  return `/api/v1/home/images/${key.split('/').map(encodeURIComponent).join('/')}`
}

function toIso(v: unknown): string | null {
  if (!v) return null
  return v instanceof Date ? v.toISOString() : String(v)
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback
  if (typeof v === 'object') return v as T
  try { return JSON.parse(String(v)) as T } catch { return fallback }
}

function mapBroadcast(r: RowDataPacket): TgBroadcast {
  return {
    id: r.id, title: r.title, content: r.content,
    imageKey: r.image_key ?? null, imageUrl: imageUrl(r.image_key ?? null),
    buttons: parseJson<TbButton[] | null>(r.buttons, null),
    status: r.status, total: Number(r.total),
    sentCount: Number(r.sent_count), failedCount: Number(r.failed_count), blockedCount: Number(r.blocked_count),
    createdBy: r.created_by ?? null,
    startedAt: toIso(r.started_at), finishedAt: toIso(r.finished_at), createdAt: toIso(r.created_at) ?? '',
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function listBroadcasts(env: Env): Promise<TgBroadcast[]> {
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>('SELECT * FROM tg_broadcast ORDER BY id DESC LIMIT 100')
  return rows.map(mapBroadcast)
}

export async function getBroadcast(env: Env, id: number): Promise<TgBroadcast | null> {
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>('SELECT * FROM tg_broadcast WHERE id=?', [id])
  return rows.length ? mapBroadcast(rows[0]) : null
}

export async function saveBroadcast(env: Env, b: {
  id?: number; title: string; content: string; imageKey: string | null; buttons: TbButton[] | null; createdBy?: string
}): Promise<number> {
  const db = getMysqlPool(env)
  const buttons = b.buttons?.length ? JSON.stringify(b.buttons) : null
  if (b.id) {
    // 只允许改草稿;换图后旧 file_id 作废一并清掉
    const [r] = await db.query<ResultSetHeader>(
      `UPDATE tg_broadcast SET title=?, content=?, image_key=?, buttons=?, tg_file_id=NULL WHERE id=? AND status='draft'`,
      [b.title, b.content, b.imageKey, buttons, b.id])
    if (!r.affectedRows) throw new Error('任务不存在或已开始发送,不能修改')
    return b.id
  }
  const [r] = await db.query<ResultSetHeader>(
    'INSERT INTO tg_broadcast (title, content, image_key, buttons, created_by) VALUES (?, ?, ?, ?, ?)',
    [b.title, b.content, b.imageKey, buttons, b.createdBy ?? null])
  return r.insertId
}

export async function deleteBroadcast(env: Env, id: number): Promise<void> {
  const [r] = await getMysqlPool(env).query<ResultSetHeader>(
    `DELETE FROM tg_broadcast WHERE id=? AND status IN ('draft','done','canceled')`, [id])
  if (!r.affectedRows) throw new Error('任务不存在或正在发送中')
}

export async function listFails(env: Env, broadcastId: number, limit = 200): Promise<TbFail[]> {
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    'SELECT * FROM tg_broadcast_fail WHERE broadcast_id=? ORDER BY id LIMIT ?', [broadcastId, Math.min(limit, 1000)])
  return rows.map((r) => ({
    id: Number(r.id), tgId: r.tg_id, userId: r.user_id ?? null,
    blocked: Boolean(r.blocked), error: r.error ?? null, createdAt: toIso(r.created_at) ?? '',
  }))
}

// ── 受众 ─────────────────────────────────────────────────────────────────────

// telegram_oidc 的 sub 即数字 tg 用户 id;两 provider 同一人会各有一行,按 identifier 去重,
// cursor 取每个 identifier 的最小行 id,断点续发时天然不重不漏
const AUDIENCE_WHERE = `provider IN ('telegram','telegram_oidc') AND identifier REGEXP '^[0-9]+$'`

export async function audienceCount(env: Env): Promise<number> {
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT identifier) AS n FROM bg_user_identity WHERE ${AUDIENCE_WHERE}`)
  return Number(rows[0]?.n ?? 0)
}

async function nextAudienceBatch(env: Env, cursorId: number, size: number): Promise<Array<{ rowId: number; tgId: string; userId: string }>> {
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    `SELECT identifier, MIN(id) AS row_id, MIN(user_id) AS user_id
     FROM bg_user_identity WHERE ${AUDIENCE_WHERE}
     GROUP BY identifier HAVING row_id > ? ORDER BY row_id LIMIT ?`,
    [cursorId, size])
  return rows.map((r) => ({ rowId: Number(r.row_id), tgId: String(r.identifier), userId: String(r.user_id) }))
}

// ── 图片 ─────────────────────────────────────────────────────────────────────

export async function storeBroadcastImage(env: Env, dataUrl: string): Promise<{ imageKey: string; imageUrl: string }> {
  const parsed = parseImageDataUrl(dataUrl)
  if (!parsed) throw new Error('只支持 PNG、JPG、WEBP 图片')
  if (parsed.data.length > 5 * 1024 * 1024) throw new Error('图片不能超过 5MB')
  const key = `home/broadcast/${Date.now()}-${randomUUID()}.${parsed.ext}`
  const imageKey = await getStorageProvider(env).put(key, parsed.data, parsed.mimeType)
  return { imageKey, imageUrl: imageUrl(imageKey)! }
}

// ── Telegram 发送 ────────────────────────────────────────────────────────────

interface TgApiResult { ok: boolean; status: number; description: string; retryAfter: number; fileId: string | null }

async function tgApi(token: string, method: string, body: FormData | Record<string, unknown>, timeoutMs = 20_000): Promise<TgApiResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const isForm = body instanceof FormData
    const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
      signal: ctrl.signal,
    })
    const data = (await resp.json().catch(() => ({}))) as {
      ok?: boolean; description?: string
      parameters?: { retry_after?: number }
      result?: { photo?: Array<{ file_id: string }> }
    }
    // sendPhoto 返回多尺寸,最后一个是原始大图
    const photos = data.result?.photo
    return {
      ok: data.ok === true,
      status: resp.status,
      description: data.description ?? `HTTP ${resp.status}`,
      retryAfter: Number(data.parameters?.retry_after ?? 0),
      fileId: photos?.length ? photos[photos.length - 1].file_id : null,
    }
  } finally {
    clearTimeout(timer)
  }
}

function replyMarkup(buttons: TbButton[] | null): Record<string, unknown> | undefined {
  if (!buttons?.length) return undefined
  // 每按钮独占一行(TonPlay 版式);webapp 按钮在 TG 内直接打开 Mini App
  return {
    inline_keyboard: buttons.map((b) => [
      b.kind === 'webapp' ? { text: b.text, web_app: { url: b.url } } : { text: b.text, url: b.url },
    ]),
  }
}

// 单人发送。图片首次从本地存储 multipart 直传(不依赖公网可达 URL),拿到 file_id 后复用
async function sendOne(env: Env, p: {
  chatId: string; content: string; imageKey: string | null; fileId: string | null; buttons: TbButton[] | null
}): Promise<TgApiResult> {
  const token = env.TELEGRAM_BOT_TOKEN
  const markup = replyMarkup(p.buttons)
  if (!p.imageKey) {
    return tgApi(token, 'sendMessage', {
      chat_id: p.chatId, text: p.content, parse_mode: 'HTML',
      reply_markup: markup, disable_web_page_preview: true,
    })
  }
  if (p.fileId) {
    return tgApi(token, 'sendPhoto', {
      chat_id: p.chatId, photo: p.fileId, caption: p.content, parse_mode: 'HTML', reply_markup: markup,
    })
  }
  const file = await getStorageProvider(env).get(p.imageKey)
  if (!file) throw new Error(`图片文件不存在: ${p.imageKey}`)
  const form = new FormData()
  form.set('chat_id', p.chatId)
  form.set('caption', p.content)
  form.set('parse_mode', 'HTML')
  if (markup) form.set('reply_markup', JSON.stringify(markup))
  form.set('photo', new Blob([new Uint8Array(file.data)], { type: file.mimeType }), p.imageKey.split('/').pop() ?? 'photo.jpg')
  return tgApi(token, 'sendPhoto', form, 60_000)
}

// 拉黑/从未 start/账号注销:属于正常流失,计 blocked 不算故障
function isBlockedError(r: TgApiResult): boolean {
  return r.status === 403 || /chat not found|user is deactivated|bot was blocked/i.test(r.description)
}

// 后台"测试发送":发给指定 tg id,顺手把首次上传得到的 file_id 存回任务
export async function testSend(env: Env, broadcastId: number, tgId: string): Promise<void> {
  const b = await getBroadcast(env, broadcastId)
  if (!b) throw new Error('任务不存在')
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>('SELECT tg_file_id FROM tg_broadcast WHERE id=?', [broadcastId])
  const fileId: string | null = rows[0]?.tg_file_id ?? null
  const r = await sendOne(env, { chatId: tgId, content: b.content, imageKey: b.imageKey, fileId, buttons: b.buttons })
  if (!r.ok) throw new Error(`Telegram: ${r.description}`)
  if (!fileId && r.fileId) {
    await getMysqlPool(env).query('UPDATE tg_broadcast SET tg_file_id=? WHERE id=?', [r.fileId, broadcastId])
  }
}

// ── 群发执行 ─────────────────────────────────────────────────────────────────

export async function startBroadcast(env: Env, id: number): Promise<{ total: number }> {
  const total = await audienceCount(env)
  if (!total) throw new Error('没有可发送的 TG 用户')
  const [r] = await getMysqlPool(env).query<ResultSetHeader>(
    `UPDATE tg_broadcast SET status='sending', total=?, started_at=NOW() WHERE id=? AND status='draft'`,
    [total, id])
  if (!r.affectedRows) throw new Error('任务不存在或已开始发送')
  return { total }
}

export async function cancelBroadcast(env: Env, id: number): Promise<void> {
  const [r] = await getMysqlPool(env).query<ResultSetHeader>(
    `UPDATE tg_broadcast SET status='canceled', finished_at=NOW() WHERE id=? AND status='sending'`, [id])
  if (!r.affectedRows) throw new Error('任务不存在或不在发送中')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const LOCK_KEY = 'tgb:tick:lock'
const BATCH_SIZE = 50
// 40ms/条 ≈ 25条/s,留出官方 30条/s 限额的余量
const SEND_GAP_MS = 40

async function insertFail(env: Env, broadcastId: number, tgId: string, userId: string, blocked: boolean, error: string): Promise<void> {
  await getMysqlPool(env).query(
    'INSERT INTO tg_broadcast_fail (broadcast_id, tg_id, user_id, blocked, error) VALUES (?, ?, ?, ?, ?)',
    [broadcastId, tgId, userId, blocked ? 1 : 0, error.slice(0, 500)])
}

// 处理一个 sending 任务直到发完/取消。每批 50 人落一次进度,重启后从 cursor 续发
async function runBroadcast(env: Env, redis: Redis, id: number): Promise<void> {
  const db = getMysqlPool(env)
  for (;;) {
    // 每批开头重读状态:后台可能已点取消
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM tg_broadcast WHERE id=?', [id])
    if (!rows.length || rows[0].status !== 'sending') return
    const task = rows[0]
    let fileId: string | null = task.tg_file_id ?? null
    const buttons = parseJson<TbButton[] | null>(task.buttons, null)

    const batch = await nextAudienceBatch(env, Number(task.cursor_id), BATCH_SIZE)
    if (!batch.length) {
      await db.query(`UPDATE tg_broadcast SET status='done', finished_at=NOW() WHERE id=? AND status='sending'`, [id])
      log.info({ id, sent: Number(task.sent_count) }, 'broadcast done')
      return
    }

    let sent = 0; let failed = 0; let blocked = 0
    for (const u of batch) {
      try {
        let r = await sendOne(env, { chatId: u.tgId, content: task.content, imageKey: task.image_key ?? null, fileId, buttons })
        if (!r.ok && r.status === 429) {
          await sleep(Math.max(r.retryAfter, 1) * 1000)
          r = await sendOne(env, { chatId: u.tgId, content: task.content, imageKey: task.image_key ?? null, fileId, buttons })
        }
        if (r.ok) {
          sent++
          if (!fileId && r.fileId) {
            fileId = r.fileId
            await db.query('UPDATE tg_broadcast SET tg_file_id=? WHERE id=?', [fileId, id])
          }
        } else if (isBlockedError(r)) {
          blocked++
          await insertFail(env, id, u.tgId, u.userId, true, r.description)
        } else {
          failed++
          await insertFail(env, id, u.tgId, u.userId, false, r.description)
        }
      } catch (err) {
        failed++
        await insertFail(env, id, u.tgId, u.userId, false, err instanceof Error ? err.message : String(err))
      }
      await sleep(SEND_GAP_MS)
    }

    await db.query(
      'UPDATE tg_broadcast SET cursor_id=?, sent_count=sent_count+?, failed_count=failed_count+?, blocked_count=blocked_count+? WHERE id=?',
      [batch[batch.length - 1].rowId, sent, failed, blocked, id])
    // 整轮可能长跑数分钟,批间续锁防止另一实例/下一 tick 抢入
    await redis.expire(LOCK_KEY, 120)
  }
}

export async function runBroadcastTick(env: Env, redis: Redis): Promise<void> {
  if (!isMysqlEnabled(env)) return
  const gotLock = await redis.set(LOCK_KEY, '1', 'EX', 120, 'NX')
  if (!gotLock) return
  try {
    const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
      `SELECT id FROM tg_broadcast WHERE status='sending' ORDER BY id LIMIT 1`)
    if (rows.length) await runBroadcast(env, redis, Number(rows[0].id))
  } finally {
    await redis.del(LOCK_KEY).catch(() => {})
  }
}
