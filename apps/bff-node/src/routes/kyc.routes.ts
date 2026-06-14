import Router from '@koa/router'
import { getKyc, getUser } from '../services/store.js'
import {
  KycError,
  buildKycStatusResponse,
  getKycStepConfig,
  sendKycOtp,
  submitKyc,
  submitKycDocument,
  submitKycFace,
  verifyKycOtp,
} from '../services/kyc.service.js'
import type { LivenessAction } from '../types/domain.js'
import { normalizePhonePH } from '../utils/phone.js'
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
  const user = await getUser(ctx.state.redis, ctx.state.userId!)
  const registeredPhone = user?.phoneAccount ? normalizePhonePH(user.phoneAccount) : null
  const cfg = await getKycStepConfig(ctx.state.redis, ctx.state.env, ctx.state.userId!)
  ok(ctx, {
    ...buildKycStatusResponse(kyc),
    registeredPhone,
    requireDocument: cfg.requireDocument,
    requireFace: cfg.requireFace,
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
    const result = await verifyKycOtp(ctx.state.redis, ctx.state.env, ctx.state.userId!, body.code)
    ok(ctx, result)
  } catch (e) {
    if (!handleKycError(ctx, e)) throw e
  }
})

router.post('/document', async (ctx) => {
  const body = ctx.request.body as { fullName?: string; docType?: string; idImage?: string }
  if (!body.fullName || !body.idImage) {
    fail(ctx, 400, 'fullName and idImage are required')
    return
  }
  try {
    const result = await submitKycDocument(ctx.state.redis, ctx.state.env, ctx.state.userId!, {
      fullName: body.fullName,
      docType: body.docType ?? 'unknown',
      idImage: body.idImage,
    })
    ok(ctx, result)
  } catch (e) {
    if (!handleKycError(ctx, e)) throw e
  }
})

router.post('/face', async (ctx) => {
  const body = ctx.request.body as { frames?: Array<{ action?: string; image?: string }> }
  if (!body.frames?.length) {
    fail(ctx, 400, 'frames is required')
    return
  }
  const frames = body.frames
    .filter((f): f is { action: LivenessAction; image: string } =>
      Boolean(f.action && f.image && ['neutral', 'blink', 'mouth'].includes(f.action)),
    )
  if (frames.length < 3) {
    fail(ctx, 400, '需要 neutral、blink、mouth 三帧')
    return
  }
  try {
    const result = await submitKycFace(ctx.state.redis, ctx.state.env, ctx.state.userId!, frames)
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
    ...buildKycStatusResponse(kyc),
    verifyMode: kyc.verifyMode ?? null,
    submittedAt: kyc.submittedAt || null,
    docSubmittedAt: kyc.docSubmittedAt ?? null,
    faceSubmittedAt: kyc.faceSubmittedAt ?? null,
  })
})

export default router
