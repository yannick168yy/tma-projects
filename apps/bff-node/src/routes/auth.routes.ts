import Router from '@koa/router'
import type { PasswordMethod } from '../services/auth.service.js'
import { AuthError, loginWithGoogleCode, loginWithInitData, loginWithPassword, loginWithTelegramOidc, loginWithTelegramWidget, logout, refreshSession, registerWithPassword, resetForgotPassword, resolveSession, sendForgotPasswordOtp, toAuthUser } from '../services/auth.service.js'
import { recordUserLogin } from '../services/store/index.js'
import { lookupRegion } from '../services/geo.service.js'
import { attributeAgentByDomain } from '../services/agent.service.js'
import { fail, ok } from '../utils/response.js'
import { getLoginPasswordFailureLimit, getLoginPasswordLockSeconds } from '../services/otp-policy.service.js'
import { evaluateCheckpoint } from '../services/risk.service.js'

const router = new Router({ prefix: '/auth' })

function cleanIp(raw: string): string {
  return raw.replace(/^::ffff:/i, '')
}

// 登录/注册风控闸门。此时 session 已签发，但 token 不返回给客户端即等效拒绝。
// 放在 ok() 之前是因为 userId 要等 login 成功才拿得到。
async function loginRiskDenied(ctx: import('koa').Context, userId: string, ip: string): Promise<boolean> {
  const decision = await evaluateCheckpoint(ctx.state.env, {
    checkpoint: 'login',
    userId,
    ip,
    deviceId: ctx.get('x-device-id') || undefined,
    region: lookupRegion(ip),
  })
  if (decision.action !== 'deny') return false
  fail(ctx, 403, 'Account access denied', 403)
  return true
}

// 从请求头提取设备指纹（前端 client.ts 统一注入）。全部非致命，缺失即降级
function fingerprint(ctx: import('koa').Context): { deviceId?: string; fpVisitor?: string; fpSignals?: string } {
  const deviceId = ctx.get('x-device-id') || undefined
  const fpVisitor = ctx.get('x-fp-visitor') || undefined
  let fpSignals: string | undefined
  const raw = ctx.get('x-fp-signals')
  if (raw) {
    try {
      const json = Buffer.from(raw, 'base64').toString('utf8')
      JSON.parse(json) // 校验合法 JSON，避免写坏 JSON 列导致整条日志插入失败
      fpSignals = json
    } catch {
      /* 忽略非法指纹信号 */
    }
  }
  return { deviceId, fpVisitor, fpSignals }
}

// ── 注册防刷 ─────────────────────────────────────────────────────────────────
// 同 IP 每小时/每天、同设备每天的注册数上限；只统计注册成功的请求
const REG_IP_HOUR_LIMIT = 3
const REG_IP_DAY_LIMIT = 5
const REG_DEVICE_DAY_LIMIT = 3

type RedisLike = import('ioredis').Redis

async function registerThrottled(redis: RedisLike, ip: string, deviceId?: string): Promise<boolean> {
  const [ipHour, ipDay, devDay] = await Promise.all([
    redis.get(`auth:reg:ip:h:${ip}`),
    redis.get(`auth:reg:ip:d:${ip}`),
    deviceId ? redis.get(`auth:reg:dev:d:${deviceId}`) : Promise.resolve(null),
  ])
  return Number(ipHour) >= REG_IP_HOUR_LIMIT
    || Number(ipDay) >= REG_IP_DAY_LIMIT
    || Number(devDay) >= REG_DEVICE_DAY_LIMIT
}

async function bumpRegisterCounter(redis: RedisLike, key: string, ttlSec: number): Promise<void> {
  const n = await redis.incr(key)
  if (n === 1) await redis.expire(key, ttlSec)
}

function recordRegisterSuccess(redis: RedisLike, ip: string, deviceId?: string): void {
  void bumpRegisterCounter(redis, `auth:reg:ip:h:${ip}`, 3600).catch(() => {})
  void bumpRegisterCounter(redis, `auth:reg:ip:d:${ip}`, 86400).catch(() => {})
  if (deviceId) void bumpRegisterCounter(redis, `auth:reg:dev:d:${deviceId}`, 86400).catch(() => {})
}

