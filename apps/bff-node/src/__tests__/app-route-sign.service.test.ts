import { describe, expect, it } from 'vitest'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import type { Env } from '../config/env.js'
import { routeSignaturePayload, signRoutes } from '../services/app-route-sign.service.js'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const envStub = {
  APP_ROUTE_SIGNING_KEY: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64'),
} as Env

describe('App 线路表签名', () => {
  // 载荷格式是协议的一部分：改了这里等于让所有已发布的 App 验签失败，必须同时升 v1 版本号
  it('载荷格式与 App 侧拼法逐字节一致', () => {
    expect(routeSignaturePayload('PH', [
      { domain: 'betogo.games', priority: 10 },
      { domain: 'betogo666.com', priority: 20 },
    ], 1756704000)).toBe('v1|PH|betogo.games:10,betogo666.com:20|1756704000')
  })

  it('签名可被对应公钥验证通过', () => {
    const routes = [{ domain: 'betogo999.com', priority: 5 }]
    const signature = signRoutes(envStub, 'PH', routes, 1756704000)
    expect(signature).not.toBe('')

    const verifier = createVerify('SHA256')
    verifier.update(routeSignaturePayload('PH', routes, 1756704000))
    expect(verifier.verify(publicKey, signature, 'base64')).toBe(true)
  })

  it('载荷被篡改后验签失败', () => {
    const routes = [{ domain: 'betogo999.com', priority: 5 }]
    const signature = signRoutes(envStub, 'PH', routes, 1756704000)

    const verifier = createVerify('SHA256')
    verifier.update(routeSignaturePayload('PH', [{ domain: 'evil.com', priority: 5 }], 1756704000))
    expect(verifier.verify(publicKey, signature, 'base64')).toBe(false)
  })
})
