import { createPrivateKey, createSign, type KeyObject } from 'node:crypto'
import type { Env } from '../config/env.js'

export interface SignedRoute {
  domain: string
  priority: number
}

let cachedKey: KeyObject | null | undefined

function signingKey(env: Env): KeyObject | null {
  if (cachedKey !== undefined) return cachedKey
  const raw = env.APP_ROUTE_SIGNING_KEY.trim()
  if (!raw) {
    cachedKey = null
    return null
  }
  try {
    // env 里塞多行 PEM 很容易被转义弄坏，所以两种写法都收：原文 PEM 或它的 base64
    const pem = raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    cachedKey = createPrivateKey(pem)
  } catch {
    cachedKey = null
  }
  return cachedKey
}

/**
 * 签名载荷。App 侧必须逐字节拼出同一个串，所以字段顺序、分隔符、优先级的字符串形式
 * 都是协议的一部分 —— 要改格式必须同时升版本号，否则已发布的 App 会全部验签失败。
 */
export function routeSignaturePayload(market: string, routes: SignedRoute[], issuedAt: number): string {
  return `v1|${market}|${routes.map((route) => `${route.domain}:${route.priority}`).join(',')}|${issuedAt}`
}

/** 未配置私钥时返回空串：本地开发和老版本 App 照常工作，新版本 App 会拒绝这种响应 */
export function signRoutes(env: Env, market: string, routes: SignedRoute[], issuedAt: number): string {
  const key = signingKey(env)
  if (!key) return ''
  return createSign('SHA256').update(routeSignaturePayload(market, routes, issuedAt)).sign(key, 'base64')
}
