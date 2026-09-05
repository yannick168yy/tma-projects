/**
 * 计费引擎（P2-2 / P2-3）。
 *
 * 纯函数：入参是日切快照的合计与规则，出参是账单逐项明细。不碰数据库，
 * 因为 GGR 口径是包网最容易扯皮的地方，必须能用单测把每种参数组合钉死。
 *
 * 口径（写死，不给解释空间）：
 *   GGR    = 有效投注 - 派彩
 *   净收益 = GGR - (deductBonus ? 活动成本 : 0)
 *              - (deductCommission ? 团队佣金 : 0)
 *              - (deductChannelFee ? 通道手续费 : 0)     ← 只有平台通道才有手续费
 *   分成   = max(0, 净收益 + 上期结转) × 费率
 *   结转   = min(0, 净收益 + 上期结转)，carryOver=false 时不结转（当期归零）
 */

export type RuleType = 'deposit_commission' | 'ggr_share' | 'turnover_rebate' | 'monthly_fee'

export interface BillingTier {
  /** 该档上限（含），null = 最高档无上限 */
  upTo: number | null
  ratePct: number
}

export interface BillingRule {
  id: number
  ruleType: RuleType
  label: string
  ratePct: number | null
  fixedAmount: number | null
  tiers: BillingTier[] | null
  tierMode: 'flat' | 'progressive'
  scope: 'all' | 'platform' | 'tenant'
  deductBonus: boolean
  deductCommission: boolean
  deductChannelFee: boolean
  carryOver: boolean
  venueRates: Record<string, number> | null
  sortOrder: number
}

/** 周期内各项合计，均已折算成结算币种（USDT） */
export interface BillingBasis {
  depositAmount: number
  depositPlatform: number
  depositTenant: number
  turnover: number
  payout: number
  ggr: number
  bonusCost: number
  commissionCost: number
  channelFee: number
  venueTurnover: Record<string, number>
  /** 周期起止（含），用于月费折算 */
  periodStart: string
  periodEnd: string
}

export interface ComputedItem {
  ruleType: RuleType
  label: string
  basisAmount: number
  ratePct: number | null
  amount: number
  detail: Record<string, unknown>
}

export interface ComputeResult {
  items: ComputedItem[]
  /** 规则算出的合计（未含人工调整） */
  gross: number
  /** 结转到下期的负 GGR，非正数 */
  carryOut: number
}

/** 金额一律 4 位小数，与库里 DECIMAL(18,4) 对齐，避免账单与流水差一分钱 */
export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000
}

/**
 * 分档计费。
 * flat        = 落在哪档就整体按该档费率（包网常见谈法）
 * progressive = 逐段累进，每段用各自费率
 */
export function applyTiers(base: number, tiers: BillingTier[], mode: 'flat' | 'progressive'): {
  amount: number
  detail: Array<{ from: number; to: number | null; ratePct: number; amount: number }>
} {
  const sorted = [...tiers].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity))
  if (mode === 'flat') {
    const hit = sorted.find((t) => t.upTo === null || base <= t.upTo) ?? sorted[sorted.length - 1]
    if (!hit) return { amount: 0, detail: [] }
    const amount = round4(base * hit.ratePct / 100)
    return { amount, detail: [{ from: 0, to: hit.upTo, ratePct: hit.ratePct, amount }] }
  }
  let remaining = base
  let from = 0
  let amount = 0
  const detail: Array<{ from: number; to: number | null; ratePct: number; amount: number }> = []
  for (const t of sorted) {
    if (remaining <= 0) break
    const span = t.upTo === null ? remaining : Math.min(remaining, t.upTo - from)
    if (span <= 0) continue
    const seg = round4(span * t.ratePct / 100)
    amount += seg
    detail.push({ from, to: t.upTo, ratePct: t.ratePct, amount: seg })
    remaining -= span
    from = t.upTo ?? from + span
  }
  return { amount: round4(amount), detail }
}

/** 按 scope 取充值基数：混用双资金模式时两种模式常谈不同费率 */
function depositBase(basis: BillingBasis, scope: BillingRule['scope']): number {
  if (scope === 'platform') return basis.depositPlatform
  if (scope === 'tenant') return basis.depositTenant
  return basis.depositAmount
}

const DAY_MS = 86_400_000

/**
 * 月费按自然月折算：周期正好是一个整月收全额，不足整月按天数占比收。
 * 试用期客户往往月中开站，直接收全月会立刻吵起来。
 */
export function prorateMonthlyFee(monthly: number, periodStart: string, periodEnd: string): {
  amount: number
  months: Array<{ month: string; days: number; monthDays: number; amount: number }>
} {
  const start = new Date(`${periodStart}T00:00:00Z`)
  const end = new Date(`${periodEnd}T00:00:00Z`)
  const months: Array<{ month: string; days: number; monthDays: number; amount: number }> = []
  let cursor = start
  while (cursor <= end) {
    const y = cursor.getUTCFullYear()
    const m = cursor.getUTCMonth()
    const monthDays = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    const monthEnd = new Date(Date.UTC(y, m, monthDays))
    const segEnd = monthEnd < end ? monthEnd : end
    const days = Math.round((segEnd.getTime() - cursor.getTime()) / DAY_MS) + 1
    months.push({
      month: `${y}-${String(m + 1).padStart(2, '0')}`,
      days,
      monthDays,
      amount: round4(monthly * days / monthDays),
    })
    cursor = new Date(Date.UTC(y, m, monthDays + 1))
  }
  return { amount: round4(months.reduce((s, x) => s + x.amount, 0)), months }
}

