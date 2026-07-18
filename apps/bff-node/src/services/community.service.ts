import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { getBettingActivity } from './betting-activity.service.js'
import { childLogger } from '../lib/logger.js'

// 社区营销自动发帖:后台配置规则 → 每分钟 tick 命中时段槽 → 模板轮换渲染 → AI 变体改写 → 分平台发送
// TG/Viber 直发;FB 落 pending 队列等人工确认(防硬广封主页)

const log = childLogger('community')

export type CmPlatform = 'telegram' | 'viber' | 'facebook'
export type CmCategory = 'promo' | 'winner' | 'hotgame' | 'sports' | 'checkin' | 'festival'
export type CmStrategy = 'sequential' | 'random'
export type CmPostStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export interface CmButton { text: string; url: string }

export interface CmChannel {
  id: number
  platform: CmPlatform
  name: string
  config: Record<string, string>
  dailyLimit: number
  enabled: boolean
}

export interface CmTemplate {
  id: number
  category: CmCategory
  title: string
  body: string
  imageUrl: string | null
  buttons: CmButton[] | null
  enabled: boolean
  sort: number
}

export interface CmRule {
  id: number
  name: string
  category: CmCategory
  channelIds: number[]
  slots: string[]
  strategy: CmStrategy
  aiRewrite: boolean
  cursor: number
  enabled: boolean
}

export interface CmPostLog {
  id: number
  ruleId: number | null
  channelId: number
  templateId: number | null
  content: string
  imageUrl: string | null
  buttons: CmButton[] | null
  status: CmPostStatus
  error: string | null
  sentAt: string | null
  createdAt: string
}

export const CM_CATEGORIES: CmCategory[] = ['promo', 'winner', 'hotgame', 'sports', 'checkin', 'festival']
export const CM_PLATFORMS: CmPlatform[] = ['telegram', 'viber', 'facebook']

// ── 行映射 ──────────────────────────────────────────────────────────────────

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback
  if (typeof v === 'object') return v as T
  try { return JSON.parse(String(v)) as T } catch { return fallback }
}

function toIso(v: unknown): string | null {
  if (!v) return null
  return v instanceof Date ? v.toISOString() : String(v)
}

function mapChannel(r: RowDataPacket): CmChannel {
  return {
    id: r.id, platform: r.platform, name: r.name,
    config: parseJson<Record<string, string>>(r.config, {}),
    dailyLimit: Number(r.daily_limit), enabled: Boolean(r.enabled),
  }
}

function mapTemplate(r: RowDataPacket): CmTemplate {
  return {
    id: r.id, category: r.category, title: r.title, body: r.body,
    imageUrl: r.image_url ?? null, buttons: parseJson<CmButton[] | null>(r.buttons, null),
    enabled: Boolean(r.enabled), sort: Number(r.sort),
  }
}

function mapRule(r: RowDataPacket): CmRule {
  return {
    id: r.id, name: r.name, category: r.category,
    channelIds: parseJson<number[]>(r.channel_ids, []),
    slots: parseJson<string[]>(r.slots, []),
    strategy: r.strategy, aiRewrite: Boolean(r.ai_rewrite),
    cursor: Number(r.cursor), enabled: Boolean(r.enabled),
  }
}

