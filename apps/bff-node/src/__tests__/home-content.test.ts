import { describe, expect, it } from 'vitest'
import { parseLocalizedImageKeys } from '../services/home-content.service.js'

describe('首页多语言图片读取', () => {
  it('兼容 mysql2 返回的 JSON 对象', () => {
    expect(parseLocalizedImageKeys('home/banner/en.webp', { id: 'home/banner/id.webp' })).toEqual({
      en: 'home/banner/en.webp',
      id: 'home/banner/id.webp',
    })
  })

  it('兼容 JSON 字符串并过滤无效图片键', () => {
    expect(parseLocalizedImageKeys('home/banner/en.webp', '{"id":"home/banner/id.webp","vi":"bad"}')).toEqual({
      en: 'home/banner/en.webp',
      id: 'home/banner/id.webp',
    })
  })

  it('损坏数据回退英文图片', () => {
    expect(parseLocalizedImageKeys('home/banner/en.webp', '{')).toEqual({ en: 'home/banner/en.webp' })
  })
})
