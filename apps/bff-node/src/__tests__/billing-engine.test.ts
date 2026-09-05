import { describe, expect, it } from 'vitest'
import {
  applyTiers, computeBilling, prorateMonthlyFee,
  type BillingBasis, type BillingRule,
} from '../services/billing/billing-engine.js'
import { canTransition, monthPeriod, previousMonthPeriod } from '../services/billing/billing-invoice.service.js'

const basis = (patch: Partial<BillingBasis> = {}): BillingBasis => ({
  depositAmount: 100000,
  depositPlatform: 60000,
  depositTenant: 40000,
  turnover: 1000000,
  payout: 900000,
  ggr: 100000,
  bonusCost: 8000,
  commissionCost: 12000,
  channelFee: 1800,
  venueTurnover: { slots: 700000, live: 300000 },
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  ...patch,
})

const rule = (patch: Partial<BillingRule> = {}): BillingRule => ({
  id: 1,
  ruleType: 'ggr_share',
  label: 'GGR 30%',
  ratePct: 30,
  fixedAmount: null,
  tiers: null,
  tierMode: 'flat',
  scope: 'all',
  deductBonus: true,
  deductCommission: true,
  deductChannelFee: true,
  carryOver: true,
  venueRates: null,
  sortOrder: 10,
  ...patch,
})

describe('GGR 口径（P2-3）', () => {
  it('默认三项全扣：GGR 10万 - 活动 8000 - 佣金 12000 - 通道费 1800 = 78200，抽 30%', () => {
    const r = computeBilling(basis(), [rule()], 0, 'sum')
    expect(r.items[0].basisAmount).toBe(78200)
    expect(r.items[0].amount).toBe(23460)
    expect(r.gross).toBe(23460)
    expect(r.carryOut).toBe(0)
  })

  it('关掉扣减项就按毛 GGR 抽：签约时逐项确认，账单上要能看出用的是哪套口径', () => {
    const r = computeBilling(basis(), [rule({ deductBonus: false, deductCommission: false, deductChannelFee: false })], 0, 'sum')
    expect(r.items[0].basisAmount).toBe(100000)
    expect(r.items[0].amount).toBe(30000)
    expect(r.items[0].detail).toMatchObject({ deductions: { bonusCost: 0, commissionCost: 0, channelFee: 0 } })
  })

  it('负净收益：当期不收钱，亏损结转下期', () => {
    const r = computeBilling(basis({ ggr: 10000 }), [rule()], 0, 'sum')
    // 10000 - 8000 - 12000 - 1800 = -11800
    expect(r.items[0].amount).toBe(0)
    expect(r.carryOut).toBe(-11800)
  })

  it('carryOver=false：亏损当期归零，不带到下期', () => {
    const r = computeBilling(basis({ ggr: 10000 }), [rule({ carryOver: false })], 0, 'sum')
    expect(r.items[0].amount).toBe(0)
    expect(r.carryOut).toBe(0)
  })

  it('上期结转先抵扣本期：78200 - 50000 = 28200，抽 30%', () => {
    const r = computeBilling(basis(), [rule()], -50000, 'sum')
    expect(r.items[0].basisAmount).toBe(28200)
    expect(r.items[0].amount).toBe(8460)
    expect(r.carryOut).toBe(0)
  })

  it('结转额大于本期净收益：本期仍不收钱，未用完的部分继续结转', () => {
    const r = computeBilling(basis(), [rule()], -100000, 'sum')
    expect(r.items[0].amount).toBe(0)
    expect(r.carryOut).toBe(-21800)
  })
})

describe('分档（P2-2）', () => {
  const tiers = [{ upTo: 100000, ratePct: 3 }, { upTo: 500000, ratePct: 2 }, { upTo: null, ratePct: 1 }]

  it('flat：落在哪档整体按该档费率', () => {
    expect(applyTiers(300000, tiers, 'flat').amount).toBe(6000)
  })

  it('progressive：逐段累进', () => {
    // 10万×3% + 20万×2% = 3000 + 4000
    expect(applyTiers(300000, tiers, 'progressive').amount).toBe(7000)
  })

  it('超出最高档上限：flat 用无上限那档', () => {
    expect(applyTiers(900000, tiers, 'flat').amount).toBe(9000)
  })
})