// Cloudflare Turnstile 服务端校验。密钥未配置时不启用；校验失败/网络异常一律拒绝
async function verifyTurnstile(secret: string, token: string | undefined, ip: string): Promise<boolean> {
  if (!token) return false
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
    })
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

function hostFromHeader(raw: string): string | undefined {
  const value = raw.trim()
  if (!value) return undefined
  try {
    return new URL(value).hostname.slice(0, 255) || undefined
  } catch {
    return value.split('/')[0].split(':')[0].slice(0, 255) || undefined
  }
}

function entrySource(ctx: import('koa').Context, forceTma = false): string | undefined {
  if (forceTma) return 'tma'
  return hostFromHeader(ctx.get('origin'))
    ?? hostFromHeader(ctx.get('referer'))
    ?? hostFromHeader(ctx.get('host'))
}

// 新注册用户按来源域名归因到代理（非致命，不阻塞登录）
function attributeAgent(ctx: import('koa').Context, isNewUser: boolean, userId: string): void {
  if (!isNewUser) return
  const host = ctx.get('origin') || ctx.get('host')
  attributeAgentByDomain(ctx.state.env, userId, host).catch(() => {})
}

function isPasswordMethod(m: unknown): m is PasswordMethod {
  return m === 'phone' || m === 'account'
}

router.post('/telegram', async (ctx) => {
  const body = ctx.request.body as { initData?: string; start_param?: string }
  const initData = ctx.get('X-Telegram-Init-Data') || body.initData || ''
  try {
    const ip = cleanIp(ctx.ip)
    const result = await loginWithInitData(ctx.state.redis, ctx.state.env, initData, body.start_param, ip)
    if (await loginRiskDenied(ctx, result.user.id, ip)) return
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: await toAuthUser(ctx.state.redis, result.user),
    })
    attributeAgent(ctx, result.isNewUser, result.user.id)
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip,
      region: lookupRegion(ip),
      ...fingerprint(ctx),
      userAgent: ctx.get('user-agent'),
      authMethod: 'telegram',
      entrySource: entrySource(ctx, true),
      isNewUser: result.isNewUser,
    }).catch(() => {})
  } catch (e) {
    if (e instanceof AuthError) {
      fail(ctx, 401, e.message, 401)
      return
    }
    throw e
  }
})

router.post('/google', async (ctx) => {
  const body = ctx.request.body as { code?: string; redirectUri?: string; referralCode?: string }
  if (!body.code || !body.redirectUri) {
    fail(ctx, 400, 'code and redirectUri are required')
    return
  }
  try {
    const ip = cleanIp(ctx.ip)
    const result = await loginWithGoogleCode(
      ctx.state.redis,
      ctx.state.env,
      body.code,
      body.redirectUri,
      ip,
      body.referralCode,
    )
    if (await loginRiskDenied(ctx, result.user.id, ip)) return
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: await toAuthUser(ctx.state.redis, result.user),
    })
    attributeAgent(ctx, result.isNewUser, result.user.id)
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip,
      region: lookupRegion(ip),
      ...fingerprint(ctx),
      userAgent: ctx.get('user-agent'),
      authMethod: 'google',
      entrySource: entrySource(ctx),
      isNewUser: result.isNewUser,
    }).catch(() => {})
  } catch (e) {
    if (e instanceof AuthError) {
      fail(ctx, 401, e.message, 401)
      return
    }
    throw e
  }
})

