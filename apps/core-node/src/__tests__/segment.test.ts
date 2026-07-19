import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyLifecycle,
  classifyValueTier,
  classifySegment,
  type SegmentInput,
} from '../services/segment.service.js'

process.env.NODE_ENV = 'test'

const NOW = new Date('2026-07-07T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

function baseInput(over: Partial<SegmentInput> = {}): SegmentInput {
  return {
    registeredAt: daysAgo(100),
    lastActiveAt: daysAgo(1),
    totalDeposit: 0,
    depositCount: 0,
    isAgent: false,
    reachableTg: false,
    ...over,
  }
}

describe('用户分层：生命周期', () => {
  it('注册 7 天内 = new（即使近期活跃）', () => {
    const r = classifyLifecycle(baseInput({ registeredAt: daysAgo(3), lastActiveAt: daysAgo(1) }), NOW)
    assert.equal(r.lifecycle, 'new')
  })

  it('注册已久 + 近 7 天活跃 = active', () => {
    const r = classifyLifecycle(baseInput({ registeredAt: daysAgo(60), lastActiveAt: daysAgo(5) }), NOW)
    assert.equal(r.lifecycle, 'active')
  })

  it('8~30 天未活跃 = dormant', () => {
    const r = classifyLifecycle(baseInput({ registeredAt: daysAgo(60), lastActiveAt: daysAgo(20) }), NOW)
    assert.equal(r.lifecycle, 'dormant')
  })

  it('超 30 天未活跃 = churned', () => {
    const r = classifyLifecycle(baseInput({ registeredAt: daysAgo(90), lastActiveAt: daysAgo(45) }), NOW)
    assert.equal(r.lifecycle, 'churned')
  })

  it('注册已久但从无活动记录 = churned（以注册时间兜底）', () => {
    const r = classifyLifecycle(baseInput({ registeredAt: daysAgo(90), lastActiveAt: null }), NOW)
    assert.equal(r.lifecycle, 'churned')
    assert.equal(r.daysSinceActive, 90)
  })
})

describe('用户分层：价值档', () => {
  it('未充值 = none', () => {
    assert.equal(classifyValueTier(0, 0), 'none')
  })
  it('有笔数但金额为 0 也归 none（脏数据兜底）', () => {
    assert.equal(classifyValueTier(0, 3), 'none')
  })
  it('< ₱1000 = low', () => assert.equal(classifyValueTier(500, 2), 'low'))
  it('< ₱10000 = mid', () => assert.equal(classifyValueTier(5000, 5), 'mid'))
  it('< ₱50000 = high', () => assert.equal(classifyValueTier(30000, 10), 'high'))
  it('≥ ₱50000 = vip', () => assert.equal(classifyValueTier(80000, 20), 'vip'))
  it('边界 ₱1000 归 mid（下界含）', () => assert.equal(classifyValueTier(1000, 1), 'mid'))
})

describe('用户分层：综合', () => {
  it('沉睡高价值可 TG 触达的代理，字段齐全', () => {
    const seg = classifySegment(
      baseInput({
        registeredAt: daysAgo(120),
        lastActiveAt: daysAgo(15),
        totalDeposit: 30000,
        depositCount: 12,
        isAgent: true,
        reachableTg: true,
      }),
      NOW,
    )
    assert.equal(seg.lifecycle, 'dormant')
    assert.equal(seg.valueTier, 'high')
    assert.equal(seg.deposited, true)
    assert.equal(seg.isAgent, true)
    assert.equal(seg.reachableTg, true)
    assert.equal(seg.daysSinceActive, 15)
  })
})
