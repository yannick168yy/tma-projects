import Router from '@koa/router'
import { getKyc } from '../services/store.js'
import { KycError, sendKycOtp, submitKyc, verifyKycOtp } from '../services/kyc.service.js'
import { fail, ok } from '../utils/response.js'

const router = new Router({ prefix: '/kyc' })

function handleKycError(ctx: import('koa').Context, e: unknown): boolean {
  if (e instanceof KycError) {
    fail(ctx, e.status, e.message, e.status)
    return true
  }
  return false
}

router.get('/status', async (ctx) => {
  const kyc = await getKyc(ctx.state.redis, ctx.state.userId!)
  ok(ctx, {
    status: kyc?.status ?? 'none',
    phoneVerified: kyc?.phoneVerified ?? false,
    phone: kyc?.phone ?? null,
    rejectReason: kyc?.rejectReason ?? null,
  })
})

router.post('/phone/send-otp', async (ctx) => {
  const body = ctx.request.body as { phone?: string }
  if (!body.phone) {
    fail(ctx, 400, 'phone is required')
    return
  }
  try {
    const result = await sendKycOtp(ctx.state.redis, ctx.state.env, ctx.state.userId!, body.phone)
    ok(ctx, result)
  } catch (e) {
    if (!handleKycError(ctx, e)) throw e
  }
})

router.post('/phone/verify', async (ctx) => {
  const body = ctx.request.body as { code?: string }
  if (!body.code) {
    fail(ctx, 400, 'code is required')
    return
  }
  try {
    const result = await verifyKycOtp(ctx.state.redis, ctx.state.userId!, body.code)
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
  }
  if (!body.fullName || !body.idImage) {
    fail(ctx, 400, 'fullName and idImage are required')
    return
  }
  try {
    const result = await submitKyc(ctx.state.redis, ctx.state.env, ctx.state.userId!, {
      fullName: body.fullName,
      docType: body.docType ?? 'unknown',
      verifyMode: body.verifyMode === 'face' ? 'face' : 'document',
      idImage: body.idImage,
      selfieImage: body.selfieImage,
    })
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
    status: kyc.status,
    fullName: kyc.fullName,
    docType: kyc.docType ?? null,
    verifyMode: kyc.verifyMode ?? null,
    phone: kyc.phone ?? null,
    phoneVerified: kyc.phoneVerified ?? false,
    rejectReason: kyc.rejectReason ?? null,
    submittedAt: kyc.submittedAt || null,
  })
})

export default router
