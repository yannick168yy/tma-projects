import Router from '@koa/router'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { ok, fail } from '../../utils/response.js'
import { getMysqlPool } from '../../clients/mysql.client.js'
import {
  listConversations,
  getConversationById,
  getMessages,
  saveMessage,
  updateConversationStatus,
  expireStaleConversations,
} from '../../services/cs/cs-store.js'
import { CS_WELCOME_SETTING_KEY, DEFAULT_WELCOME } from '../../services/cs/cs-intents.js'
import { CS_DUTY_SETTING_KEY, isHumanOnDuty, notifyTicketReplyViaTelegram } from '../../services/cs/cs-duty.js'
import { summarizeCsConversation } from '../../services/cs/cs-summary.js'
import { getSseBadgeClientCount } from '../../services/sse-badges.js'
import { getAdminSetting, setAdminSetting } from '../../services/admin-store.js'

const router = new Router()

// GET /admin/cs/duty — 值班状态(开关 + 在线管理员数 + 综合判定)
router.get('/cs/duty', async (ctx) => {
  const setting = await getAdminSetting(ctx.state.env, CS_DUTY_SETTING_KEY)
  ok(ctx, {
    enabled: setting !== '0',
    onlineAdmins: getSseBadgeClientCount(),
    onDuty: await isHumanOnDuty(ctx.state.env),
  })
})

// PUT /admin/cs/duty — 值班开关
router.put('/cs/duty', async (ctx) => {
  const { enabled } = ctx.request.body as { enabled?: boolean }
  if (typeof enabled !== 'boolean') {
    fail(ctx, 400, 'enabled 必须为布尔值')
    return
  }
  await setAdminSetting(ctx.state.env, CS_DUTY_SETTING_KEY, enabled ? '1' : '0')
  ok(ctx, { success: true })
})

// GET /admin/cs/welcome — 查看 AI 欢迎语配置
router.get('/cs/welcome', async (ctx) => {
  const configured = await getAdminSetting(ctx.state.env, CS_WELCOME_SETTING_KEY)
  ok(ctx, { welcome: configured ?? '', defaultWelcome: DEFAULT_WELCOME })
})

// PUT /admin/cs/welcome — 修改 AI 欢迎语（留空恢复默认）
router.put('/cs/welcome', async (ctx) => {
  const { welcome } = ctx.request.body as { welcome?: string }
  if (typeof welcome !== 'string' || welcome.length > 1000) {
    fail(ctx, 400, '欢迎语不合法（最长 1000 字符）')
    return
  }
  await setAdminSetting(ctx.state.env, CS_WELCOME_SETTING_KEY, welcome.trim())
  ok(ctx, { success: true })
})

// GET /admin/cs/conversations — 会话列表
router.get('/cs/conversations', async (ctx) => {
  const { status, page = '1', pageSize = '20' } = ctx.query as Record<string, string>
  const limit = Math.min(Number(pageSize), 1000)
  const offset = (Number(page) - 1) * limit
  const result = await listConversations(ctx.state.env, { status, limit, offset })
  ok(ctx, { ...result, page: Number(page), pageSize: limit })
})

// GET /admin/cs/conversations/:id — 单个会话详情 + 消息
router.get('/cs/conversations/:id', async (ctx) => {
  const id = Number(ctx.params.id)
  await expireStaleConversations(ctx.state.env)
  const conversation = await getConversationById(ctx.state.env, id)
  if (!conversation) {
    fail(ctx, 404, '会话不存在', 404)
    return
  }
  const messages = await getMessages(ctx.state.env, id, 100)
  ok(ctx, { conversation, messages })
})

// POST /admin/cs/conversations/:id/summary — 调 Gemini 总结用户与 AI 客服对话
router.post('/cs/conversations/:id/summary', async (ctx) => {
  const id = Number(ctx.params.id)
  const conversation = await getConversationById(ctx.state.env, id)
  if (!conversation) {
    fail(ctx, 404, '会话不存在', 404)
    return
  }
  const messages = await getMessages(ctx.state.env, id, 100)
  try {
    ok(ctx, await summarizeCsConversation(ctx.state.env, messages))
  } catch (e) {
    console.error('[admin-cs] summarize failed:', e)
    fail(ctx, 502, 'AI 总结失败，请稍后重试')
  }
})

// POST /admin/cs/conversations/:id/reply — 人工回复
router.post('/cs/conversations/:id/reply', async (ctx) => {
  const id = Number(ctx.params.id)
  const { message } = ctx.request.body as { message?: string }
  if (!message?.trim()) {
    fail(ctx, 400, '消息不能为空')
    return
  }
  await expireStaleConversations(ctx.state.env)
  const conversation = await getConversationById(ctx.state.env, id)
  if (!conversation) {
    fail(ctx, 404, '会话不存在', 404)
    return
  }
  if (conversation.status === 'resolved' || conversation.status === 'closed') {
    fail(ctx, 400, '会话已结束')
    return
  }
  // 自动标记为人工接管(active/escalated 均可)
  if (conversation.status === 'active' || conversation.status === 'escalated') {
    await updateConversationStatus(ctx.state.env, id, 'human_taken', ctx.state.adminId)
  }
  const msg = await saveMessage(ctx.state.env, id, 'admin', message.trim())
  // 用户多半已离开页面,通过 TG bot 触达(无 tgid 静默跳过)
  notifyTicketReplyViaTelegram(ctx.state.env, conversation.userId).catch(() => {})
  ok(ctx, msg)
})