function mapPostLog(r: RowDataPacket): CmPostLog {
  return {
    id: Number(r.id), ruleId: r.rule_id ?? null, channelId: r.channel_id,
    templateId: r.template_id ?? null, content: r.content,
    imageUrl: r.image_url ?? null, buttons: parseJson<CmButton[] | null>(r.buttons, null),
    status: r.status, error: r.error ?? null,
    sentAt: toIso(r.sent_at), createdAt: toIso(r.created_at) ?? '',
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function listChannels(env: Env): Promise<CmChannel[]> {
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>('SELECT * FROM cm_channel ORDER BY id')
  return rows.map(mapChannel)
}

export async function saveChannel(env: Env, c: Omit<CmChannel, 'id'> & { id?: number }): Promise<number> {
  const db = getMysqlPool(env)
  if (c.id) {
    await db.query('UPDATE cm_channel SET platform=?, name=?, config=?, daily_limit=?, enabled=? WHERE id=?',
      [c.platform, c.name, JSON.stringify(c.config), c.dailyLimit, c.enabled ? 1 : 0, c.id])
    return c.id
  }
  const [r] = await db.query<ResultSetHeader>(
    'INSERT INTO cm_channel (platform, name, config, daily_limit, enabled) VALUES (?, ?, ?, ?, ?)',
    [c.platform, c.name, JSON.stringify(c.config), c.dailyLimit, c.enabled ? 1 : 0])
  return r.insertId
}

export async function deleteChannel(env: Env, id: number): Promise<void> {
  await getMysqlPool(env).query('DELETE FROM cm_channel WHERE id=?', [id])
}

export async function listTemplates(env: Env, category?: string): Promise<CmTemplate[]> {
  const db = getMysqlPool(env)
  const [rows] = category
    ? await db.query<RowDataPacket[]>('SELECT * FROM cm_template WHERE category=? ORDER BY sort, id', [category])
    : await db.query<RowDataPacket[]>('SELECT * FROM cm_template ORDER BY category, sort, id')
  return rows.map(mapTemplate)
}

export async function saveTemplate(env: Env, t: Omit<CmTemplate, 'id'> & { id?: number }): Promise<number> {
  const db = getMysqlPool(env)
  const buttons = t.buttons?.length ? JSON.stringify(t.buttons) : null
  if (t.id) {
    await db.query('UPDATE cm_template SET category=?, title=?, body=?, image_url=?, buttons=?, enabled=?, sort=? WHERE id=?',
      [t.category, t.title, t.body, t.imageUrl, buttons, t.enabled ? 1 : 0, t.sort, t.id])
    return t.id
  }
  const [r] = await db.query<ResultSetHeader>(
    'INSERT INTO cm_template (category, title, body, image_url, buttons, enabled, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [t.category, t.title, t.body, t.imageUrl, buttons, t.enabled ? 1 : 0, t.sort])
  return r.insertId
}

export async function deleteTemplate(env: Env, id: number): Promise<void> {
  await getMysqlPool(env).query('DELETE FROM cm_template WHERE id=?', [id])
}

export async function listRules(env: Env): Promise<CmRule[]> {
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>('SELECT * FROM cm_rule ORDER BY id')
  return rows.map(mapRule)
}

export async function saveRule(env: Env, r: Omit<CmRule, 'id' | 'cursor'> & { id?: number }): Promise<number> {
  const db = getMysqlPool(env)
  if (r.id) {
    await db.query('UPDATE cm_rule SET name=?, category=?, channel_ids=?, slots=?, strategy=?, ai_rewrite=?, enabled=? WHERE id=?',
      [r.name, r.category, JSON.stringify(r.channelIds), JSON.stringify(r.slots), r.strategy, r.aiRewrite ? 1 : 0, r.enabled ? 1 : 0, r.id])
    return r.id
  }
  const [res] = await db.query<ResultSetHeader>(
    'INSERT INTO cm_rule (name, category, channel_ids, slots, strategy, ai_rewrite, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [r.name, r.category, JSON.stringify(r.channelIds), JSON.stringify(r.slots), r.strategy, r.aiRewrite ? 1 : 0, r.enabled ? 1 : 0])
  return res.insertId
}

export async function deleteRule(env: Env, id: number): Promise<void> {
  await getMysqlPool(env).query('DELETE FROM cm_rule WHERE id=?', [id])
}

export async function listPostLogs(env: Env, params: { status?: string; limit?: number }): Promise<CmPostLog[]> {
  const db = getMysqlPool(env)
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500)
  const [rows] = params.status
    ? await db.query<RowDataPacket[]>('SELECT * FROM cm_post_log WHERE status=? ORDER BY id DESC LIMIT ?', [params.status, limit])
    : await db.query<RowDataPacket[]>('SELECT * FROM cm_post_log ORDER BY id DESC LIMIT ?', [limit])
  return rows.map(mapPostLog)
}

// ── 模板变量渲染 ─────────────────────────────────────────────────────────────

// 喜报玩家名池:菲律宾常见名,展示时脱敏(与站内榜单同为营销展示数据)
const PLAYER_NAMES = [
  'Joshua', 'Angelo', 'Christian', 'Marvin', 'Ronald', 'Jerome', 'Daniel', 'Michael',
  'Angelica', 'Marites', 'Jasmine', 'Kristine', 'Andrea', 'Camille', 'Nicole', 'Divine',
  'Jhon', 'Mark', 'Ryan', 'Kevin', 'Grace', 'Joy', 'Cristina', 'Rowena',
]

function maskName(name: string): string {
  if (name.length <= 3) return `${name[0]}**`
  return `${name[0]}***${name[name.length - 1]}`
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// 喜报金额:偏态分布,大多 ₱2k-20k,少数爆到 ₱80k,尾数去整更真实
function winnerAmount(): number {
  const r = Math.random()
  const base = r < 0.6 ? randInt(2000, 12000) : r < 0.9 ? randInt(12000, 35000) : randInt(35000, 80000)
  return base + randInt(0, 99) * 10 + randInt(0, 9)
}

function phtNow(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000)
}

export function renderTemplateVars(body: string): string {
  const week = getBettingActivity('week')
  const gameNames = week.length ? week.map((g) => g.name) : ['Fortune Gems', 'Super Ace', 'Boxing King']
  const pht = phtNow()
  const vars: Record<string, string> = {
    player: maskName(PLAYER_NAMES[randInt(0, PLAYER_NAMES.length - 1)]),
    amount: `₱${winnerAmount().toLocaleString('en-US')}`,
    game: gameNames[randInt(0, Math.min(gameNames.length, 10) - 1)],
    game1: gameNames[0] ?? '',
    game2: gameNames[1] ?? '',
    game3: gameNames[2] ?? '',
    date: pht.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }),
  }
  return body.replace(/\{(\w+)\}/g, (m, key: string) => vars[key] ?? m)
}

// ── AI 变体改写(Claude Haiku,raw fetch 不加依赖)────────────────────────────

const PLATFORM_TONE: Record<CmPlatform, string> = {
  telegram: 'Telegram channel post: punchy, emoji-friendly, direct promo tone with a clear call to action is fine.',
  viber: 'Viber channel post: similar to Telegram but slightly shorter and cleaner.',
  facebook: 'Facebook page post: SOFT tone only. Remove or soften hard gambling-promo wording (no "deposit bonus X%", no "guaranteed win"). Keep it as entertainment/community content that invites people to join the community.',
}

export async function aiRewrite(env: Env, content: string, platform: CmPlatform): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) return content
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: [
          'You rewrite social media posts for an online gaming community in the Philippines.',
          'Language: English mixed with light Taglish (casual Filipino-English), matching the original vibe.',
          'HARD RULES: keep every number, amount, game name, date, URL and hashtag EXACTLY as-is; never invent facts, prizes or promises; keep roughly the same length and line structure; output ONLY the rewritten post text with no preamble.',
          PLATFORM_TONE[platform],
        ].join('\n'),
        messages: [{ role: 'user', content: `Rewrite this post as a fresh variation:\n\n${content}` }],
      }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) {
      log.warn({ status: resp.status }, 'ai rewrite http error, fallback to original')
      return content
    }
    const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = data.content?.find((b) => b.type === 'text')?.text?.trim()
    return text || content
  } catch (err) {
    log.warn({ err }, 'ai rewrite failed, fallback to original')
    return content
  }
}

