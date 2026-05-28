import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import type { Env } from '../../config/env.js'
import { getMysqlPool } from '../../clients/mysql.client.js'

export type ConversationStatus = 'active' | 'human_taken' | 'resolved' | 'closed'
export type MessageRole = 'user' | 'assistant' | 'admin'

export interface Conversation {
  id: number
  userId: number
  status: ConversationStatus
  assignedAdminId: number | null
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

function db(env: Env) {
  return getMysqlPool(env)
}

export async function getOrCreateConversation(env: Env, userId: number): Promise<Conversation> {
  const pool = db(env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM cs_conversation WHERE user_id = ? AND status IN ('active','human_taken') ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  )
  if (rows.length > 0) return rowToConversation(rows[0])

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO cs_conversation (user_id, status) VALUES (?, 'active')`,
    [userId],
  )
  const [newRows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM cs_conversation WHERE id = ?`,
    [result.insertId],
  )
  return rowToConversation(newRows[0])
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
  opts: { status?: string; limit: number; offset: number },
): Promise<{ items: (Conversation & { displayName: string; lastMessage: string })[]; total: number }> {
  const pool = db(env)
  const where = opts.status ? `WHERE c.status = ?` : ''
  const params: unknown[] = opts.status ? [opts.status, opts.limit, opts.offset] : [opts.limit, opts.offset]

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

  const countParams: unknown[] = opts.status ? [opts.status] : []
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM cs_conversation c ${where}`,
    countParams,
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
      `UPDATE cs_conversation SET status = ?, assigned_admin_id = COALESCE(?, assigned_admin_id) WHERE id = ?`,
      [status, adminId ?? null, id],
    )
  }
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
  const like = `%${keyword}%`
  const [rows] = await db(env).query<RowDataPacket[]>(
    `SELECT category, question, answer FROM cs_faq
     WHERE is_active = 1 AND (question LIKE ? OR answer LIKE ? OR category LIKE ?)
     ORDER BY sort_order LIMIT 5`,
    [like, like, like],
  )
  return rows as { question: string; answer: string; category: string }[]
}

function rowToConversation(r: RowDataPacket): Conversation {
  return {
    id: r.id,
    userId: r.user_id,
    status: r.status,
    assignedAdminId: r.assigned_admin_id ?? null,
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