router.post('/telegram-oidc', async (ctx) => {
  const body = ctx.request.body as { code?: string; redirectUri?: string; referralCode?: string }
  if (!body.code || !body.redirectUri) {
    fail(ctx, 400, 'code and redirectUri are required')
    return
  }
  try {
    const ip = cleanIp(ctx.ip)
    const result = await loginWithTelegramOidc(
      ctx.state.redis,
      ctx.state.env,
      body.code,
      body.redirectUri,
      ip,
      body.referralCode,
    )
    if (await loginRiskDenied(ctx, result.user.id, ip)) return
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: await toAuthUser(ctx.state.redis, result.user),
    })
    attributeAgent(ctx, result.isNewUser, result.user.id)
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip,
      region: lookupRegion(ip),
      ...fingerprint(ctx),
      userAgent: ctx.get('user-agent'),
      authMethod: 'telegram',
      entrySource: entrySource(ctx),
      isNewUser: result.isNewUser,
    }).catch(() => {})
  } catch (e) {
    if (e instanceof AuthError) {
      fail(ctx, e.status ?? 401, e.message, e.status ?? 401)
      return
    }
    throw e
  }
})

router.post('/register', async (ctx) => {
  const body = ctx.request.body as { method?: string; identifier?: string; password?: string; referralCode?: string; turnstileToken?: string }
  if (!isPasswordMethod(body.method) || !body.identifier || !body.password) {
    fail(ctx, 400, 'method, identifier and password are required')
    return
  }
  const regIp = cleanIp(ctx.ip)
  const regDeviceId = ctx.get('x-device-id') || undefined
  if (ctx.state.env.TURNSTILE_SECRET_KEY
    && !(await verifyTurnstile(ctx.state.env.TURNSTILE_SECRET_KEY, body.turnstileToken, regIp))) {
    fail(ctx, 403, 'errors.captchaFailed', 403)
    return
  }
  if (await registerThrottled(ctx.state.redis, regIp, regDeviceId)) {
    fail(ctx, 429, 'errors.tooManyAttempts', 429)
    return
  }
  try {
    const ip = regIp
    const result = await registerWithPassword(
      ctx.state.redis,
      ctx.state.env,
      { method: body.method, identifier: body.identifier, password: body.password, referralCode: body.referralCode },
      ip,
    )
    if (await loginRiskDenied(ctx, result.user.id, ip)) return
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: await toAuthUser(ctx.state.redis, result.user),
    })
    recordRegisterSuccess(ctx.state.redis, regIp, regDeviceId)
    attributeAgent(ctx, result.isNewUser, result.user.id)
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip,
      region: lookupRegion(ip),
      ...fingerprint(ctx),
      userAgent: ctx.get('user-agent'),
      authMethod: body.method,
      entrySource: entrySource(ctx),
      isNewUser: result.isNewUser,
    }).catch(() => {})
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.status ?? 400
      fail(ctx, status, e.message, status)
      return
    }
    throw e
  }
})

router.post('/login', async (ctx) => {
  const body = ctx.request.body as { method?: string; identifier?: string; password?: string }
  if (!isPasswordMethod(body.method) || !body.identifier || !body.password) {
    fail(ctx, 400, 'method, identifier and password are required')
    return
  }
  const ip = cleanIp(ctx.ip)
  const throttleKey = `auth:login:fails:${ip}:${body.method}:${body.identifier}`
  const lockKey = `auth:login:lock:${ip}:${body.method}:${body.identifier}`
  if (await ctx.state.redis.get(lockKey)) {
    fail(ctx, 429, 'errors.tooManyAttempts', 429)
    return
  }
  const [failureLimit, lockSeconds] = await Promise.all([
    getLoginPasswordFailureLimit(ctx.state.env),
    getLoginPasswordLockSeconds(ctx.state.env),
  ])
  try {
    const result = await loginWithPassword(ctx.state.redis, ctx.state.env, {
      method: body.method,
      identifier: body.identifier,
      password: body.password,
    })
    await ctx.state.redis.del(throttleKey, lockKey)
    if (await loginRiskDenied(ctx, result.user.id, ip)) return
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: await toAuthUser(ctx.state.redis, result.user),
    })
    attributeAgent(ctx, result.isNewUser, result.user.id)
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip,
      region: lookupRegion(ip),
      ...fingerprint(ctx),
      userAgent: ctx.get('user-agent'),
      authMethod: body.method,
      entrySource: entrySource(ctx),
      isNewUser: result.isNewUser,
    }).catch(() => {})
  } catch (e) {
    if (e instanceof AuthError) {
      const n = await ctx.state.redis.incr(throttleKey)
      if (n === 1) await ctx.state.redis.expire(throttleKey, lockSeconds)
      if (n >= failureLimit) {
        await ctx.state.redis.set(lockKey, '1', 'EX', lockSeconds)
        await ctx.state.redis.del(throttleKey)
        fail(ctx, 429, 'errors.tooManyAttempts', 429)
        return
      }
      fail(ctx, 401, e.message, 401)
      return
    }
    throw e
  }
})

