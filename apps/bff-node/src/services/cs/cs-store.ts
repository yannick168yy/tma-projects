import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import type { Env } from '../../config/env.js'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { broadcastBadges } from '../sse-badges.js'
import { notifyCsHuman } from '../admin-notify.js'
import { consumeAgentName, fallbackAgentName, normalizeAgentName, reserveAgentName, type CsAgentName } from './cs-agents.js'

export type ConversationStatus = 'active' | 'escalated' | 'human_taken' | 'resolved' | 'closed'
export type MessageRole = 'user' | 'assistant' | 'admin'

const SESSION_IDLE_MINUTES = 10

export interface Conversation {
  id: number
  userId: string
  status: ConversationStatus
  assignedAdminId: number | null
  agentName: CsAgentName
  escalateReason: string | null
  escalatedAt: Date | null
  userLeftAt: Date | null
  userTicketReadMessageId: number
  badgeIgnored: boolean
  aiSummary: string | null
  aiSummaryModel: string | null
  aiSummaryMessageCount: number
  aiSummaryUpdatedAt: Date | null
  createdAt: Date
  updatedAt: Date
  resolvedAt: Date | null
}

export interface CsMessage {
  id: number
  conversationId: number
  role: MessageRole
  content: string
  createdAt: Date
}

export interface CsTicketItem {
  id: number
  status: ConversationStatus
  agentName: CsAgentName
  escalateReason: string | null
  lastMessage: string
  lastMessageRole: MessageRole | null
  unreadAdminMessages: number
  createdAt: Date
  updatedAt: Date
  resolvedAt: Date | null
}

function db(env: Env) {
  return getMysqlPool(env)
}

export async function getOrCreateConversation(env: Env, userId: string): Promise<Conversation> {
  const pool = db(env)
  await expireStaleConversations(env, userId)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM cs_conversation WHERE user_id = ? AND status IN ('active','escalated','human_taken') ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  )
  if (rows.length > 0) return rowToConversation(rows[0])

  const agentName = await reserveAgentName(env, userId)
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO cs_conversation (user_id, status, agent_name) VALUES (?, 'active', ?)`,
    [userId, agentName],
  )
  await consumeAgentName(env, userId)
  const [newRows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM cs_conversation WHERE id = ?`,
    [result.insertId],
  )
  return rowToConversation(newRows[0])
}