// ── 平台发送器 ───────────────────────────────────────────────────────────────

async function fetchJson(url: string, body: unknown, timeoutMs = 15_000): Promise<{ ok: boolean; detail: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await resp.text()
    return { ok: resp.ok, detail: text.slice(0, 400) }
  } finally {
    clearTimeout(timer)
  }
}

async function sendTelegram(env: Env, channel: CmChannel, content: string, imageUrl: string | null, buttons: CmButton[] | null): Promise<void> {
  const token = channel.config.botToken || env.TELEGRAM_BOT_TOKEN
  let chatId = channel.config.chatId?.trim()
  if (!chatId) throw new Error('渠道缺少 chatId 配置')
  // 频道用户名必须带 @,数字 ID 保持原样;漏 @ 是高频误填(Telegram 报 chat not found)
  if (!/^(@|-?\d+$)/.test(chatId)) chatId = `@${chatId}`
  const replyMarkup = buttons?.length ? { inline_keyboard: [buttons.map((b) => ({ text: b.text, url: b.url }))] } : undefined
  const r = imageUrl
    ? await fetchJson(`https://api.telegram.org/bot${token}/sendPhoto`,
        { chat_id: chatId, photo: imageUrl, caption: content, reply_markup: replyMarkup })
    : await fetchJson(`https://api.telegram.org/bot${token}/sendMessage`,
        { chat_id: chatId, text: content, reply_markup: replyMarkup, disable_web_page_preview: !buttons?.length })
  if (!r.ok) throw new Error(`Telegram API: ${r.detail}`)
}

