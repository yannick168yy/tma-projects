import { SchemaType, type Tool } from '@google/generative-ai'
import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../../config/env.js'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { searchFaq, escalateConversation } from './cs-store.js'
import { getTurnoverProgress } from '../turnover.service.js'
import { isHumanOnDuty } from './cs-duty.js'

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
        name: 'get_turnover_status',
        description:
          "Get the user's wagering (turnover) requirement progress: whether they can withdraw, remaining amount to wager, and each pending requirement. Use whenever a user asks why they cannot withdraw.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: 'get_active_promotions',
        description: 'Get the currently active promotions with their live configuration (first deposit bonus, referral, lucky spin, cashback levels).',
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: 'search_games',
        description: 'Search the game library by game name or provider name. Returns matching games with provider, category, and availability/maintenance status.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            keyword: {
              type: SchemaType.STRING,
              description: 'Game name or provider name to search, e.g. "Super Ace", "JILI"',
            },
          },
          required: ['keyword'],
        },
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
          'Escalate the conversation to a human agent. The result tells you whether an agent is online now or the issue was recorded as an offline ticket — relay that honestly to the user.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            reason: {
              type: SchemaType.STRING,
              description:
                'Escalation category. One of: user_request (user asked for a human), money_dispute (payment made but not credited / withdrawal dispute), account_security (ban, freeze, suspected theft), complaint (complaint, refund demand, legal threat), unresolved (could not resolve after 2 attempts), other',
            },
          },
          required: ['reason'],
        },
      },
    ],
  },
]

export type ToolInput = Record<string, unknown>

const GUEST_RESTRICTED_TOOLS = new Set(['get_user_info', 'get_wallet_balance', 'get_recent_orders', 'get_turnover_status'])

