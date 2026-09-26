import Router from '@koa/router'
import { getKyc, listUserIdentities } from '../services/store.js'
import {
  KycError,
  buildKycStatusResponse,
  getKycDocImage,
  getKycStepConfig,
  sendKycOtp,
  submitKyc,
  submitKycDocument,
  submitKycFace,
  verifyKycOtp,
} from '../services/kyc.service.js'
import { AuthError, bindPhone } from '../services/auth.service.js'
import { normalizePhone } from '../utils/phone.js'
import { fail, ok } from '../utils/response.js'
import { resolveRequestMarket } from '../utils/request-market.js'

const router = new Router({ prefix: '/kyc' })

function handleKycError(ctx: import('koa').Context, e: unknown): boolean {
  if (e instanceof KycError) {
    fail(ctx, e.status, e.message, e.status)
    return true
  }
  if (e instanceof AuthError) {
    fail(ctx, e.status ?? 400, e.message, e.status ?? 400)
    return true
  }
  return false
}

async function bindPhoneLoginIfNeeded(ctx: import('koa').Context, phone: string, password?: string, required = false): Promise<void> {
  const hasPhoneIdentity = (await listUserIdentities(ctx.state.redis, ctx.state.userId!)).some((i) => i.provider === 'phone')
  if (hasPhoneIdentity) return
  if (!password) {
    if (required) throw new AuthError('password is required', 400)
    return
  }
  await bindPhone(ctx.state.redis, ctx.state.userId!, phone, password)
}

router.get('/status', async (ctx) => {
  const market = await resolveRequestMarket(ctx, String(ctx.query.currency ?? ''))
  const kyc = await getKyc(ctx.state.redis, ctx.state.userId!)
  const phoneIdentity = (await listUserIdentities(ctx.state.redis, ctx.state.userId!)).find((item) => item.provider === 'phone')
  const registeredPhone = phoneIdentity ? normalizePhone(phoneIdentity.identifier) : null
  const cfg = await getKycStepConfig(ctx.state.redis, ctx.state.env, ctx.state.userId!, market)
  const status = buildKycStatusResponse(kyc, market)
  if (phoneIdentity?.verifiedAt && registeredPhone && !status.phoneVerified) {
    status.phoneVerified = true
    status.phone = status.phone ?? registeredPhone
  }
  ok(ctx, {
    ...status,
    registeredPhone,
    requirePhone: cfg.requirePhone,
    requireDocument: cfg.requireDocument,
    requireFace: cfg.requireFace,
  })
})

// 人脸回退重传场景：取回本人已上传的证件图（仅本人数据，dataURL 形式）
router.get('/document/image', async (ctx) => {
  ok(ctx, await getKycDocImage(ctx.state.redis, ctx.state.env, ctx.state.userId!))
})

// 兼容旧客户端保留路由，但绝不在未验证短信 OTP 时把任意手机号标成已验证。
router.post('/phone/bind', async (ctx) => {
  fail(ctx, 403, 'kyc.errors.phoneOwnershipRequired', 403)
})

router.post('/phone/send-otp', async (ctx) => {
  const body = ctx.request.body as { phone?: string; currency?: string }
  if (!body.phone) {
    fail(ctx, 400, 'phone is required')
    return
  }
  try {
    const market = await resolveRequestMarket(ctx, body.currency)
    const result = await sendKycOtp(ctx.state.redis, ctx.state.env, ctx.state.userId!, body.phone, ctx.ip, market)
    ok(ctx, result)
  } catch (e) {
    if (!handleKycError(ctx, e)) throw e
  }
})

router.post('/phone/verify', async (ctx) => {
  const body = ctx.request.body as { code?: string; password?: string; currency?: string }
  if (!body.code) {
    fail(ctx, 400, 'code is required')
    return
  }
  // 密码长度前置校验：OTP 一次有效，不能等验完码再因密码不合格失败
  if (body.password && body.password.length < 8) {
    fail(ctx, 400, 'Password must be at least 8 characters')
    return
  }
  try {
    const market = await resolveRequestMarket(ctx, body.currency)
    const result = await verifyKycOtp(ctx.state.redis, ctx.state.env, ctx.state.userId!, body.code, market)
    await bindPhoneLoginIfNeeded(ctx, result.phone, body.password)
    ok(ctx, result)
  } catch (e) {
    if (!handleKycError(ctx, e)) throw e
  }
})

router.post('/document', async (ctx) => {
  const body = ctx.request.body as { fullName?: string; docType?: string; idImage?: string; currency?: string }
  if (!body.idImage) {
    fail(ctx, 400, 'idImage is required')
    return
  }
  try {
    const market = await resolveRequestMarket(ctx, body.currency)
    const result = await submitKycDocument(ctx.state.redis, ctx.state.env, ctx.state.userId!, {
      fullName: body.fullName ?? '',
      docType: body.docType ?? 'unknown',
      idImage: body.idImage,
    }, market)
    ok(ctx, result)
  } catch (e) {
    if (!handleKycError(ctx, e)) throw e
  }
})

router.post('/face', async (ctx) => {
  const body = ctx.request.body as { selfieImage?: string; currency?: string }
  if (!body.selfieImage) {
    fail(ctx, 400, 'selfieImage is required')
    return
  }
  try {
    const market = await resolveRequestMarket(ctx, body.currency)
    const result = await submitKycFace(ctx.state.redis, ctx.state.env, ctx.state.userId!, body.selfieImage, market)
    ok(ctx, result)
  } catch (e) {
    if (!handleKycError(ctx, e)) throw e
  }
})

router.post('/submissions', async (ctx) => {
  const body = ctx.request.body as {
    fullName?: string
    docType?: string
    verifyMode?: 'document' | 'face'
    idImage?: string
    selfieImage?: string
    currency?: string
  }
  if (!body.idImage) {
    fail(ctx, 400, 'idImage is required')
    return
  }
  try {
    const market = await resolveRequestMarket(ctx, body.currency)
    const result = await submitKyc(ctx.state.redis, ctx.state.env, ctx.state.userId!, {
      fullName: body.fullName ?? '',
      docType: body.docType ?? 'unknown',
      verifyMode: body.verifyMode === 'face' ? 'face' : 'document',
      idImage: body.idImage,
      selfieImage: body.selfieImage,
    }, market)
    ok(ctx, result)
  } catch (e) {
    if (!handleKycError(ctx, e)) throw e
  }
})

router.get('/submissions/latest', async (ctx) => {
  const kyc = await getKyc(ctx.state.redis, ctx.state.userId!)
  if (!kyc) {
    ok(ctx, null)
    return
  }
  ok(ctx, {
    ...buildKycStatusResponse(kyc),
    verifyMode: kyc.verifyMode ?? null,
    submittedAt: kyc.submittedAt || null,
    docSubmittedAt: kyc.docSubmittedAt ?? null,
    faceSubmittedAt: kyc.faceSubmittedAt ?? null,
  })
})

export default router
