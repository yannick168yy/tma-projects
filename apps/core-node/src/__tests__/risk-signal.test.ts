import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bonusRatio,
  classifyRisk,
  isBonusAbuse,
  isMultiAccount,
  riskScore,
  INFINITE_RATIO,
  type RiskInput,
} from '../services/risk-signal.service.js'

process.env.NODE_ENV = 'test'

function baseInput(over: Partial<RiskInput> = {}): RiskInput {
  return {
    bonusTotal: 0,
    netDeposit: 0,
    withdrawCount: 0,
    deviceSharedUsers: 1,
    ipSharedUsers: 1,
    ...over,
  }
}

describe('风控信号：彩金充值比', () => {
  it('无彩金 = 0（新用户不该因除零被标记）', () => {
    assert.equal(bonusRatio(0, 0), 0)
  })

  it('有彩金但从未充值 = 无穷大常数', () => {
    assert.equal(bonusRatio(500, 0), INFINITE_RATIO)
  })

  it('正常比值保留四位小数', () => {
    assert.equal(bonusRatio(150, 100), 1.5)
  })
})

describe('风控信号：薅优惠党', () => {
  it('彩金超充值 1.5 倍且提过现 = 命中', () => {
    assert.equal(isBonusAbuse(baseInput({ bonusTotal: 200, netDeposit: 100, withdrawCount: 1 })), true)
  })

  it('比值达标但从未提现 = 不命中（钱还在站内，未造成损失）', () => {
    assert.equal(isBonusAbuse(baseInput({ bonusTotal: 200, netDeposit: 100, withdrawCount: 0 })), false)
  })

  it('提过现但比值不足 = 不命中', () => {
    assert.equal(isBonusAbuse(baseInput({ bonusTotal: 100, netDeposit: 100, withdrawCount: 3 })), false)
  })

  it('纯彩金零充值且提现 = 命中（最典型的薅客）', () => {
    assert.equal(isBonusAbuse(baseInput({ bonusTotal: 88, netDeposit: 0, withdrawCount: 1 })), true)
  })

  it('零彩金零充值不命中（避免除零误伤全体新用户）', () => {
    assert.equal(isBonusAbuse(baseInput({ withdrawCount: 5 })), false)
  })
})

describe('风控信号：多账户农场', () => {
  it('同设备 3 个账号 = 命中', () => {
    assert.equal(isMultiAccount(baseInput({ deviceSharedUsers: 3 })), true)
  })

  it('同设备 2 个账号 = 不命中（夫妻/室友共用设备是常态）', () => {
    assert.equal(isMultiAccount(baseInput({ deviceSharedUsers: 2 })), false)
  })
})

describe('风控信号：风险分与标签', () => {
  it('干净用户 0 分无标签', () => {
    const r = classifyRisk(baseInput({ netDeposit: 1000, withdrawCount: 2 }))
    assert.equal(r.riskScore, 0)
    assert.deepEqual(r.tags, [])
  })

  it('两条规则全中 + 同 IP 聚集 = 满分 100', () => {
    const input = baseInput({ bonusTotal: 500, netDeposit: 0, withdrawCount: 2, deviceSharedUsers: 5, ipSharedUsers: 5 })
    assert.equal(riskScore(input), 100)
    assert.deepEqual(classifyRisk(input).tags, ['risk.bonus_abuse', 'risk.multi_account'])
  })

  it('只中薅优惠 = 50 分单标签', () => {
    const input = baseInput({ bonusTotal: 200, netDeposit: 100, withdrawCount: 1 })
    assert.equal(riskScore(input), 50)
    assert.deepEqual(classifyRisk(input).tags, ['risk.bonus_abuse'])
  })

  it('风险分封顶 100', () => {
    const input = baseInput({ bonusTotal: 9999, netDeposit: 0, withdrawCount: 9, deviceSharedUsers: 99, ipSharedUsers: 99 })
    assert.equal(riskScore(input), 100)
  })
})
