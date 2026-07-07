/**
 * 签到纯计算逻辑单测：连签/小周期/里程碑/日期（不碰 DB）
 */
import { describe, it, expect } from 'vitest'
import {
  manilaToday, prevDate, cycleDayOf, nextStreak, milestonesBetween,
  CYCLE_REWARDS, MILESTONES,
} from '../services/checkin.service.js'

describe('checkin pure logic', () => {
  it('马尼拉日期 = UTC+8', () => {
    // 2026-01-01T18:00Z → 马尼拉 2026-01-02 02:00
    expect(manilaToday(Date.parse('2026-01-01T18:00:00Z'))).toBe('2026-01-02')
    // 2026-01-01T15:59Z → 马尼拉仍 2026-01-01 23:59
    expect(manilaToday(Date.parse('2026-01-01T15:59:00Z'))).toBe('2026-01-01')
  })

  it('prevDate 跨月正确', () => {
    expect(prevDate('2026-03-01')).toBe('2026-02-28')
    expect(prevDate('2026-01-01')).toBe('2025-12-31')
  })

  it('连签数 → 7天小周期循环', () => {
    expect(cycleDayOf(1)).toBe(1)
    expect(cycleDayOf(7)).toBe(7)
    expect(cycleDayOf(8)).toBe(1)
    expect(cycleDayOf(14)).toBe(7)
    expect(cycleDayOf(15)).toBe(1)
  })

  it('nextStreak：昨天签过则+1，否则断签归1', () => {
    expect(nextStreak('2026-01-01', 3, '2026-01-02')).toBe(4) // 连续
    expect(nextStreak('2025-12-31', 3, '2026-01-02')).toBe(1) // 隔天断签
    expect(nextStreak(null, 0, '2026-01-02')).toBe(1)         // 首签
  })

  it('milestonesBetween：只发新跨过的里程碑', () => {
    expect(milestonesBetween(6, 7).map((m) => m.atDays)).toEqual([7])
    expect(milestonesBetween(7, 8)).toEqual([])
    expect(milestonesBetween(14, 15).map((m) => m.atDays)).toEqual([15])
    expect(milestonesBetween(0, 30).map((m) => m.atDays)).toEqual([7, 15, 30]) // 一次跨全部
  })

  it('day7 峰值奖励=premium/elite', () => {
    expect(CYCLE_REWARDS).toHaveLength(7)
    expect(CYCLE_REWARDS[6].base.tier).toBe('premium')
    expect(CYCLE_REWARDS[6].enh.tier).toBe('elite')
    expect(CYCLE_REWARDS[0].base.tier).toBe('starter')
  })

  it('里程碑配置 7/15/30 升序', () => {
    expect(MILESTONES.map((m) => m.atDays)).toEqual([7, 15, 30])
  })
})