// Viber 无 inline 按钮,链接追加到文末
function appendButtonLinks(content: string, buttons: CmButton[] | null): string {
  if (!buttons?.length) return content
  return `${content}\n\n${buttons.map((b) => `${b.text}: ${b.url}`).join('\n')}`
}

async function sendViber(channel: CmChannel, content: string, imageUrl: string | null, buttons: CmButton[] | null): Promise<void> {
  const { authToken, from } = channel.config
  if (!authToken || !from) throw new Error('渠道缺少 authToken/from 配置')
  const text = appendButtonLinks(content, buttons)
  const body = imageUrl
    ? { auth_token: authToken, from, type: 'picture', text, media: imageUrl }
    : { auth_token: authToken, from, type: 'text', text }
  const r = await fetchJson('https://chatapi.viber.com/pa/post', body)
  // Viber 返回 200 + body 内 status 非 0 也是失败
  if (!r.ok || !/"status"\s*:\s*0/.test(r.detail)) throw new Error(`Viber API: ${r.detail}`)
}

async function sendFacebook(channel: CmChannel, content: string, imageUrl: string | null, buttons: CmButton[] | null): Promise<void> {
  const { pageId, pageToken } = channel.config
  if (!pageId || !pageToken) throw new Error('渠道缺少 pageId/pageToken 配置,可先"标记已手动发布"')
  const text = appendButtonLinks(content, buttons)
  const r = imageUrl
    ? await fetchJson(`https://graph.facebook.com/v21.0/${pageId}/photos`, { url: imageUrl, caption: text, access_token: pageToken })
    : await fetchJson(`https://graph.facebook.com/v21.0/${pageId}/feed`, { message: text, access_token: pageToken })
  if (!r.ok) throw new Error(`Facebook API: ${r.detail}`)
}

async function dispatchSend(env: Env, channel: CmChannel, content: string, imageUrl: string | null, buttons: CmButton[] | null): Promise<void> {
  if (channel.platform === 'telegram') return sendTelegram(env, channel, content, imageUrl, buttons)
  if (channel.platform === 'viber') return sendViber(channel, content, imageUrl, buttons)
  return sendFacebook(channel, content, imageUrl, buttons)
}

// ── 发帖执行(写日志)──────────────────────────────────────────────────────────