/**
 * @param carryIn 上期结转的负 GGR（非正数）
 * @param settleMode sum = 月费与分成叠加；max_of_fee = max(月费, 分成合计)
 */
export function computeBilling(
  basis: BillingBasis,
  rules: BillingRule[],
  carryIn: number,
  settleMode: 'sum' | 'max_of_fee',
): ComputeResult {
  const items: ComputedItem[] = []
  let carryOut = 0

  for (const rule of [...rules].sort((a, b) => a.sortOrder - b.sortOrder)) {
    switch (rule.ruleType) {
      case 'deposit_commission': {
        const base = depositBase(basis, rule.scope)
        if (rule.tiers?.length) {
          const { amount, detail } = applyTiers(base, rule.tiers, rule.tierMode)
          items.push({ ruleType: rule.ruleType, label: rule.label, basisAmount: round4(base), ratePct: null, amount,
            detail: { scope: rule.scope, tierMode: rule.tierMode, tiers: detail } })
        } else {
          const rate = rule.ratePct ?? 0
          items.push({ ruleType: rule.ruleType, label: rule.label, basisAmount: round4(base), ratePct: rate,
            amount: round4(base * rate / 100), detail: { scope: rule.scope } })
        }
        break
      }

      case 'ggr_share': {
        const deductions = {
          bonusCost: rule.deductBonus ? round4(basis.bonusCost) : 0,
          commissionCost: rule.deductCommission ? round4(basis.commissionCost) : 0,
          channelFee: rule.deductChannelFee ? round4(basis.channelFee) : 0,
        }
        const net = round4(basis.ggr - deductions.bonusCost - deductions.commissionCost - deductions.channelFee)
        const afterCarry = round4(net + carryIn)
        const chargeable = Math.max(0, afterCarry)
        // 负净收益结转下期：不结转就等于让平台白吃客户的亏损月，客户第二个月赚回来还要照抽
        if (afterCarry < 0 && rule.carryOver) carryOut = round4(carryOut + afterCarry)

        let amount: number
        let ratePct: number | null = rule.ratePct
        let tierDetail: unknown = null
        if (rule.tiers?.length) {
          const t = applyTiers(chargeable, rule.tiers, rule.tierMode)
          amount = t.amount
          ratePct = null
          tierDetail = t.detail
        } else {
          amount = round4(chargeable * (rule.ratePct ?? 0) / 100)
        }
        items.push({
          ruleType: rule.ruleType, label: rule.label, basisAmount: chargeable, ratePct, amount,
          detail: {
            turnover: round4(basis.turnover), payout: round4(basis.payout), ggr: round4(basis.ggr),
            deductions,
            deductFlags: { bonus: rule.deductBonus, commission: rule.deductCommission, channelFee: rule.deductChannelFee },
            netGgr: net, carryIn: round4(carryIn), afterCarry,
            carryOver: rule.carryOver, tiers: tierDetail,
          },
        })
        break
      }

      case 'turnover_rebate': {
        if (rule.venueRates && Object.keys(rule.venueRates).length > 0) {
          const perVenue: Array<{ venue: string; turnover: number; ratePct: number; amount: number }> = []
          let amount = 0
          let base = 0
          for (const [venue, turnover] of Object.entries(basis.venueTurnover)) {
            const rate = rule.venueRates[venue] ?? rule.ratePct ?? 0
            const seg = round4(turnover * rate / 100)
            amount += seg
            base += turnover
            perVenue.push({ venue, turnover: round4(turnover), ratePct: rate, amount: seg })
          }
          items.push({ ruleType: rule.ruleType, label: rule.label, basisAmount: round4(base), ratePct: null,
            amount: round4(amount), detail: { venues: perVenue.sort((a, b) => b.amount - a.amount) } })
        } else if (rule.tiers?.length) {
          const { amount, detail } = applyTiers(basis.turnover, rule.tiers, rule.tierMode)
          items.push({ ruleType: rule.ruleType, label: rule.label, basisAmount: round4(basis.turnover), ratePct: null,
            amount, detail: { tierMode: rule.tierMode, tiers: detail } })
        } else {
          const rate = rule.ratePct ?? 0
          items.push({ ruleType: rule.ruleType, label: rule.label, basisAmount: round4(basis.turnover), ratePct: rate,
            amount: round4(basis.turnover * rate / 100), detail: {} })
        }
        break
      }

      case 'monthly_fee': {
        const { amount, months } = prorateMonthlyFee(rule.fixedAmount ?? 0, basis.periodStart, basis.periodEnd)
        items.push({ ruleType: rule.ruleType, label: rule.label, basisAmount: 0, ratePct: null, amount,
          detail: { monthly: rule.fixedAmount ?? 0, months } })
        break
      }
    }
  }

  const feeTotal = round4(items.filter((i) => i.ruleType === 'monthly_fee').reduce((s, i) => s + i.amount, 0))
  const shareTotal = round4(items.filter((i) => i.ruleType !== 'monthly_fee').reduce((s, i) => s + i.amount, 0))
  // max_of_fee：月费是保底而非附加。取谁在账单上要写清楚，否则客户看到月费行金额对不上合计
  const gross = settleMode === 'max_of_fee' ? Math.max(feeTotal, shareTotal) : round4(feeTotal + shareTotal)

  return { items, gross: round4(gross), carryOut }
}
