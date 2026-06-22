import Router from '@koa/router'
import type { Redis } from 'ioredis'
import { getOpPasswordHash, setOpPassword, getSmsTestMode, setSmsTestMode, getAdminSetting, setAdminSetting, writeAuditLog } from '../../services/admin-store.js'
import { hashPassword, verifyPassword } from '../../services/admin-auth.service.js'
import { fail, ok } from '../../utils/response.js'
import { listSmsSendLogs } from '../../services/sms/send-log.js'
import {
  getAllCurrentRates, getRateHistory, setManualRate, clearManualRate, refreshRates,
} from '../../services/exchange-rate.service.js'

const router = new Router({ prefix: '/settings' })

// 查询操作密码是否已设置（所有管理员均可查）
router.get('/op-password', async (ctx) => {
  const hash = await getOpPasswordHash(ctx.state.env)
  ok(ctx, { configured: hash !== null })
})

// 设置/修改操作密码（仅 super_admin）
router.post('/op-password', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') {
    fail(ctx, 403, 'Only super_admin can manage the operation password'); return
  }

  const body = ctx.request.body as { newPassword?: string; currentPassword?: string }
  if (!body.newPassword || body.newPassword.length < 6) {
    fail(ctx, 400, 'newPassword must be at least 6 characters'); return
  }

  const existing = await getOpPasswordHash(ctx.state.env)
  if (existing) {
    // 已设置过，需验证旧密码
    if (!body.currentPassword) {
      fail(ctx, 400, 'currentPassword is required to change existing op password'); return
    }
    const valid = await verifyPassword(body.currentPassword, existing)
    if (!valid) {
      fail(ctx, 400, 'currentPassword is incorrect'); return
    }
  }

  const newHash = await hashPassword(body.newPassword)
  await setOpPassword(ctx.state.env, newHash)
  ok(ctx, null)
})

// ── 短信测试模式 ──────────────────────────────────────────────────────────────

router.get('/sms', async (ctx) => {
  const redis = ctx.state.redis as Redis
  const testMode = await getSmsTestMode(redis, ctx.state.env)
  ok(ctx, { testMode })
})

router.put('/sms', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') {
    fail(ctx, 403, 'Only super_admin can manage SMS test mode'); return
  }
  const body = ctx.request.body as { testMode?: unknown }
  if (typeof body.testMode !== 'boolean') {
    fail(ctx, 400, 'testMode must be a boolean'); return
  }
  const redis = ctx.state.redis as Redis
  await setSmsTestMode(redis, ctx.state.env, body.testMode)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'sms_test_mode_update',
    targetType: 'settings',
    targetId: 'sms_test_mode',
    detail: { testMode: body.testMode },
    ip: ctx.ip,
  })
  ok(ctx, { testMode: body.testMode })
})

router.get('/sms/logs', async (ctx) => {
  const redis = ctx.state.redis as Redis
  const logs = await listSmsSendLogs(redis)
  ok(ctx, logs)
})

// ── KYC 证件/人脸验证开关 ─────────────────────────────────────────────────────

router.get('/kyc', async (ctx) => {
  const [doc, face, threshold] = await Promise.all([
    getAdminSetting(ctx.state.env, 'kyc_require_document'),
    getAdminSetting(ctx.state.env, 'kyc_require_face'),
    getAdminSetting(ctx.state.env, 'kyc_face_match_threshold'),
  ])
  const requireDocument = doc !== '0'
  const parsed = threshold != null ? Number(threshold) : NaN
  const faceMatchThreshold = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : ctx.state.env.KYC_FACE_MATCH_MIN
  ok(ctx, { requireDocument, requireFace: requireDocument && face !== '0', faceMatchThreshold })
})

router.put('/kyc', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') {
    fail(ctx, 403, 'Only super_admin can manage KYC verification settings'); return
  }
  const body = ctx.request.body as { requireDocument?: unknown; requireFace?: unknown; faceMatchThreshold?: unknown }
  if (typeof body.requireDocument !== 'boolean' || typeof body.requireFace !== 'boolean') {
    fail(ctx, 400, 'requireDocument and requireFace must be booleans'); return
  }
  // 人脸验证需证件照比对，证件关闭时人脸强制关闭
  const requireDocument = body.requireDocument
  const requireFace = requireDocument && body.requireFace
  await setAdminSetting(ctx.state.env, 'kyc_require_document', requireDocument ? '1' : '0')
  await setAdminSetting(ctx.state.env, 'kyc_require_face', requireFace ? '1' : '0')

  let faceMatchThreshold = ctx.state.env.KYC_FACE_MATCH_MIN
  if (body.faceMatchThreshold !== undefined) {
    const n = Number(body.faceMatchThreshold)
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      fail(ctx, 400, 'faceMatchThreshold must be a number between 0 and 1'); return
    }
    faceMatchThreshold = n
    await setAdminSetting(ctx.state.env, 'kyc_face_match_threshold', String(n))
  }
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'kyc_steps_update',
    targetType: 'settings',
    targetId: 'kyc_steps',
    detail: { requireDocument, requireFace, faceMatchThreshold },
    ip: ctx.ip,
  })
  ok(ctx, { requireDocument, requireFace, faceMatchThreshold })
})

// ── 汇率管理 ──────────────────────────────────────────────────────────────────

// 查询所有汇率对的当前状态
router.get('/exchange-rates', async (ctx) => {
  const redis = ctx.state.redis as Redis
  const rates = await getAllCurrentRates(redis, ctx.state.env)
  ok(ctx, rates)
})

// 汇率历史记录（最近 1000 条原始记录，按批次分组）
router.get('/exchange-rates/history', async (ctx) => {
  const history = await getRateHistory(ctx.state.env, 1000)
  ok(ctx, history)
})

// 手动触发 API 刷新（不覆盖 manual 来源）
router.post('/exchange-rates/refresh', async (ctx) => {
  const redis = ctx.state.redis as Redis
  await refreshRates(redis, ctx.state.env)
  const rates = await getAllCurrentRates(redis, ctx.state.env)
  ok(ctx, rates)
})

// 设置手动汇率（super_admin 或 finance 可操作）
router.post('/exchange-rates/manual', async (ctx) => {
  const role = ctx.state.adminRole as string
  if (role !== 'super_admin' && role !== 'finance') {
    fail(ctx, 403, '无操作权限'); return
  }
  const body = ctx.request.body as { from?: string; to?: string; rate?: unknown }
  const from = String(body.from ?? '').toUpperCase()
  const to = String(body.to ?? '').toUpperCase()
  const rate = Number(body.rate)
  if (!from || !to || isNaN(rate) || rate <= 0) {
    fail(ctx, 400, 'from / to / rate 参数无效'); return
  }
  const redis = ctx.state.redis as Redis
  const result = await setManualRate(redis, from, to, rate, ctx.state.env)
  ok(ctx, result)
})

// 清除手动汇率（恢复 API 自动获取）
router.delete('/exchange-rates/manual/:from/:to', async (ctx) => {
  const role = ctx.state.adminRole as string
  if (role !== 'super_admin' && role !== 'finance') {
    fail(ctx, 403, '无操作权限'); return
  }
  const from = ctx.params.from.toUpperCase()
  const to = ctx.params.to.toUpperCase()
  const redis = ctx.state.redis as Redis
  await clearManualRate(redis, from, to)
  ok(ctx, null)
})

export default router
