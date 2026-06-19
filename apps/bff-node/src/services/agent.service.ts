import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import type { Env } from '../config/env.js'

// 来源域名归一化：去协议、去端口、去末尾点、小写
export function normalizeDomain(raw?: string): string {
  if (!raw) return ''
  let host = raw.trim().toLowerCase()
  host = host.replace(/^[a-z]+:\/\//, '') // 去协议
  host = host.replace(/\/.*$/, '')        // 去路径
  host = host.replace(/:\d+$/, '')        // 去端口
  host = host.replace(/\.$/, '')          // 去末尾点
  return host
}

// 注册时按来源域名归因：命中启用中的域名渠道 → 写入 bg_user_agent（幂等）。
// 非致命：失败仅记录，不影响登录。
export async function attributeAgentByDomain(env: Env, userId: string, host?: string): Promise<void> {
  const domain = normalizeDomain(host)
  if (!domain) return
  const db = getMysqlPool(env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT c.agent_id
     FROM bg_agent_channel c
     JOIN bg_agent a ON a.agent_id = c.agent_id
     WHERE c.channel_type = 'domain' AND c.channel_value = ? AND c.enabled = 1
       AND a.status = 'active'
     LIMIT 1`,
    [domain],
  )
  const agentId = rows[0]?.agent_id as string | undefined
  if (!agentId) return
  await db.execute(
    `INSERT IGNORE INTO bg_user_agent (user_id, agent_id, source) VALUES (?, ?, 'domain')`,
    [userId, agentId],
  )
}

function monthRange(period: string): { start: string; end: string } {
  const [y, m] = period.split('-').map(Number)
  const start = `${period}-01 00:00:00`
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const end = `${nextMonth}-01 00:00:00`
  return { start, end }
}

function prevPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export interface SettleResult {
  period: string
  agentCount: number
  totalCommissionCents: number
}

// 月度结算：聚合各代理名下用户 GGR（扣赠金），按负 GGR 结转规则生成分成。
// 幂等：已 paid 的分成不覆盖；pending/未结算的重算。
export async function settleAgentMonth(env: Env, period: string): Promise<SettleResult> {
  const db = getMysqlPool(env)
  const { start, end } = monthRange(period)
  const prev = prevPeriod(period)

  // 1. 各代理名下用户 bet/win/用户数
  const [betRows] = await db.query<RowDataPacket[]>(
    `SELECT ua.agent_id,
            SUM(CASE WHEN bo.bet_type = 'bet' THEN bo.amount_cents ELSE 0 END) AS bet_cents,
            SUM(CASE WHEN bo.bet_type = 'win' THEN bo.amount_cents ELSE 0 END) AS win_cents,
            COUNT(DISTINCT bo.user_id) AS user_count
     FROM bg_user_agent ua
     JOIN bg_bet_order bo ON bo.user_id = ua.user_id
     WHERE bo.status = 'settled' AND bo.created_at >= ? AND bo.created_at < ?
     GROUP BY ua.agent_id`,
    [start, end],
  )

  // 2. 各代理名下用户 赠金+红利（扣减项）
  const [bonusRows] = await db.query<RowDataPacket[]>(
    `SELECT ua.agent_id, SUM(l.amount_cents) AS bonus_cents
     FROM bg_user_agent ua
     JOIN bg_wallet_ledger l ON l.user_id = ua.user_id
     WHERE l.type IN ('bonus', 'red_packet') AND l.created_at >= ? AND l.created_at < ?
     GROUP BY ua.agent_id`,
    [start, end],
  )
  const bonusMap = new Map<string, number>()
  for (const r of bonusRows) bonusMap.set(String(r.agent_id), Number(r.bonus_cents ?? 0))

  // 3. 所有 active 代理（含本月无流水的，用于结转上期亏损）
  const [agents] = await db.query<RowDataPacket[]>(
    `SELECT agent_id, ggr_rate_pct FROM bg_agent WHERE status = 'active'`,
  )
  const rateMap = new Map<string, number>()
  for (const a of agents) rateMap.set(String(a.agent_id), Number(a.ggr_rate_pct ?? 0))

  const betMap = new Map<string, { bet: number; win: number; users: number }>()
  for (const r of betRows) {
    betMap.set(String(r.agent_id), {
      bet: Number(r.bet_cents ?? 0),
      win: Number(r.win_cents ?? 0),
      users: Number(r.user_count ?? 0),
    })
  }

  // 4. 上期结转（carry_out <= 0）
  const [prevRows] = await db.query<RowDataPacket[]>(
    `SELECT agent_id, carry_out_cents FROM bg_agent_commission WHERE period = ?`,
    [prev],
  )
  const carryMap = new Map<string, number>()
  for (const r of prevRows) carryMap.set(String(r.agent_id), Number(r.carry_out_cents ?? 0))

  let totalCommission = 0
  let settledCount = 0

  for (const [agentId, rate] of rateMap) {
    const bw = betMap.get(agentId) ?? { bet: 0, win: 0, users: 0 }
    const bonus = bonusMap.get(agentId) ?? 0
    const carryIn = carryMap.get(agentId) ?? 0
    const ggr = bw.bet - bw.win - bonus

    // 本月无任何流水且无结转 → 跳过，不产生空记录
    if (bw.bet === 0 && bw.win === 0 && bonus === 0 && carryIn === 0) continue

    const net = ggr + carryIn
    const commission = net > 0 ? Math.floor((net * rate) / 100) : 0
    const carryOut = net < 0 ? net : 0

    await db.execute(
      `INSERT INTO bg_agent_ggr_monthly
         (agent_id, period, bet_cents, win_cents, bonus_cents, ggr_cents, user_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         bet_cents = VALUES(bet_cents), win_cents = VALUES(win_cents),
         bonus_cents = VALUES(bonus_cents), ggr_cents = VALUES(ggr_cents),
         user_count = VALUES(user_count), calculated_at = CURRENT_TIMESTAMP(3)`,
      [agentId, period, bw.bet, bw.win, bonus, ggr, bw.users],
    )

    // 已 paid 的分成不覆盖（防止改动线下已打款记录）
    await db.execute(
      `INSERT INTO bg_agent_commission
         (agent_id, period, ggr_cents, carry_in_cents, net_ggr_cents, carry_out_cents, rate_pct, commission_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         ggr_cents = IF(status = 'paid', ggr_cents, VALUES(ggr_cents)),
         carry_in_cents = IF(status = 'paid', carry_in_cents, VALUES(carry_in_cents)),
         net_ggr_cents = IF(status = 'paid', net_ggr_cents, VALUES(net_ggr_cents)),
         carry_out_cents = IF(status = 'paid', carry_out_cents, VALUES(carry_out_cents)),
         rate_pct = IF(status = 'paid', rate_pct, VALUES(rate_pct)),
         commission_cents = IF(status = 'paid', commission_cents, VALUES(commission_cents)),
         settled_at = IF(status = 'paid', settled_at, CURRENT_TIMESTAMP(3))`,
      [agentId, period, ggr, carryIn, net, carryOut, rate, commission],
    )

    totalCommission += commission
    settledCount += 1
  }

  return { period, agentCount: settledCount, totalCommissionCents: totalCommission }
}
