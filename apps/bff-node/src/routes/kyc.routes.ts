import Router from '@koa/router'
import { getKyc, saveKyc } from '../services/store.js'
import { nowIso } from '../utils/format.js'
import { fail, ok } from '../utils/response.js'
import type { KycSubmission } from '../types/domain.js'

const router = new Router({ prefix: '/kyc' })

router.get('/status', async (ctx) => {
  const kyc = await getKyc(ctx.state.redis, ctx.state.userId!)
  ok(ctx, {
    status: kyc?.status ?? 'none',
    rejectReason: kyc?.rejectReason ?? null,
  })
})

router.post('/documents/upload-url', async (ctx) => {
  const body = ctx.request.body as { docType?: string; mimeType?: string }
  ok(ctx, {
    uploadUrl: `https://storage.example.com/kyc/${ctx.state.userId}/${body.docType ?? 'id'}`,
    uploadToken: `mock_token_${Date.now()}`,
    expiresIn: 900,
    mimeType: body.mimeType ?? 'image/jpeg',
  })
})

router.post('/submissions', async (ctx) => {
  const body = ctx.request.body as {
    fullName?: string
    gender?: string
    dob?: string
    docType?: string
    fileIds?: string[]
  }
  if (!body.fullName) {
    fail(ctx, 400, 'fullName is required')
    return
  }

  const submission: KycSubmission = {
    submissionId: `KYC_${Date.now()}`,
    userId: ctx.state.userId!,
    status: 'approved',
    fullName: body.fullName,
    gender: body.gender ?? '',
    dob: body.dob ?? '',
    docType: body.docType,
    fileIds: body.fileIds,
    submittedAt: nowIso(),
  }
  await saveKyc(ctx.state.redis, submission)
  ok(ctx, { submissionId: submission.submissionId, status: submission.status })
})

router.get('/submissions/latest', async (ctx) => {
  const kyc = await getKyc(ctx.state.redis, ctx.state.userId!)
  if (!kyc) {
    ok(ctx, null)
    return
  }
  ok(ctx, kyc)
})

export default router
