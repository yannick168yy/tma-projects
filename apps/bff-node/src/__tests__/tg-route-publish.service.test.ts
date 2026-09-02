import { describe, expect, it, vi } from 'vitest'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { routeSignaturePayload } from '../services/app-route-sign.service.js'
import { buildRoutePayload, saveRouteChannel, TG_ROUTE_MARKER } from '../services/tg-route-publish.service.js'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const env = {
  APP_ROUTE_SIGNING_KEY: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64'),
  MARKET_DOMAIN_MAP: '{}',
} as Env

// DB 拿不到映射时走内置兜底线路，正好覆盖「全被封还能发出可用线路表」这个场景
const redis = { get: async () => null, set: async () => 'OK' } as unknown as Redis

vi.mock('../services/admin-store.js', () => ({
  getAdminSetting: async () => null,
  setAdminSetting: async () => {},
}))

describe('Telegram 旁路线路发布', () => {
  it('载荷可被公钥验签，且拼法与 App 侧一致', async () => {
    const raw = await buildRoutePayload(redis, env)
    expect(raw.startsWith(TG_ROUTE_MARKER)).toBe(true)

    const body = JSON.parse(Buffer.from(raw.slice(TG_ROUTE_MARKER.length), 'base64').toString('utf8'))
    for (const market of ['PH', 'ID'] as const) {
      const slot = body[market]
      expect(slot.domains.length).toBeGreaterThan(0)
      const verifier = createVerify('SHA256')
      verifier.update(routeSignaturePayload(market, slot.domains, slot.issuedAt))
      expect(verifier.verify(publicKey, slot.signature, 'base64')).toBe(true)
    }
  })

  it('载荷是纯 base64，不会被 App 的提取正则截断', async () => {
    const raw = await buildRoutePayload(redis, env)
    expect(raw.slice(TG_ROUTE_MARKER.length)).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  it('频道名格式非法时拒绝保存', async () => {
    await expect(saveRouteChannel(env, 'betogo_lines')).rejects.toThrow('格式')
    await expect(saveRouteChannel(env, '@ab')).rejects.toThrow('格式')
    await expect(saveRouteChannel(env, '@betogo_lines')).resolves.toBe('@betogo_lines')
    await expect(saveRouteChannel(env, '  ')).resolves.toBe('')
  })
})
