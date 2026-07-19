import type { Pool, RowDataPacket } from 'mysql2/promise'

// 风控信号层：每日 cron 全量重算 bg_user_risk_signal，并把命中的行为规则落成 bg_user_tag。
// 与 bg_user_segment（价值分层）互补，不重复其 lifecycle/value_tier 维度。
// 阈值放这里（纯函数，可单测），SQL 只负责取原始聚合。

export const BONUS_ABUSE = { minRatio: 1.5, minWithdrawCount: 1 } as const
export const MULTI_ACCOUNT = { minSharedUsers: 3 } as const

/** 无充值却有彩金时 bonus/deposit 会除零，用一个大常数表达「无穷大」并能落进 DECIMAL(10,4) */
export const INFINITE_RATIO = 9999

/** cron 可自动撤销的标签；人工标不在此列，跑批绝不触碰 */
export const AUTO_TAGS = ['risk.bonus_abuse', 'risk.multi_account'] as const

export interface RiskInput {
  bonusTotal: number
  netDeposit: number
  withdrawCount: number
  deviceSharedUsers: number
  ipSharedUsers: number
}

export interface RiskResult {
  bonusRatio: number
  riskScore: number
  tags: string[]
}

export function bonusRatio(bonusTotal: number, netDeposit: number): number {
  if (bonusTotal <= 0) return 0
  if (netDeposit <= 0) return INFINITE_RATIO
  return Math.min(INFINITE_RATIO, Math.round((bonusTotal / netDeposit) * 10000) / 10000)
}

export function isBonusAbuse(input: RiskInput): boolean {
  return (
    bonusRatio(input.bonusTotal, input.netDeposit) >= BONUS_ABUSE.minRatio &&
    input.withdrawCount >= BONUS_ABUSE.minWithdrawCount
  )
}

export function isMultiAccount(input: RiskInput): boolean {
  return input.deviceSharedUsers >= MULTI_ACCOUNT.minSharedUsers
}

/** 0-100。两条规则各占一半权重，共用设备数越多分越高。规则简单是刻意的：可解释 > 准确率。 */
export function riskScore(input: RiskInput): number {
  let score = 0
  if (isBonusAbuse(input)) score += 50
  if (isMultiAccount(input)) score += 30
  if (input.ipSharedUsers >= MULTI_ACCOUNT.minSharedUsers) score += 20
  return Math.min(100, score)
}

export function classifyRisk(input: RiskInput): RiskResult {
  const tags: string[] = []
  if (isBonusAbuse(input)) tags.push('risk.bonus_abuse')
  if (isMultiAccount(input)) tags.push('risk.multi_account')
  return {
    bonusRatio: bonusRatio(input.bonusTotal, input.netDeposit),
    riskScore: riskScore(input),
    tags,
  }
}

interface RawRiskRow extends RowDataPacket {
  id: string
  bonus_total: string | number
  net_deposit: string | number
  withdraw_count: number
  device_shared_users: number
  ip_shared_users: number
}

// 彩金总额取自钱包流水这一单一真相源，而不是各领取记录表：
//   trial/appdl → red_packet，firstdep/转盘 → bonus，任务现金奖 → task_bonus。
// 每笔彩金只有一条 ledger，不会重复计算。返水(rebate)与 VIP 礼金不计入——
// 那是正常玩家权益，算进来会误伤高频玩家。
// （注意：001_schema 里的 bg_promo_claim 线上已不存在，勿据其写聚合。）
const RAW_SIGNAL_SQL = `
  SELECT
      u.id,
      COALESCE(b.total, 0)  AS bonus_total,
      COALESCE(d.total, 0)  AS net_deposit,
      COALESCE(w.cnt, 0)    AS withdraw_count,
      COALESCE(dev.shared, 1) AS device_shared_users,
      COALESCE(ipl.shared, 1) AS ip_shared_users
    FROM bg_user u
    LEFT JOIN (
      SELECT user_id, SUM(amount) total FROM bg_wallet_ledger
       WHERE type IN ('red_packet','bonus','task_bonus') AND currency = 'PHP' GROUP BY user_id
    ) b ON b.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(CASE WHEN currency = 'PHP' THEN amount ELSE 0 END) total
        FROM bg_deposit_order WHERE status = 'paid' GROUP BY user_id
    ) d ON d.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM bg_withdraw_order WHERE status = 'completed' GROUP BY user_id) w ON w.user_id = u.id
    LEFT JOIN (
      SELECT l.user_id, MAX(g.shared) shared FROM bg_login_log l
        JOIN (
          SELECT device_id, COUNT(DISTINCT user_id) shared FROM bg_login_log
           WHERE device_id IS NOT NULL AND device_id <> '' GROUP BY device_id
        ) g ON g.device_id = l.device_id
       GROUP BY l.user_id
    ) dev ON dev.user_id = u.id
    LEFT JOIN (
      SELECT l.user_id, MAX(g.shared) shared FROM bg_login_log l
        JOIN (
          SELECT ip, COUNT(DISTINCT user_id) shared FROM bg_login_log
           WHERE ip IS NOT NULL AND ip <> '' GROUP BY ip
        ) g ON g.ip = l.ip
       GROUP BY l.user_id
    ) ipl ON ipl.user_id = u.id
   WHERE u.status = 'active'`