async function insertLog(env: Env, p: {
  ruleId: number | null; channelId: number; templateId: number | null
  content: string; imageUrl: string | null; buttons: CmButton[] | null; status: CmPostStatus; error?: string | null
}): Promise<number> {
  const [r] = await getMysqlPool(env).query<ResultSetHeader>(
    `INSERT INTO cm_post_log (rule_id, channel_id, template_id, content, image_url, buttons, status, error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${p.status === 'sent' ? 'NOW()' : 'NULL'})`,
    [p.ruleId, p.channelId, p.templateId, p.content,
     p.imageUrl, p.buttons?.length ? JSON.stringify(p.buttons) : null, p.status, p.error ?? null])
  return r.insertId
}

// 今日(PHT)已发+待确认条数,判断日限频
async function countToday(env: Env, channelId: number): Promise<number> {
  const pht = phtNow()
  // PHT 当日 0 点对应的 UTC 时间
  const utcDayStart = new Date(Date.UTC(pht.getUTCFullYear(), pht.getUTCMonth(), pht.getUTCDate()) - 8 * 60 * 60 * 1000)
  const [rows] = await getMysqlPool(env).query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM cm_post_log WHERE channel_id=? AND status IN ('sent','pending') AND created_at >= ?`,
    [channelId, utcDayStart])
  return Number(rows[0]?.n ?? 0)
}

// 单渠道执行一次发帖:渲染后内容 → FB 落 pending,TG/Viber 直发
async function postToChannel(env: Env, channel: CmChannel, p: {
  ruleId: number | null; templateId: number | null; content: string
  imageUrl: string | null; buttons: CmButton[] | null
}): Promise<{ status: CmPostStatus; error?: string }> {
  if (channel.platform === 'facebook') {
    await insertLog(env, { ...p, channelId: channel.id, status: 'pending' })
    return { status: 'pending' }
  }
  try {
    await dispatchSend(env, channel, p.content, p.imageUrl, p.buttons)
    await insertLog(env, { ...p, channelId: channel.id, status: 'sent' })
    return { status: 'sent' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await insertLog(env, { ...p, channelId: channel.id, status: 'failed', error: msg })
    log.error({ channelId: channel.id, err: msg }, 'post send failed')
    return { status: 'failed', error: msg }
  }
}

// 后台"立即发送"(手动帖/测试),返回每渠道结果
export async function sendNow(env: Env, p: {
  channelIds: number[]; content: string; imageUrl: string | null; buttons: CmButton[] | null; aiRewrite: boolean
}): Promise<Array<{ channelId: number; status: CmPostStatus; error?: string }>> {
  const channels = (await listChannels(env)).filter((c) => p.channelIds.includes(c.id) && c.enabled)
  const results: Array<{ channelId: number; status: CmPostStatus; error?: string }> = []
  for (const ch of channels) {
    const content = p.aiRewrite ? await aiRewrite(env, p.content, ch.platform) : p.content
    const r = await postToChannel(env, ch, { ruleId: null, templateId: null, content, imageUrl: p.imageUrl, buttons: p.buttons })
    results.push({ channelId: ch.id, ...r })
  }
  return results
}

// FB pending 帖:批准(调 Graph API 直发)
export async function approvePost(env: Env, logId: number): Promise<void> {
  const db = getMysqlPool(env)
  const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM cm_post_log WHERE id=? AND status='pending'`, [logId])
  if (!rows.length) throw new Error('待确认帖不存在或已处理')
  const post = mapPostLog(rows[0])
  const channel = (await listChannels(env)).find((c) => c.id === post.channelId)
  if (!channel) throw new Error('渠道已删除')
  try {
    await dispatchSend(env, channel, post.content, post.imageUrl, post.buttons)
    await db.query(`UPDATE cm_post_log SET status='sent', sent_at=NOW(), error=NULL WHERE id=?`, [logId])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.query(`UPDATE cm_post_log SET error=? WHERE id=?`, [msg.slice(0, 500), logId])
    throw new Error(msg)
  }
}

