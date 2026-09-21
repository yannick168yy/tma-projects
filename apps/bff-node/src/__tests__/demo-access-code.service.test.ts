import Redis from 'ioredis-mock'
import { describe, expect, it } from 'vitest'
import {
  composeDemoAccessMessage,
  generateDemoAccessCode,
  setDemoAccessCode,
  verifyDemoAccessCode,
} from '../services/demo-access-code.service.js'

describe('演示后台访问码', () => {
  it('生成 4 位且同时包含字母和数字的访问码', () => {
    for (let i = 0; i < 100; i += 1) {
      const code = generateDemoAccessCode()
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/)
      expect(code).toMatch(/[A-Z]/)
      expect(code).toMatch(/[0-9]/)
    }
  })

  it('校验时不区分大小写', async () => {
    const redis = new Redis()
    await setDemoAccessCode(redis, 'A2B3')
    await expect(verifyDemoAccessCode(redis, 'a2b3')).resolves.toBe(true)
    await expect(verifyDemoAccessCode(redis, 'A2C3')).resolves.toBe(false)
    redis.disconnect()
  })

  it('按约定格式生成日报群消息', () => {
    expect(composeDemoAccessMessage('A2B3')).toBe(
      '演示后台\n' +
      'demo-admin.betogo.games\n' +
      '账号 demoadmin\n' +
      '密码 88888888\n' +
      '访问码 A2B3',
    )
  })
})