// 开场白用:有进行中的会话就沿用该会话的客服,否则占一个新人选(不建会话行)
export async function resolveAgentName(env: Env, userId: string): Promise<CsAgentName> {
  await expireStaleConversations(env, userId)
  const [rows] = await db(env).query<RowDataPacket[]>(
    `SELECT id, agent_name FROM cs_conversation WHERE user_id = ? AND status IN ('active','escalated','human_taken') ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  )
  if (rows.length > 0) return normalizeAgentName(rows[0].agent_name) ?? fallbackAgentName(Number(rows[0].id))
  return reserveAgentName(env, userId)
}

export async function expireStaleConversations(env: Env, userId?: string): Promise<number> {
  const params: unknown[] = userId ? [userId] : []
  const userClause = userId ? 'AND c.user_id = ?' : ''
  const [result] = await db(env).query<ResultSetHeader>(
    `UPDATE cs_conversation c
     SET c.status = 'closed', c.resolved_at = NOW()
     WHERE c.status = 'active'
       ${userClause}
       AND COALESCE(
         (SELECT MAX(m.created_at) FROM cs_message m WHERE m.conversation_id = c.id AND m.role = 'user'),
         c.created_at
       ) < DATE_SUB(NOW(), INTERVAL ${SESSION_IDLE_MINUTES} MINUTE)`,
    params,
  )
  if (result.affectedRows > 0) broadcastBadges(env).catch(() => {})
  return result.affectedRows
}

export async function getConversationById(env: Env, id: number): Promise<Conversation | null> {
  const [rows] = await db(env).query<RowDataPacket[]>(
    `SELECT * FROM cs_conversation WHERE id = ?`,
    [id],
  )
  return rows.length > 0 ? rowToConversation(rows[0]) : null
}

export async function listConversations(
  env: Env,
  opts: { status?: string; limit: number; offset: number; ticketOnly?: boolean },
): Promise<{ items: (Conversation & { displayName: string; lastMessage: string })[]; total: number }> {
  const pool = db(env)
  await expireStaleConversations(env)
  const pendingOnly = opts.status === 'pending'
  const conditions: string[] = []
  const filterParams: unknown[] = []
  if (pendingOnly) conditions.push(`c.status IN ('human_taken','escalated') AND c.badge_ignored = 0`)
  else if (opts.status) {
    conditions.push('c.status = ?')
    filterParams.push(opts.status)
  }
  if (opts.ticketOnly) conditions.push('c.escalated_at IS NOT NULL')
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const params: unknown[] = [...filterParams, opts.limit, opts.offset]

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.*, u.display_name,
       (SELECT content FROM cs_message WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message
     FROM cs_conversation c
     LEFT JOIN bg_user u ON u.id = c.user_id
     ${where}
     ORDER BY c.updated_at DESC
     LIMIT ? OFFSET ?`,
    params,
  )

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM cs_conversation c ${where}`,
    filterParams,
  )

  return {
    items: rows.map((r) => ({
      ...rowToConversation(r),
      displayName: r.display_name ?? '',
      lastMessage: r.last_message ?? '',
    })),
    total: Number(countRows[0].total),
  }
}

export async function listUserTickets(env: Env, userId: string): Promise<{ items: CsTicketItem[]; unreadCount: number }> {
  const [rows] = await db(env).query<RowDataPacket[]>(
    `SELECT c.*,
       (SELECT content FROM cs_message WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message,
       (SELECT role FROM cs_message WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_role,
       (SELECT COUNT(*) FROM cs_message m
        WHERE m.conversation_id = c.id AND m.role = 'admin' AND m.id > c.user_ticket_read_message_id) AS unread_admin_messages
     FROM cs_conversation c
     WHERE c.user_id = ? AND c.escalated_at IS NOT NULL
     ORDER BY c.updated_at DESC`,
    [userId],
  )
  const items = rows.map(rowToTicketItem)
  return {
    items,
    unreadCount: items.reduce((sum, item) => sum + item.unreadAdminMessages, 0),
  }
}

export async function getUserTicketById(env: Env, userId: string, id: number): Promise<Conversation | null> {
  const [rows] = await db(env).query<RowDataPacket[]>(
    `SELECT * FROM cs_conversation WHERE id = ? AND user_id = ? AND escalated_at IS NOT NULL`,
    [id, userId],
  )
  return rows.length > 0 ? rowToConversation(rows[0]) : null
}

export async function markUserTicketRead(env: Env, userId: string, id: number): Promise<void> {
  await db(env).query(
    `UPDATE cs_conversation c
     LEFT JOIN (
       SELECT conversation_id, MAX(id) AS max_id
       FROM cs_message
       WHERE conversation_id = ?
       GROUP BY conversation_id
     ) m ON m.conversation_id = c.id
     SET c.user_ticket_read_message_id = COALESCE(m.max_id, c.user_ticket_read_message_id)
     WHERE c.id = ? AND c.user_id = ? AND c.escalated_at IS NOT NULL`,
    [id, id, userId],
  )
}

export async function reopenTicketForUserMessage(env: Env, id: number): Promise<void> {
  const [result] = await db(env).query<ResultSetHeader>(
    `UPDATE cs_conversation
     SET status = CASE WHEN status = 'human_taken' THEN 'human_taken' ELSE 'escalated' END,
         resolved_at = NULL,
         badge_ignored = 0
     WHERE id = ? AND escalated_at IS NOT NULL AND (status IN ('active','resolved','closed') OR resolved_at IS NOT NULL OR badge_ignored = 1)`,
    [id],
  )
  if (result.affectedRows > 0) broadcastBadges(env).catch(() => {})
}

export async function ignoreTicketReminder(env: Env, id: number): Promise<boolean> {
  const [result] = await db(env).query<ResultSetHeader>(
    `UPDATE cs_conversation
     SET badge_ignored = 1
     WHERE id = ? AND escalated_at IS NOT NULL AND status IN ('escalated','human_taken')`,
    [id],
  )
  if (result.affectedRows > 0) broadcastBadges(env).catch(() => {})
  return result.affectedRows > 0
}

export async function markUserLeftConversation(env: Env, userId: string): Promise<void> {
  await db(env).query(
    `UPDATE cs_conversation SET user_left_at = NOW()
     WHERE user_id = ? AND status IN ('active','escalated','human_taken')
     ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  )
}

export async function closeCurrentConversation(env: Env, userId: string): Promise<Conversation | null> {
  await expireStaleConversations(env, userId)
  const [rows] = await db(env).query<RowDataPacket[]>(
    `SELECT * FROM cs_conversation WHERE user_id = ? AND status IN ('active','escalated','human_taken') ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  )
  if (rows.length === 0) return null
  if (rows[0].status === 'escalated') {
    await db(env).query(`UPDATE cs_conversation SET user_left_at = NOW() WHERE id = ?`, [Number(rows[0].id)])
    return getConversationById(env, Number(rows[0].id))
  }
  await updateConversationStatus(env, Number(rows[0].id), 'closed')
  const conversation = await getConversationById(env, Number(rows[0].id))
  return conversation
}

export async function updateConversationStatus(
  env: Env,
  id: number,
  status: ConversationStatus,
  adminId?: number,
): Promise<void> {
  const pool = db(env)
  if (status === 'resolved' || status === 'closed') {
    await pool.query(
      `UPDATE cs_conversation SET status = ?, resolved_at = NOW(), assigned_admin_id = COALESCE(?, assigned_admin_id) WHERE id = ?`,
      [status, adminId ?? null, id],
    )
  } else {
    await pool.query(
      `UPDATE cs_conversation SET status = ?, resolved_at = NULL, assigned_admin_id = COALESCE(?, assigned_admin_id) WHERE id = ?`,
      [status, adminId ?? null, id],
    )
  }
  broadcastBadges(env).catch(() => {})
}

// 转人工:记录原因与时间。人工在线→human_taken(AI 停答);离线→escalated(离线工单,AI 继续应答)
export async function escalateConversation(
  env: Env,
  id: number,
  reason: string,
  toStatus: 'escalated' | 'human_taken',
): Promise<void> {
  const pool = db(env)
  const [before] = await pool.query<RowDataPacket[]>(
    `SELECT status, user_id FROM cs_conversation WHERE id = ?`,
    [id],
  )
  const prevStatus = before[0]?.status as ConversationStatus | undefined
  await pool.query(
    `UPDATE cs_conversation SET status = ?, escalate_reason = ?, escalated_at = NOW() WHERE id = ?`,
    [toStatus, reason.slice(0, 64), id],
  )
  broadcastBadges(env).catch(() => {})
  // 仅在真正发生状态跃迁时告警(escalated 重复命中不刷屏)
  if (prevStatus !== toStatus) {
    notifyCsHuman(env, { conversationId: id, userId: before[0]?.user_id, reason, toStatus }).catch(() => {})
  }
}

export async function saveConversationSummary(
  env: Env,
  id: number,
  input: { summary: string; model: string; messageCount: number },
): Promise<void> {
  await db(env).query(
    `UPDATE cs_conversation
     SET ai_summary = ?, ai_summary_model = ?, ai_summary_message_count = ?, ai_summary_updated_at = NOW()
     WHERE id = ?`,
    [input.summary, input.model, input.messageCount, id],
  )
}

export async function getMessages(
  env: Env,
  conversationId: number,
  limit = 30,
): Promise<CsMessage[]> {
  const [rows] = await db(env).query<RowDataPacket[]>(
    `SELECT * FROM cs_message WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`,
    [conversationId, limit],
  )
  return rows.reverse().map(rowToMessage)
}

export async function saveMessage(
  env: Env,
  conversationId: number,
  role: MessageRole,
  content: string,
): Promise<CsMessage> {
  const [result] = await db(env).query<ResultSetHeader>(
    `INSERT INTO cs_message (conversation_id, role, content) VALUES (?, ?, ?)`,
    [conversationId, role, content],
  )
  // touch conversation updated_at
  await db(env).query(`UPDATE cs_conversation SET updated_at = NOW() WHERE id = ?`, [conversationId])
  return { id: result.insertId, conversationId, role, content, createdAt: new Date() }
}

export async function searchFaq(env: Env, keyword: string): Promise<{ question: string; answer: string; category: string }[]> {
  // 按空格拆词,任一词命中即返回;命中词数多的排前
  const words = keyword.trim().split(/\s+/).filter(Boolean).slice(0, 5)
  if (!words.length) return []
  const perWord = words.map(() => `(question LIKE ? OR answer LIKE ? OR category LIKE ?)`)
  const params = words.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`])
  const scoreExpr = perWord.map(() => `(question LIKE ? OR answer LIKE ? OR category LIKE ?)`).join(' + ')
  const [rows] = await db(env).query<RowDataPacket[]>(
    `SELECT category, question, answer, (${scoreExpr}) AS hits FROM cs_faq
     WHERE is_active = 1 AND (${perWord.join(' OR ')})
     ORDER BY hits DESC, sort_order LIMIT 5`,
    [...params, ...params],
  )
  return rows.map((r) => ({ category: r.category, question: r.question, answer: r.answer }))
}