// POST /admin/cs/conversations/:id/takeover — 接管会话
router.post('/cs/conversations/:id/takeover', async (ctx) => {
  const id = Number(ctx.params.id)
  await expireStaleConversations(ctx.state.env)
  const conversation = await getConversationById(ctx.state.env, id)
  if (!conversation) {
    fail(ctx, 404, '会话不存在', 404)
    return
  }
  if (conversation.status === 'resolved' || conversation.status === 'closed') {
    fail(ctx, 400, '会话已结束')
    return
  }
  await updateConversationStatus(ctx.state.env, id, 'human_taken', ctx.state.adminId)
  ok(ctx, { success: true })
})

// POST /admin/cs/conversations/:id/resolve — 结单
router.post('/cs/conversations/:id/resolve', async (ctx) => {
  const id = Number(ctx.params.id)
  await updateConversationStatus(ctx.state.env, id, 'resolved', ctx.state.adminId)
  ok(ctx, { success: true })
})

// POST /admin/cs/conversations/:id/close — 手动结束会话
router.post('/cs/conversations/:id/close', async (ctx) => {
  const id = Number(ctx.params.id)
  await updateConversationStatus(ctx.state.env, id, 'closed', ctx.state.adminId)
  ok(ctx, { success: true })
})

// ─── FAQ 知识库管理 ───────────────────────────────────────────────────────────

// GET /admin/cs/faq
router.get('/cs/faq', async (ctx) => {
  const { keyword, category, page = '1', pageSize = '20' } = ctx.query as Record<string, string>
  const pool = getMysqlPool(ctx.state.env)
  const limit = Math.min(Number(pageSize), 1000)
  const offset = (Number(page) - 1) * limit

  const conditions: string[] = []
  const params: unknown[] = []

  if (keyword) {
    conditions.push('(question LIKE ? OR answer LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`)
  }
  if (category) {
    conditions.push('category = ?')
    params.push(category)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, category, question, answer, lang, sort_order, is_active, created_at, updated_at
     FROM cs_faq ${where} ORDER BY category, sort_order, id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM cs_faq ${where}`,
    params,
  )
  ok(ctx, { items: rows, total: Number(countRows[0].total), page: Number(page), pageSize: limit })
})

// POST /admin/cs/faq
router.post('/cs/faq', async (ctx) => {
  const { category, question, answer, lang = 'zh', sort_order = 0 } = ctx.request.body as Record<string, unknown>
  if (!category || !question || !answer) {
    fail(ctx, 400, '分类、问题、答案不能为空'); return
  }
  const pool = getMysqlPool(ctx.state.env)
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO cs_faq (category, question, answer, lang, sort_order) VALUES (?, ?, ?, ?, ?)`,
    [category, question, answer, lang, Number(sort_order)],
  )
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM cs_faq WHERE id = ?`, [result.insertId])
  ok(ctx, rows[0])
})

// PATCH /admin/cs/faq/:id
router.patch('/cs/faq/:id', async (ctx) => {
  const id = Number(ctx.params.id)
  const body = ctx.request.body as Record<string, unknown>
  const pool = getMysqlPool(ctx.state.env)

  const fields: string[] = []
  const vals: unknown[] = []
  for (const key of ['category', 'question', 'answer', 'lang', 'sort_order', 'is_active']) {
    if (key in body) {
      fields.push(`${key} = ?`)
      vals.push(key === 'sort_order' ? Number(body[key]) : key === 'is_active' ? Number(body[key]) : body[key])
    }
  }
  if (!fields.length) { fail(ctx, 400, '无可更新字段'); return }
  vals.push(id)
  await pool.query(`UPDATE cs_faq SET ${fields.join(', ')} WHERE id = ?`, vals)
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM cs_faq WHERE id = ?`, [id])
  if (!rows.length) { fail(ctx, 404, 'FAQ 不存在', 404); return }
  ok(ctx, rows[0])
})

// DELETE /admin/cs/faq/:id
router.delete('/cs/faq/:id', async (ctx) => {
  const id = Number(ctx.params.id)
  const pool = getMysqlPool(ctx.state.env)
  const [result] = await pool.query<ResultSetHeader>(`DELETE FROM cs_faq WHERE id = ?`, [id])
  if (result.affectedRows === 0) { fail(ctx, 404, 'FAQ 不存在', 404); return }
  ok(ctx, { success: true })
})

export default router
