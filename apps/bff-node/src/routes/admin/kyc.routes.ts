import Router from '@koa/router'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { getKyc } from '../../services/store/index.js'
import { KycError, adminReviewKyc, buildKycStatusResponse } from '../../services/kyc.service.js'
import { ensureBirthdayFromKyc } from '../../services/vip.service.js'
import { getStorageProvider } from '../../services/storage/index.js'
import { broadcastBadges } from '../../services/sse-badges.js'
import { writeAuditLog } from '../../services/admin-store.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/kyc' })

router.get('/', async (ctx) => {
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(1000, Math.max(10, Number(ctx.query.pageSize ?? 20)))
  const status = ctx.query.status ? String(ctx.query.status) : undefined
  const offset = (page - 1) * pageSize

  const db = getMysqlPool(ctx.state.env)
  const where: string[] = []
  const params: unknown[] = []
  if (status) {
    where.push('k.status = ?')
    params.push(status)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const [[{ total }]] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_kyc k ${whereSql}`,
    params,
  )
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT k.user_id, k.status, k.phone, k.full_name, k.doc_type,
            k.phone_verified, k.doc_verified, k.face_verified,
            k.submitted_at, k.doc_submitted_at, k.face_submitted_at, k.reviewed_at,
            u.display_name
     FROM bg_kyc k
     LEFT JOIN bg_user u ON u.id = k.user_id
     ${whereSql}
     ORDER BY COALESCE(k.face_submitted_at, k.doc_submitted_at, k.submitted_at) DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  ok(ctx, {
    total: Number(total),
    page,
    pageSize,
    items: rows.map((r) => ({
      userId: r.user_id as string,
      displayName: (r.display_name as string) ?? null,
      status: r.status as string,
      phone: (r.phone as string) ?? null,
      fullName: (r.full_name as string) ?? null,
      docType: (r.doc_type as string) ?? null,
      phoneVerified: Boolean(r.phone_verified),
      docVerified: Boolean(r.doc_verified),
      faceVerified: Boolean(r.face_verified),
      submittedAt: r.submitted_at ? new Date(r.submitted_at as Date).toISOString() : null,
      docSubmittedAt: r.doc_submitted_at ? new Date(r.doc_submitted_at as Date).toISOString() : null,
      faceSubmittedAt: r.face_submitted_at ? new Date(r.face_submitted_at as Date).toISOString() : null,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at as Date).toISOString() : null,
    })),
  })
})

// 用户证件提交历史
router.get('/:userId/doc-log', async (ctx) => {
  const db = getMysqlPool(ctx.state.env)
  const [rows] = await db.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT id, full_name, doc_type, doc_image_key, gemini_confidence, doc_verified, reject_reason, submitted_at
     FROM bg_kyc_doc_log WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 50`,
    [ctx.params.userId],
  )
  ok(ctx, {
    items: rows.map((r) => ({
      id: Number(r.id),
      fullName: (r.full_name as string) ?? null,
      docType: (r.doc_type as string) ?? null,
      docImageKey: (r.doc_image_key as string) ?? null,
      geminiConfidence: r.gemini_confidence != null ? Number(r.gemini_confidence) : null,
      docVerified: Boolean(r.doc_verified),
      rejectReason: (r.reject_reason as string) ?? null,
      submittedAt: new Date(r.submitted_at as Date).toISOString(),
    })),
  })
})

router.get('/:userId/images/:key', async (ctx) => {
  const key = decodeURIComponent(ctx.params.key)
  if (key.includes('..') || key.startsWith('/')) {
    fail(ctx, 400, 'Invalid image key')
    return
  }

  const kyc = await getKyc(ctx.state.redis, ctx.params.userId)
  if (!kyc) {
    fail(ctx, 404, 'KYC record not found', 404)
    return
  }

  const allowedKeys = new Set<string>()
  if (kyc.docImageKey) allowedKeys.add(kyc.docImageKey)
  if (kyc.selfieImageKey) allowedKeys.add(kyc.selfieImageKey)
  for (const frame of kyc.livenessFrames ?? []) {
    allowedKeys.add(frame.key)
  }
  if (!allowedKeys.has(key)) {
    fail(ctx, 403, 'Image not found for this user', 403)
    return
  }

  const file = await getStorageProvider(ctx.state.env).get(key)
  if (!file) {
    fail(ctx, 404, 'Image file not found', 404)
    return
  }

  ctx.set('Content-Type', file.mimeType)
  ctx.set('Cache-Control', 'private, max-age=3600')
  ctx.body = file.data
})

router.get('/:userId', async (ctx) => {
  const kyc = await getKyc(ctx.state.redis, ctx.params.userId)
  if (!kyc) {
    fail(ctx, 404, 'KYC record not found', 404)
    return
  }

  const db = getMysqlPool(ctx.state.env)
  const [[user]] = await db.query<RowDataPacket[]>(
    `SELECT id, display_name, status FROM bg_user WHERE id = ? LIMIT 1`,
    [ctx.params.userId],
  )

  ok(ctx, {
    user: user ? {
      id: user.id as string,
      displayName: (user.display_name as string) ?? null,
      status: user.status as string,
    } : null,
    kyc: {
      ...buildKycStatusResponse(kyc),
      extractedIdNo: kyc.extractedIdNo ?? null,
      geminiConfidence: kyc.geminiConfidence ?? null,
      geminiResult: kyc.geminiResult ?? null,
      docImageKey: kyc.docImageKey ?? null,
      livenessFrames: kyc.livenessFrames ?? null,
      docSubmittedAt: kyc.docSubmittedAt ?? null,
      faceSubmittedAt: kyc.faceSubmittedAt ?? null,
      reviewedAt: kyc.reviewedAt ?? null,
      reviewedBy: kyc.reviewedBy ?? null,
      submittedAt: kyc.submittedAt || null,
      badgeIgnored: kyc.badgeIgnored ?? false,
    },
  })
})

async function review(ctx: import('koa').Context, decision: 'approved' | 'rejected') {
  const body = (ctx.request.body ?? {}) as { note?: string }
  try {
    const status = await adminReviewKyc(
      ctx.state.redis,
      ctx.params.userId,
      decision,
      ctx.state.adminUsername!,
      body.note,
    )
    broadcastBadges(ctx.state.env).catch(() => {})
    if (status === 'approved') {
      ensureBirthdayFromKyc(ctx.state.env, ctx.params.userId).catch((e) => console.error('[admin-kyc] sync birthday failed:', e))
    }
    ok(ctx, { status })
  } catch (e) {
    if (e instanceof KycError) {
      fail(ctx, e.status, e.message, e.status)
      return
    }
    throw e
  }
}

router.post('/:userId/approve', (ctx) => review(ctx, 'approved'))
router.post('/:userId/reject', (ctx) => review(ctx, 'rejected'))

// 忽略某被拒认证的气泡提醒：不再计入红点，用户重新提交时会自动恢复提醒
router.post('/:userId/ignore', async (ctx) => {
  const userId = ctx.params.userId
  const [res] = await getMysqlPool(ctx.state.env).execute<ResultSetHeader>(
    `UPDATE bg_kyc SET badge_ignored = 1 WHERE user_id = ? AND status = 'rejected'`,
    [userId],
  )
  if (res.affectedRows === 0) { fail(ctx, 404, '无可忽略的被拒认证', 404); return }
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'kyc.badge_ignore', targetType: 'kyc', targetId: userId,
    detail: {}, ip: ctx.ip,
  })
  broadcastBadges(ctx.state.env).catch(() => {})
  ok(ctx, { ignored: true })
})

export default router
