import { describe, expect, it } from 'vitest'
import { parseSiteImageKeys } from '../services/home-content.service.js'

describe('首页站点图片读取', () => {
  it('兼容 mysql2 返回的 JSON 对象', () => {
    expect(parseSiteImageKeys({ IN: 'home/banner/IN/a.webp' })).toEqual({ IN: 'home/banner/IN/a.webp' })
  })

  it('兼容 JSON 字符串并过滤未知站点与无效图片键', () => {
    expect(parseSiteImageKeys('{"ID":"home/banner/ID/a.webp","PH":"bad","id":"home/banner/id/a.webp"}')).toEqual({
      ID: 'home/banner/ID/a.webp',
    })
  })

  it('损坏数据视为没有站点专属图', () => {
    expect(parseSiteImageKeys('{')).toEqual({})
  })
})