describe('规则组合（P2-2）', () => {
  it('充值佣金按 scope 取基数：混用双资金模式时两种模式费率不同', () => {
    const rules = [
      rule({ id: 2, ruleType: 'deposit_commission', label: '平台代收 2%', ratePct: 2, scope: 'platform', sortOrder: 20 }),
      rule({ id: 3, ruleType: 'deposit_commission', label: '自带通道 0.5%', ratePct: 0.5, scope: 'tenant', sortOrder: 21 }),
    ]
    const r = computeBilling(basis(), rules, 0, 'sum')
    expect(r.items[0].amount).toBe(1200)
    expect(r.items[1].amount).toBe(200)
    expect(r.gross).toBe(1400)
  })

  it('分场馆流水返点：缺省场馆回落 rate_pct', () => {
    const r = computeBilling(basis(), [rule({
      ruleType: 'turnover_rebate', label: '流水返点', ratePct: 0.2,
      venueRates: { slots: 0.8 },
    })], 0, 'sum')
    // slots 70万×0.8% = 5600；live 30万 未配置 → 0.2% = 600
    expect(r.items[0].amount).toBe(6200)
  })

  it('settle_mode=max_of_fee：月费是保底而非附加', () => {
    const rules = [rule(), rule({ id: 9, ruleType: 'monthly_fee', label: '月费 500', ratePct: null, fixedAmount: 500, sortOrder: 90 })]
    const sum = computeBilling(basis(), rules, 0, 'sum')
    expect(sum.gross).toBe(23960)
    const maxOf = computeBilling(basis(), rules, 0, 'max_of_fee')
    expect(maxOf.gross).toBe(23460)
    // 分成低于月费时收月费
    const thin = computeBilling(basis({ ggr: 22000 }), rules, 0, 'max_of_fee')
    expect(thin.gross).toBe(500)
  })
})

describe('月费折算', () => {
  it('整月收全额', () => {
    expect(prorateMonthlyFee(2000, '2026-09-01', '2026-09-30').amount).toBe(2000)
  })

  it('月中开站按天折算：9 月 16 日起共 15 天 / 30 天', () => {
    expect(prorateMonthlyFee(2000, '2026-09-16', '2026-09-30').amount).toBe(1000)
  })

  it('跨月周期按各月天数分别折算', () => {
    // 9/16-9/30 = 15/30 → 1000；10/1-10/15 = 15/31 → 967.7419
    const r = prorateMonthlyFee(2000, '2026-09-16', '2026-10-15')
    expect(r.months).toHaveLength(2)
    expect(r.amount).toBeCloseTo(1967.7419, 4)
  })
})

describe('账单状态机（P2-5）', () => {
  it('草稿只能开票或作废', () => {
    expect(canTransition('draft', 'issued')).toBe(true)
    expect(canTransition('draft', 'confirmed')).toBe(false)
    expect(canTransition('draft', 'settled')).toBe(false)
  })

  it('争议不能直接核销：跳过确认等于平台单方面认定金额', () => {
    expect(canTransition('disputed', 'issued')).toBe(true)
    expect(canTransition('disputed', 'settled')).toBe(false)
  })

  it('已核销是终态', () => {
    expect(canTransition('settled', 'void')).toBe(false)
    expect(canTransition('settled', 'disputed')).toBe(false)
  })
})

describe('账单周期', () => {
  it('自然月起止', () => {
    expect(monthPeriod('2026-02-14')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(monthPeriod('2028-02-14')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
  })

  it('上一个自然月（跨年）', () => {
    expect(previousMonthPeriod(new Date('2026-01-05T00:00:00Z')))
      .toEqual({ start: '2025-12-01', end: '2025-12-31' })
  })
})