/** 全量重算风险信号 + 自动标签。返回处理的用户数。 */
export async function recomputeRiskSignals(pool: Pool): Promise<number> {
  const [rows] = await pool.query<RawRiskRow[]>(RAW_SIGNAL_SQL)
  if (rows.length === 0) return 0

  const signalValues: unknown[][] = []
  const tagValues: unknown[][] = []
  // 逐 tag 收集「本次未命中」的用户：只按「完全没命中任何 tag」收集会漏掉
  // 「仍命中 A、但不再命中 B」的情况，导致 B 的自动标永远撤不掉
  const missingByTag: Record<string, string[]> = Object.fromEntries(AUTO_TAGS.map((t) => [t, []]))

  for (const r of rows) {
    const input: RiskInput = {
      bonusTotal: Number(r.bonus_total),
      netDeposit: Number(r.net_deposit),
      withdrawCount: Number(r.withdraw_count),
      deviceSharedUsers: Number(r.device_shared_users),
      ipSharedUsers: Number(r.ip_shared_users),
    }
    const result = classifyRisk(input)
    signalValues.push([
      r.id,
      input.bonusTotal,
      input.netDeposit,
      result.bonusRatio,
      input.withdrawCount,
      input.deviceSharedUsers,
      input.ipSharedUsers,
      result.riskScore,
      JSON.stringify(input),
    ])
    for (const tag of AUTO_TAGS) {
      if (result.tags.includes(tag)) tagValues.push([r.id, tag, 'auto', result.riskScore, JSON.stringify(input)])
      else missingByTag[tag].push(r.id)
    }
  }

  const BATCH = 500
  for (let i = 0; i < signalValues.length; i += BATCH) {
    await pool.query(
      `INSERT INTO bg_user_risk_signal
         (user_id, bonus_total, net_deposit, bonus_ratio, withdraw_count, device_shared_users, ip_shared_users, risk_score, signals)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         bonus_total = VALUES(bonus_total), net_deposit = VALUES(net_deposit), bonus_ratio = VALUES(bonus_ratio),
         withdraw_count = VALUES(withdraw_count), device_shared_users = VALUES(device_shared_users),
         ip_shared_users = VALUES(ip_shared_users), risk_score = VALUES(risk_score), signals = VALUES(signals)`,
      [signalValues.slice(i, i + BATCH)],
    )
  }

  for (let i = 0; i < tagValues.length; i += BATCH) {
    await pool.query(
      `INSERT INTO bg_user_tag (user_id, tag_code, source, confidence, evidence)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         confidence = IF(source = 'manual', confidence, VALUES(confidence)),
         evidence   = IF(source = 'manual', evidence,   VALUES(evidence))`,
      [tagValues.slice(i, i + BATCH)],
    )
  }

  // 不再命中的用户撤销自动标；人工标绝不动（运营的判断不能被凌晨的跑批抹掉）
  for (const tag of AUTO_TAGS) {
    const users = missingByTag[tag]
    for (let i = 0; i < users.length; i += BATCH) {
      await pool.query(
        `DELETE FROM bg_user_tag WHERE source = 'auto' AND tag_code = ? AND user_id IN (?)`,
        [tag, users.slice(i, i + BATCH)],
      )
    }
  }

  return signalValues.length
}
