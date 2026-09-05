import { describe, expect, it } from 'vitest'
import {
  buildSectionList,
  sanitizeSectionParams,
  HOME_LAYOUT_KEYS,
  type HomeSectionLayoutRow,
} from '../services/sg-game.service.js'

const row = (o: Partial<HomeSectionLayoutRow> & { sectionKey: string }): HomeSectionLayoutRow => ({
  currency: 'PHP', hidden: false, sortOrder: 0, params: null, ...o,
})

describe('首页布局：区块顺序', () => {
  it('后台没配过时用代码默认顺序，且区块齐全', () => {
    const list = buildSectionList([], 'PHP')
    expect(list.map((s) => s.key)).toEqual(HOME_LAYOUT_KEYS)
  })

  it('隐藏的区块不下发', () => {
    const list = buildSectionList([row({ sectionKey: 'popular', hidden: true })], 'PHP')
    expect(list.some((s) => s.key === 'popular')).toBe(false)
  })

  it('只配了部分区块时，没配的留在默认位置', () => {
    // bettingTable 默认在最后一位，配到 1 后应排到最前，其余保持原有相对顺序
    const list = buildSectionList([row({ sectionKey: 'bettingTable', sortOrder: 1 })], 'PHP')
    expect(list[0].key).toBe('bettingTable')
    expect(list[1].key).toBe('announcement')
  })

  it('按币种取配置，别的币种的行不影响本币种', () => {
    const rows = [row({ sectionKey: 'popular', currency: 'USDT', hidden: true })]
    expect(buildSectionList(rows, 'PHP').some((s) => s.key === 'popular')).toBe(true)
    expect(buildSectionList(rows, 'USDT').some((s) => s.key === 'popular')).toBe(false)
  })

  it('每块参数随区块一起下发', () => {
    const list = buildSectionList([row({ sectionKey: 'slots', params: { limit: 6, layout: 'small' } })], 'PHP')
    expect(list.find((s) => s.key === 'slots')).toEqual({ key: 'slots', limit: 6, layout: 'small' })
  })
})

describe('首页布局：参数清洗', () => {
  it('只认识 limit 与 layout，其余字段丢弃', () => {
    expect(sanitizeSectionParams({ limit: 6, layout: 'big', evil: 'x' })).toEqual({ limit: 6, layout: 'big' })
  })

  it('兼容 mysql2 返回的 JSON 字符串', () => {
    expect(sanitizeSectionParams('{"limit":8}')).toEqual({ limit: 8 })
  })

  it('非法值丢弃：负数/零/非法卡型/坏 JSON', () => {
    expect(sanitizeSectionParams({ limit: -1, layout: 'huge' })).toBeNull()
    expect(sanitizeSectionParams('{')).toBeNull()
    expect(sanitizeSectionParams(null)).toBeNull()
  })

  it('数量封顶 60，挡住后台误填导致首页一次渲染上千张卡', () => {
    expect(sanitizeSectionParams({ limit: 9999 })).toEqual({ limit: 60 })
  })
})