// FB pending 帖:运营已复制文案手动发布,仅标记
export async function markManualPosted(env: Env, logId: number): Promise<void> {
  const [r] = await getMysqlPool(env).query<ResultSetHeader>(
    `UPDATE cm_post_log SET status='sent', sent_at=NOW(), error='manual' WHERE id=? AND status='pending'`, [logId])
  if (!r.affectedRows) throw new Error('待确认帖不存在或已处理')
}

export async function rejectPost(env: Env, logId: number): Promise<void> {
  const [r] = await getMysqlPool(env).query<ResultSetHeader>(
    `UPDATE cm_post_log SET status='skipped' WHERE id=? AND status='pending'`, [logId])
  if (!r.affectedRows) throw new Error('待确认帖不存在或已处理')
}

// ── 调度 tick(app.ts 每分钟调用)─────────────────────────────────────────────

// 规则命中槽位后执行:模板轮换 → 渲染变量 → 每渠道 AI 改写+发送
async function fireRule(env: Env, rule: CmRule, channels: CmChannel[]): Promise<void> {
  const pool = (await listTemplates(env, rule.category)).filter((t) => t.enabled)
  if (!pool.length) {
    log.warn({ ruleId: rule.id }, 'rule fired but template pool empty')
    return
  }
  const idx = rule.strategy === 'random' ? randInt(0, pool.length - 1) : rule.cursor % pool.length
  const tpl = pool[idx]
  if (rule.strategy === 'sequential') {
    await getMysqlPool(env).query('UPDATE cm_rule SET cursor=? WHERE id=?', [(rule.cursor + 1) % 1_000_000, rule.id])
  }
  const rendered = renderTemplateVars(tpl.body)
  for (const chId of rule.channelIds) {
    const ch = channels.find((c) => c.id === chId && c.enabled)
    if (!ch) continue
    if ((await countToday(env, ch.id)) >= ch.dailyLimit) {
      await insertLog(env, {
        ruleId: rule.id, channelId: ch.id, templateId: tpl.id, content: rendered,
        imageUrl: tpl.imageUrl, buttons: tpl.buttons, status: 'skipped', error: '已达渠道日限频',
      })
      continue
    }
    const content = rule.aiRewrite ? await aiRewrite(env, rendered, ch.platform) : rendered
    await postToChannel(env, ch, { ruleId: rule.id, templateId: tpl.id, content, imageUrl: tpl.imageUrl, buttons: tpl.buttons })
  }
}

export async function runCommunityTick(env: Env, redis: Redis): Promise<void> {
  if (!isMysqlEnabled(env)) return
  // 单实例锁:多副本部署时同一分钟只跑一个
  const gotLock = await redis.set('cm:tick:lock', '1', 'EX', 50, 'NX')
  if (!gotLock) return

  const pht = phtNow()
  const hhmm = `${String(pht.getUTCHours()).padStart(2, '0')}:${String(pht.getUTCMinutes()).padStart(2, '0')}`
  const dateKey = pht.toISOString().slice(0, 10)

  const rules = (await listRules(env)).filter((r) => r.enabled && r.slots.includes(hhmm))
  if (!rules.length) return
  const channels = await listChannels(env)

  for (const rule of rules) {
    // 同规则同槽位当天只发一次(进程重启/时钟抖动防重)
    const fired = await redis.set(`cm:fired:${rule.id}:${dateKey}:${hhmm}`, '1', 'EX', 26 * 60 * 60, 'NX')
    if (!fired) continue
    try {
      await fireRule(env, rule, channels)
      log.info({ ruleId: rule.id, slot: hhmm }, 'rule fired')
    } catch (err) {
      log.error({ ruleId: rule.id, err }, 'rule fire error')
    }
  }
}