export async function executeTool(
  env: Env,
  toolName: string,
  input: ToolInput,
  context: { userId: string; conversationId: number },
): Promise<unknown> {
  if (context.userId.startsWith('guest:') && GUEST_RESTRICTED_TOOLS.has(toolName)) {
    return { error: 'Please log in to access your account information.' }
  }

  const pool = getMysqlPool(env)

  switch (toolName) {
    case 'get_user_info': {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT u.display_name, u.status, u.locale, u.registered_at,
                k.status AS kyc_status, k.phone_verified, k.reject_reason, k.reject_step
         FROM bg_user u
         LEFT JOIN bg_kyc k ON k.user_id = u.id
         WHERE u.id = ?`,
        [context.userId],
      )
      if (!rows.length) return { error: 'User not found' }
      const r = rows[0]
      return {
        displayName: r.display_name,
        status: r.status,
        locale: r.locale,
        kycStatus: r.kyc_status ?? 'none',
        kycPhoneVerified: r.phone_verified === 1,
        kycRejectReason: r.reject_reason ?? null,
        kycRejectStep: r.reject_step ?? null,
        registeredAt: r.registered_at,
      }
    }

    case 'get_wallet_balance': {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT available, frozen FROM bg_wallet WHERE user_id = ?`,
        [context.userId],
      )
      if (!rows.length) return { availablePHP: '0.00', frozenPHP: '0.00' }
      return {
        availablePHP: Number(rows[0].available).toFixed(2),
        frozenPHP: Number(rows[0].frozen).toFixed(2),
      }
    }

    case 'get_recent_orders': {
      const [deposits] = await pool.query<RowDataPacket[]>(
        `SELECT order_id, amount, currency, credited, channel, status, created_at
         FROM bg_deposit_order WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
        [context.userId],
      )
      const [withdrawals] = await pool.query<RowDataPacket[]>(
        `SELECT order_id, amount, currency, channel, status, created_at, completed_at, reject_reason
         FROM bg_withdraw_order WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
        [context.userId],
      )
      return {
        deposits: deposits.map((d) => ({
          orderId: d.order_id,
          amount: d.amount,
          currency: d.currency,
          credited: d.credited ? 1 : 0,
          channel: d.channel,
          status: d.status,
          createdAt: d.created_at,
        })),
        withdrawals: withdrawals.map((w) => ({
          orderId: w.order_id,
          amountPHP: Number(w.amount).toFixed(2),
          currency: w.currency,
          channel: w.channel,
          status: w.status,
          createdAt: w.created_at,
          completedAt: w.completed_at,
          rejectReason: w.reject_reason,
        })),
      }
    }

    case 'get_turnover_status': {
      const progress = await getTurnoverProgress(pool, context.userId)
      return {
        canWithdraw: progress.canWithdraw,
        totalRemainingToWager: progress.totalRemaining.toFixed(2),
        pendingRequirements: progress.requirements
          .filter((r) => r.status === 'pending')
          .map((r) => ({
            source: r.sourceType,
            currency: r.currency,
            required: r.requiredAmount.toFixed(2),
            completed: r.completedAmount.toFixed(2),
            expiresAt: r.expiresAt,
          })),
      }
    }

    case 'get_active_promotions': {
      const [promoRows] = await pool.query<RowDataPacket[]>(
        `SELECT promo_id, config_key, config_value FROM bg_promo_config`,
      )
      const promo: Record<string, Record<string, string>> = {}
      for (const r of promoRows) {
        const id = String(r.promo_id)
        promo[id] = promo[id] ?? {}
        promo[id][String(r.config_key)] = String(r.config_value)
      }
      const [spinRows] = await pool.query<RowDataPacket[]>(`SELECT enabled FROM bg_spin_config LIMIT 1`)
      const [levelRows] = await pool.query<RowDataPacket[]>(
        `SELECT level, min_turnover FROM bg_rebate_level_threshold ORDER BY level`,
      )
      return {
        firstDepositBonus:
          promo.firstdep?.enabled === '1'
            ? {
                matchPercent: promo.firstdep.match_pct,
                maxBonusPHP: promo.firstdep.max_bonus,
                minDepositPHP: promo.firstdep.min_deposit,
                wageringMultiplier: promo.firstdep.turnover_x,
              }
            : null,
        referral:
          promo.referral?.enabled === '1'
            ? { inviterRewardPHP: promo.referral.inviter_amount, inviteeRewardPHP: promo.referral.invitee_amount }
            : null,
        luckySpin: spinRows[0]?.enabled === 1,
        cashbackLevels: levelRows.map((l) => ({ level: Number(l.level), minTotalWageringPHP: Number(l.min_turnover) })),
      }
    }

    case 'search_games': {
      const keyword = String(input.keyword ?? '').trim()
      if (!keyword) return { error: 'keyword is required' }
      const like = `%${keyword}%`
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT COALESCE(o.name_override, g.name_en) AS name, g.provider,
                COALESCE(o.site_category, g.site_category_auto) AS category,
                g.is_enabled, g.is_maintain
         FROM bg_568win_game g
         LEFT JOIN bg_568win_game_override o USING (game_provider_id, game_id)
         WHERE COALESCE(o.name_override, g.name_en) LIKE ? OR g.provider LIKE ?
         ORDER BY g.is_enabled DESC, g.rank_no ASC
         LIMIT 8`,
        [like, like],
      )
      return {
        found: rows.length > 0,
        games: rows.map((g) => ({
          name: g.name,
          provider: g.provider,
          category: g.category,
          available: g.is_enabled === 1 && g.is_maintain !== 1,
          underMaintenance: g.is_maintain === 1,
        })),
      }
    }

    case 'search_faq': {
      const keyword = String(input.keyword ?? '')
      const results = await searchFaq(env, keyword)
      return { found: results.length > 0, results }
    }

    case 'escalate_to_human': {
      const reason = String(input.reason ?? 'other')
      const onDuty = await isHumanOnDuty(env)
      if (onDuty) {
        await escalateConversation(env, context.conversationId, reason, 'human_taken')
        return {
          escalated: true,
          humanOnline: true,
          message:
            'A human agent is online and has been notified. Tell the user an agent will reply right here shortly.',
        }
      }
      await escalateConversation(env, context.conversationId, reason, 'escalated')
      return {
        escalated: true,
        humanOnline: false,
        ticketId: context.conversationId,
        message: `No human agent is online right now. The issue is recorded as ticket #${context.conversationId} and an agent will follow up in this chat as soon as one is available. Be honest with the user that no agent is online at this moment — never pretend one is coming right away. Reassure them their funds and records are safe in the system. Ask for any missing key details (order id, time, what happened) so the agent can resolve it faster when they come online. Let them know you can still help with other questions meanwhile.`,
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}