function rowToConversation(r: RowDataPacket): Conversation {
  return {
    id: r.id,
    userId: String(r.user_id),
    status: r.status,
    assignedAdminId: r.assigned_admin_id ?? null,
    agentName: normalizeAgentName(r.agent_name) ?? fallbackAgentName(Number(r.id)),
    escalateReason: r.escalate_reason ?? null,
    escalatedAt: r.escalated_at ?? null,
    userLeftAt: r.user_left_at ?? null,
    userTicketReadMessageId: Number(r.user_ticket_read_message_id ?? 0),
    badgeIgnored: Boolean(r.badge_ignored),
    aiSummary: r.ai_summary ?? null,
    aiSummaryModel: r.ai_summary_model ?? null,
    aiSummaryMessageCount: Number(r.ai_summary_message_count ?? 0),
    aiSummaryUpdatedAt: r.ai_summary_updated_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at ?? null,
  }
}

function rowToMessage(r: RowDataPacket): CsMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  }
}

function rowToTicketItem(r: RowDataPacket): CsTicketItem {
  return {
    id: Number(r.id),
    status: r.status,
    agentName: normalizeAgentName(r.agent_name) ?? fallbackAgentName(Number(r.id)),
    escalateReason: r.escalate_reason ?? null,
    lastMessage: r.last_message ?? '',
    lastMessageRole: r.last_message_role ?? null,
    unreadAdminMessages: Number(r.unread_admin_messages ?? 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at ?? null,
  }
}
