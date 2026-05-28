import { SchemaType, type Tool } from '@google/generative-ai'
import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../../config/env.js'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { searchFaq, updateConversationStatus } from './cs-store.js'

export const GEMINI_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'get_user_info',
        description: "Get the current user's account information: display name, status, KYC status, registration date.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: 'get_wallet_balance',
        description: "Get the current user's wallet balance (available and frozen amounts in PHP pesos).",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: 'get_recent_orders',
        description: "Get the user's recent deposit and withdrawal orders (last 5 of each).",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: 'search_faq',
        description: 'Search the FAQ knowledge base for answers to common questions.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            keyword: {
              type: SchemaType.STRING,
              description: 'Search keyword, e.g. "deposit", "withdrawal", "KYC", "bonus"',
            },
          },
          required: ['keyword'],
        },
      },
      {
        name: 'escalate_to_human',
        description:
          'Escalate the conversation to a human agent. Use when the user requests a human, the dispute is large (>₱5000), or you cannot resolve after 2 attempts.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            reason: { type: SchemaType.STRING, description: 'Brief reason for escalation' },
          },
          required: ['reason'],
        },
      },
    ],
  },
]

export type ToolInput = Record<string, unknown>

export async function executeTool(
  env: Env,
  toolName: string,
  input: ToolInput,
  context: { userId: string; conversationId: number },
): Promise<unknown> {
  const pool = getMysqlPool(env)

  switch (toolName) {
    case 'get_user_info': {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT u.display_name, u.status, u.locale, u.registered_at,
                k.status AS kyc_status
         FROM bg_user u
         LEFT JOIN bg_kyc_submission k ON k.user_id = u.id
         WHERE u.id = ?
         ORDER BY k.submitted_at DESC LIMIT 1`,
        [context.userId],
      )
      if (!rows.length) return { error: 'User not found' }
      const r = rows[0]
      return {
        displayName: r.display_name,
        status: r.status,
        locale: r.locale,
        kycStatus: r.kyc_status ?? 'not_submitted',
        registeredAt: r.registered_at,
      }
    }

    case 'get_wallet_balance': {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT available_cents, frozen_cents FROM bg_wallet WHERE user_id = ?`,
        [context.userId],
      )
      if (!rows.length) return { availablePHP: '0.00', frozenPHP: '0.00' }
      return {
        availablePHP: (rows[0].available_cents / 100).toFixed(2),
        frozenPHP: (rows[0].frozen_cents / 100).toFixed(2),
      }
    }

    case 'get_recent_orders': {
      const [deposits] = await pool.query<RowDataPacket[]>(
        `SELECT order_id, amount, currency, credited_cents, channel_id, status, created_at, paid_at
         FROM bg_order_deposit WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
        [context.userId],
      )
      const [withdrawals] = await pool.query<RowDataPacket[]>(
        `SELECT order_id, amount_cents, currency, channel_id, status, created_at, completed_at, reject_reason
         FROM bg_order_withdraw WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
        [context.userId],
      )
      return {
        deposits: deposits.map((d) => ({
          orderId: d.order_id,
          amount: d.amount,
          currency: d.currency,
          creditedPHP: d.credited_cents ? (d.credited_cents / 100).toFixed(2) : null,
          channel: d.channel_id,
          status: d.status,
          createdAt: d.created_at,
          paidAt: d.paid_at,
        })),
        withdrawals: withdrawals.map((w) => ({
          orderId: w.order_id,
          amountPHP: (w.amount_cents / 100).toFixed(2),
          currency: w.currency,
          channel: w.channel_id,
          status: w.status,
          createdAt: w.created_at,
          completedAt: w.completed_at,
          rejectReason: w.reject_reason,
        })),
      }
    }

    case 'search_faq': {
      const keyword = String(input.keyword ?? '')
      const results = await searchFaq(env, keyword)
      return { found: results.length > 0, results }
    }

    case 'escalate_to_human': {
      await updateConversationStatus(env, context.conversationId, 'human_taken')
      return { success: true, message: 'Escalated to human agent.' }
    }

    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}
