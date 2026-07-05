import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../../config/env.js'
import { getMysqlPool } from '../../clients/mysql.client.js'

// 业务概览:从 DB 汇总注入 system prompt,1 小时缓存,失败时退回上次结果
let cached: { text: string; at: number } | null = null
const TTL_MS = 60 * 60 * 1000

export async function getBusinessOverview(env: Env): Promise<string> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.text
  const pool = getMysqlPool(env)
  try {
    const [providers] = await pool.query<RowDataPacket[]>(
      `SELECT provider, COUNT(*) c FROM bg_568win_game WHERE is_enabled = 1 GROUP BY provider ORDER BY c DESC`,
    )
    const [categories] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(o.site_category, g.site_category_auto) cat, COUNT(*) c
       FROM bg_568win_game g
       LEFT JOIN bg_568win_game_override o USING (game_provider_id, game_id)
       WHERE g.is_enabled = 1
       GROUP BY cat ORDER BY c DESC`,
    )
    const [promoRows] = await pool.query<RowDataPacket[]>(
      `SELECT promo_id, config_key, config_value FROM bg_promo_config`,
    )
    const [spinRows] = await pool.query<RowDataPacket[]>(`SELECT enabled FROM bg_spin_config LIMIT 1`)
    const [levelRows] = await pool.query<RowDataPacket[]>(
      `SELECT level, min_turnover FROM bg_rebate_level_threshold ORDER BY level`,
    )

    const promo: Record<string, Record<string, string>> = {}
    for (const r of promoRows) {
      const id = String(r.promo_id)
      promo[id] = promo[id] ?? {}
      promo[id][String(r.config_key)] = String(r.config_value)
    }

    const totalGames = providers.reduce((s, p) => s + Number(p.c), 0)
    const topProviders = providers.slice(0, 15).map((p) => `${p.provider} (${p.c})`).join(', ')
    const moreProviders = providers.length > 15 ? ` and ${providers.length - 15} more providers` : ''
    const cats = categories
      .filter((c) => c.cat && c.cat !== 'lobby')
      .map((c) => `${c.cat} ${c.c}`)
      .join(', ')

    const promos: string[] = []
    if (promo.firstdep?.enabled === '1') {
      promos.push(
        `First deposit bonus: ${promo.firstdep.match_pct}% match up to ₱${promo.firstdep.max_bonus} (min deposit ₱${promo.firstdep.min_deposit}, bonus carries a ${promo.firstdep.turnover_x}x wagering requirement)`,
      )
    }
    if (promo.referral?.enabled === '1') {
      promos.push(
        `Referral program: inviter gets ₱${promo.referral.inviter_amount}, invitee gets ₱${promo.referral.invitee_amount}`,
      )
    }
    if (spinRows[0]?.enabled === 1) {
      promos.push('Lucky Spin: spin chances earned via deposits, prizes credited to wallet')
    }
    if (levelRows.length) {
      const thresholds = levelRows.map((l) => `LV${l.level} ≥₱${Number(l.min_turnover)}`).join(', ')
      promos.push(`Cashback (rebate) program: daily cashback on wagers, rate grows with level (${thresholds}; total valid wagering unlocks levels), claim on the Cashback page`)
    }

    const text = `## Platform Overview (auto-generated from live data, refreshed hourly)
- Games: ${totalGames} enabled games from providers: ${topProviders}${moreProviders}
- Game categories: ${cats}
- Login methods: Telegram, Google, phone number + password, username + password (extra methods can be bound in Menu > Account & Login)
- KYC: required before first withdrawal; two steps — phone OTP, then government ID + face photo; automatic review, usually done in minutes; users must be 21+
- Withdrawal preconditions: KYC approved AND wagering (turnover) requirement completed; withdrawals go through review before payout
- Active promotions:
${promos.map((p) => `  - ${p}`).join('\n')}`

    cached = { text, at: Date.now() }
    return text
  } catch {
    return cached?.text ?? ''
  }
}