router.post('/forgot-password/send-otp', async (ctx) => {
  const body = ctx.request.body as { phone?: string }
  if (!body.phone) {
    fail(ctx, 400, 'phone is required')
    return
  }
  try {
    const result = await sendForgotPasswordOtp(ctx.state.redis, ctx.state.env, body.phone, ctx.ip)
    ok(ctx, result)
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.status ?? 400
      fail(ctx, status, e.message, status)
      return
    }
    throw e
  }
})

router.post('/forgot-password/reset', async (ctx) => {
  const body = ctx.request.body as { phone?: string; code?: string; password?: string }
  if (!body.phone || !body.code || !body.password) {
    fail(ctx, 400, 'phone, code and password are required')
    return
  }
  try {
    await resetForgotPassword(ctx.state.redis, ctx.state.env, body.phone, body.code, body.password)
    ok(ctx, null)
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.status ?? 400
      fail(ctx, status, e.message, status)
      return
    }
    throw e
  }
})

router.post('/telegram-widget', async (ctx) => {
  const body = ctx.request.body as Record<string, string> & { referralCode?: string }
  if (!body?.id || !body?.hash) {
    fail(ctx, 400, 'Invalid Telegram login payload')
    return
  }
  try {
    const ip = cleanIp(ctx.ip)
    const { referralCode, ...data } = body
    const result = await loginWithTelegramWidget(ctx.state.redis, ctx.state.env, data, ip, referralCode)
    if (await loginRiskDenied(ctx, result.user.id, ip)) return
    ok(ctx, {
      token: result.token,
      expiresIn: result.expiresIn,
      isNewUser: result.isNewUser,
      trialRedPacketEligible: result.trialRedPacketEligible,
      user: await toAuthUser(ctx.state.redis, result.user),
    })
    attributeAgent(ctx, result.isNewUser, result.user.id)
    recordUserLogin(ctx.state.redis, result.user.id, {
      ip,
      region: lookupRegion(ip),
      ...fingerprint(ctx),
      userAgent: ctx.get('user-agent'),
      authMethod: 'telegram',
      entrySource: entrySource(ctx),
      isNewUser: result.isNewUser,
    }).catch(() => {})
  } catch (e) {
    if (e instanceof AuthError) {
      fail(ctx, e.status ?? 401, e.message, e.status ?? 401)
      return
    }
    throw e
  }
})

router.get('/session', async (ctx) => {
  const auth = ctx.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    ok(ctx, { valid: false })
    return
  }
  const session = await resolveSession(ctx.state.redis, auth.slice(7))
  ok(ctx, session)
})

router.post('/refresh', async (ctx) => {
  const auth = ctx.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    fail(ctx, 401, 'Unauthorized', 401)
    return
  }
  const refreshed = await refreshSession(ctx.state.redis, ctx.state.env, auth.slice(7))
  if (!refreshed) {
    fail(ctx, 401, 'Session expired', 401)
    return
  }
  ok(ctx, refreshed)
})

router.post('/logout', async (ctx) => {
  const auth = ctx.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    await logout(ctx.state.redis, auth.slice(7))
  }
  ok(ctx, null)
})

export default router
