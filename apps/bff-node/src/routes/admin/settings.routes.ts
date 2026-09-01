import Router from '@koa/router'
import type { Redis } from 'ioredis'
import { getOpPasswordHash, setOpPassword, getSmsTestMode, setSmsTestMode, getMaintenanceMode, setMaintenanceMode, getAdminSetting, setAdminSetting, writeAuditLog } from '../../services/admin-store.js'
import { hashPassword, verifyPassword } from '../../services/admin-auth.service.js'
import { fail, ok } from '../../utils/response.js'
import { requireRole } from '../../middleware/require-role.js'
import { listSmsSendLogs } from '../../services/sms/send-log.js'
import {
  DEFAULT_SMS_DAILY_IP_LIMIT,
  DEFAULT_SMS_DAILY_LIMIT,
  DEFAULT_KYC_DOC_FAILURE_LIMIT,
  DEFAULT_KYC_FACE_FAILURE_LIMIT,
  DEFAULT_LOGIN_PASSWORD_FAILURE_LIMIT,
  DEFAULT_LOGIN_PASSWORD_LOCK_SECONDS,
  DEFAULT_OTP_LOCK_SECONDS,
  KYC_DOC_FAILURE_LIMIT_KEY,
  KYC_FACE_FAILURE_LIMIT_KEY,
  LOGIN_PASSWORD_FAILURE_LIMIT_KEY,
  LOGIN_PASSWORD_LOCK_SECONDS_KEY,
  OTP_LOCK_SECONDS_KEY,
  SMS_DAILY_IP_LIMIT_KEY,
  SMS_DAILY_LIMIT_KEY,
  getKycDocFailureLimit,
  getKycFaceFailureLimit,
  getLoginPasswordFailureLimit,
  getLoginPasswordLockSeconds,
  getOtpLockSeconds,
  getSmsDailyIpLimit,
  getSmsDailyLimit,
} from '../../services/otp-policy.service.js'
import {
  FEATURE_BONUS_LOCK_ENABLED_KEY,
  FEATURE_BONUS_LOCK_MIN_AMOUNT_KEY,
  FEATURE_BONUS_LOCK_MIN_MULTIPLE_KEY,
  FEATURE_BONUS_LOCK_WAGER_MULT_KEY,
  getFeatureBonusLockConfig,
  syncFeatureBonusLockToRedis,
} from '../../services/feature-bonus-lock.service.js'
import {
  getAllCurrentRates, getRateHistory, setManualRate, clearManualRate, refreshRates, RATE_PAIRS,
} from '../../services/exchange-rate.service.js'
import { getSiteDomainMappings, saveSiteDomainMappings } from '../../services/site-domain.service.js'
import { getRouteHealth } from '../../services/route-health.service.js'

const router = new Router({ prefix: '/settings' })
const WIN568_KEY_AUTO_ROTATION_ENABLED_KEY = 'win568_key_auto_rotation_enabled'

// ── 站点域名映射 ──────────────────────────────────────────────────────────────

router.get('/site-domains', async (ctx) => {
  ok(ctx, await getSiteDomainMappings(ctx.state.redis, ctx.state.env))
})

// 近 24 小时 App 探活结果：成功率骤降通常就是该域名被墙的第一信号
router.get('/site-domains/health', async (ctx) => {
  const market = String(ctx.query.market ?? '').toUpperCase()
  if (market !== 'PH' && market !== 'ID') { fail(ctx, 400, 'market 必须是 PH 或 ID'); return }
  ok(ctx, await getRouteHealth(ctx.state.redis, market))
})

router.put('/site-domains', requireRole('super_admin', 'Only super_admin can manage site domains'), async (ctx) => {
  const body = ctx.request.body as { mappings?: unknown }
  if (!Array.isArray(body.mappings) || body.mappings.length > 100) {
    fail(ctx, 400, 'mappings 必须是最多 100 项的数组'); return
  }
  try {
    const mappings = await saveSiteDomainMappings(ctx.state.redis, ctx.state.env, body.mappings)
    await writeAuditLog(ctx.state.env, {
      adminId: ctx.state.adminId!,
      adminUsername: ctx.state.adminUsername!,
      action: 'site_domain_mappings_update',
      targetType: 'settings',
      targetId: 'site_domain_mappings',
      detail: { mappings },
      ip: ctx.ip,
    })
    ok(ctx, mappings)
  } catch (err) {
    fail(ctx, 400, err instanceof Error ? err.message : '域名配置无效')
  }
})

// 查询操作密码是否已设置（所有管理员均可查）
router.get('/op-password', async (ctx) => {
  const hash = await getOpPasswordHash(ctx.state.env)
  ok(ctx, { configured: hash !== null })
})

// 设置/修改操作密码（仅 super_admin）
router.post('/op-password', requireRole('super_admin', 'Only super_admin can manage the operation password'), async (ctx) => {

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

// ── 全站维护模式 ──────────────────────────────────────────────────────────────

router.get('/maintenance', async (ctx) => {
  const redis = ctx.state.redis as Redis
  const enabled = await getMaintenanceMode(redis, ctx.state.env)
  ok(ctx, { enabled })
})

router.put('/maintenance', requireRole('super_admin', 'Only super_admin can toggle maintenance mode'), async (ctx) => {
  const body = ctx.request.body as { enabled?: unknown }
  if (typeof body.enabled !== 'boolean') {
    fail(ctx, 400, 'enabled must be a boolean'); return
  }
  const redis = ctx.state.redis as Redis
  await setMaintenanceMode(redis, ctx.state.env, body.enabled)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'maintenance_mode_update',
    targetType: 'settings',
    targetId: 'maintenance_mode',
    detail: { enabled: body.enabled },
    ip: ctx.ip,
  })
  ok(ctx, { enabled: body.enabled })
})

// ── 短信测试模式 ──────────────────────────────────────────────────────────────

router.get('/sms', async (ctx) => {
  const redis = ctx.state.redis as Redis
  const testMode = await getSmsTestMode(redis, ctx.state.env)
  ok(ctx, { testMode })
})

router.put('/sms', requireRole('super_admin', 'Only super_admin can manage SMS test mode'), async (ctx) => {
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

// ── 568Win 金钥自动轮换 ─────────────────────────────────────────────────────

router.get('/win568-key-rotation', async (ctx) => {
  const raw = await getAdminSetting(ctx.state.env, WIN568_KEY_AUTO_ROTATION_ENABLED_KEY)
  ok(ctx, { enabled: raw !== '0' })
})

router.put('/win568-key-rotation', requireRole('super_admin', 'Only super_admin can manage 568Win key rotation'), async (ctx) => {
  const body = ctx.request.body as { enabled?: unknown }
  if (typeof body.enabled !== 'boolean') {
    fail(ctx, 400, 'enabled must be a boolean'); return
  }
  await setAdminSetting(ctx.state.env, WIN568_KEY_AUTO_ROTATION_ENABLED_KEY, body.enabled ? '1' : '0')
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'win568_key_rotation_update',
    targetType: 'settings',
    targetId: 'win568_key_rotation',
    detail: { enabled: body.enabled },
    ip: ctx.ip,
  })
  ok(ctx, { enabled: body.enabled })
})

// ── 系统参数 ──────────────────────────────────────────────────────────────────

router.get('/system-params', async (ctx) => {
  const [
    smsDailyLimitPerUser,
    smsDailyLimitPerIp,
    otpLockSeconds,
    kycDocFailureLimit,
    kycFaceFailureLimit,
    loginPasswordFailureLimit,
    loginPasswordLockSeconds,
  ] = await Promise.all([
    getSmsDailyLimit(ctx.state.env),
    getSmsDailyIpLimit(ctx.state.env),
    getOtpLockSeconds(ctx.state.env),
    getKycDocFailureLimit(ctx.state.env),
    getKycFaceFailureLimit(ctx.state.env),
    getLoginPasswordFailureLimit(ctx.state.env),
    getLoginPasswordLockSeconds(ctx.state.env),
  ])
  const featureBonusLock = await getFeatureBonusLockConfig(ctx.state.env)
  ok(ctx, {
    smsDailyLimitPerUser,
    smsDailyLimitPerIp,
    otpLockSeconds,
    kycDocFailureLimit,
    kycFaceFailureLimit,
    loginPasswordFailureLimit,
    loginPasswordLockSeconds,
    featureBonusLockEnabled: featureBonusLock.enabled,
    featureBonusLockMinAmount: featureBonusLock.minAmount,
    featureBonusLockMinMultiple: featureBonusLock.minMultiple,
    featureBonusLockWagerMult: featureBonusLock.wagerMult,
  })
})

router.put('/system-params', requireRole('super_admin', 'Only super_admin can manage system parameters'), async (ctx) => {
  const body = ctx.request.body as {
    smsDailyLimitPerUser?: unknown
    smsDailyLimitPerIp?: unknown
    otpLockSeconds?: unknown
    kycDocFailureLimit?: unknown
    kycFaceFailureLimit?: unknown
    loginPasswordFailureLimit?: unknown
    loginPasswordLockSeconds?: unknown
    featureBonusLockEnabled?: unknown
    featureBonusLockMinAmount?: unknown
    featureBonusLockMinMultiple?: unknown
    featureBonusLockWagerMult?: unknown
  }
  const smsDailyLimitPerUser = Number(body.smsDailyLimitPerUser)
  const smsDailyLimitPerIp = Number(body.smsDailyLimitPerIp)
  const otpLockSeconds = Number(body.otpLockSeconds)
  const kycDocFailureLimit = Number(body.kycDocFailureLimit)
  const kycFaceFailureLimit = Number(body.kycFaceFailureLimit)
  const loginPasswordFailureLimit = Number(body.loginPasswordFailureLimit)
  const loginPasswordLockSeconds = Number(body.loginPasswordLockSeconds)
  if (!Number.isInteger(smsDailyLimitPerUser) || smsDailyLimitPerUser < 1 || smsDailyLimitPerUser > 1000) {
    fail(ctx, 400, 'smsDailyLimitPerUser must be an integer between 1 and 1000'); return
  }
  if (!Number.isInteger(smsDailyLimitPerIp) || smsDailyLimitPerIp < 1 || smsDailyLimitPerIp > 10000) {
    fail(ctx, 400, 'smsDailyLimitPerIp must be an integer between 1 and 10000'); return
  }
  if (!Number.isInteger(otpLockSeconds) || otpLockSeconds < 1 || otpLockSeconds > 3600) {
    fail(ctx, 400, 'otpLockSeconds must be an integer between 1 and 3600'); return
  }
  if (!Number.isInteger(kycDocFailureLimit) || kycDocFailureLimit < 1 || kycDocFailureLimit > 20) {
    fail(ctx, 400, 'kycDocFailureLimit must be an integer between 1 and 20'); return
  }
  if (!Number.isInteger(kycFaceFailureLimit) || kycFaceFailureLimit < 1 || kycFaceFailureLimit > 20) {
    fail(ctx, 400, 'kycFaceFailureLimit must be an integer between 1 and 20'); return
  }
  if (!Number.isInteger(loginPasswordFailureLimit) || loginPasswordFailureLimit < 1 || loginPasswordFailureLimit > 20) {
    fail(ctx, 400, 'loginPasswordFailureLimit must be an integer between 1 and 20'); return
  }
  if (!Number.isInteger(loginPasswordLockSeconds) || loginPasswordLockSeconds < 1 || loginPasswordLockSeconds > 86400) {
    fail(ctx, 400, 'loginPasswordLockSeconds must be an integer between 1 and 86400'); return
  }
  const featureBonusLockEnabled = body.featureBonusLockEnabled === true || body.featureBonusLockEnabled === '1' || body.featureBonusLockEnabled === 1
  const featureBonusLockMinAmount = Number(body.featureBonusLockMinAmount)
  const featureBonusLockMinMultiple = Number(body.featureBonusLockMinMultiple)
  const featureBonusLockWagerMult = Number(body.featureBonusLockWagerMult)
  if (!Number.isFinite(featureBonusLockMinAmount) || featureBonusLockMinAmount < 0 || featureBonusLockMinAmount > 1000000) {
    fail(ctx, 400, 'featureBonusLockMinAmount must be a number between 0 and 1000000'); return
  }
  if (!Number.isFinite(featureBonusLockMinMultiple) || featureBonusLockMinMultiple < 1 || featureBonusLockMinMultiple > 100000) {
    fail(ctx, 400, 'featureBonusLockMinMultiple must be a number between 1 and 100000'); return
  }
  if (!Number.isFinite(featureBonusLockWagerMult) || featureBonusLockWagerMult < 0 || featureBonusLockWagerMult > 100) {
    fail(ctx, 400, 'featureBonusLockWagerMult must be a number between 0 and 100'); return
  }
  await setAdminSetting(ctx.state.env, SMS_DAILY_LIMIT_KEY, String(smsDailyLimitPerUser || DEFAULT_SMS_DAILY_LIMIT))
  await setAdminSetting(ctx.state.env, SMS_DAILY_IP_LIMIT_KEY, String(smsDailyLimitPerIp || DEFAULT_SMS_DAILY_IP_LIMIT))
  await setAdminSetting(ctx.state.env, OTP_LOCK_SECONDS_KEY, String(otpLockSeconds || DEFAULT_OTP_LOCK_SECONDS))
  await setAdminSetting(ctx.state.env, KYC_DOC_FAILURE_LIMIT_KEY, String(kycDocFailureLimit || DEFAULT_KYC_DOC_FAILURE_LIMIT))
  await setAdminSetting(ctx.state.env, KYC_FACE_FAILURE_LIMIT_KEY, String(kycFaceFailureLimit || DEFAULT_KYC_FACE_FAILURE_LIMIT))
  await setAdminSetting(ctx.state.env, LOGIN_PASSWORD_FAILURE_LIMIT_KEY, String(loginPasswordFailureLimit || DEFAULT_LOGIN_PASSWORD_FAILURE_LIMIT))
  await setAdminSetting(ctx.state.env, LOGIN_PASSWORD_LOCK_SECONDS_KEY, String(loginPasswordLockSeconds || DEFAULT_LOGIN_PASSWORD_LOCK_SECONDS))
  await setAdminSetting(ctx.state.env, FEATURE_BONUS_LOCK_ENABLED_KEY, featureBonusLockEnabled ? '1' : '0')
  await setAdminSetting(ctx.state.env, FEATURE_BONUS_LOCK_MIN_AMOUNT_KEY, String(featureBonusLockMinAmount))
  await setAdminSetting(ctx.state.env, FEATURE_BONUS_LOCK_MIN_MULTIPLE_KEY, String(featureBonusLockMinMultiple))
  await setAdminSetting(ctx.state.env, FEATURE_BONUS_LOCK_WAGER_MULT_KEY, String(featureBonusLockWagerMult))
  // 镜像到 Redis 供 core-node 派彩回调即时读取
  await syncFeatureBonusLockToRedis(ctx.state.env, ctx.state.redis)
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'system_params_update',
    targetType: 'settings',
    targetId: 'system_params',
    detail: {
      smsDailyLimitPerUser,
      smsDailyLimitPerIp,
      otpLockSeconds,
      kycDocFailureLimit,
      kycFaceFailureLimit,
      loginPasswordFailureLimit,
      loginPasswordLockSeconds,
      featureBonusLockEnabled,
      featureBonusLockMinAmount,
      featureBonusLockMinMultiple,
      featureBonusLockWagerMult,
    },
    ip: ctx.ip,
  })
  ok(ctx, {
    smsDailyLimitPerUser,
    smsDailyLimitPerIp,
    otpLockSeconds,
    kycDocFailureLimit,
    kycFaceFailureLimit,
    loginPasswordFailureLimit,
    loginPasswordLockSeconds,
    featureBonusLockEnabled,
    featureBonusLockMinAmount,
    featureBonusLockMinMultiple,
    featureBonusLockWagerMult,
  })
})

// ── KYC 手机/证件/人脸验证开关 ────────────────────────────────────────────────

router.get('/kyc', async (ctx) => {
  const [phone, doc, face, threshold] = await Promise.all([
    getAdminSetting(ctx.state.env, 'kyc_require_phone'),
    getAdminSetting(ctx.state.env, 'kyc_require_document'),
    getAdminSetting(ctx.state.env, 'kyc_require_face'),
    getAdminSetting(ctx.state.env, 'kyc_face_match_threshold'),
  ])
  const requireDocument = doc !== '0'
  const parsed = threshold != null ? Number(threshold) : NaN
  const faceMatchThreshold = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : ctx.state.env.KYC_FACE_MATCH_MIN
  ok(ctx, { requirePhone: phone !== '0', requireDocument, requireFace: requireDocument && face !== '0', faceMatchThreshold })
})

router.put('/kyc', requireRole('super_admin', 'Only super_admin can manage KYC verification settings'), async (ctx) => {
  const body = ctx.request.body as { requirePhone?: unknown; requireDocument?: unknown; requireFace?: unknown; faceMatchThreshold?: unknown }
  if (typeof body.requirePhone !== 'boolean' || typeof body.requireDocument !== 'boolean' || typeof body.requireFace !== 'boolean') {
    fail(ctx, 400, 'requirePhone, requireDocument and requireFace must be booleans'); return
  }
  // 人脸验证需证件照比对，证件关闭时人脸强制关闭
  const requireDocument = body.requireDocument
  const requireFace = requireDocument && body.requireFace
  await setAdminSetting(ctx.state.env, 'kyc_require_phone', body.requirePhone ? '1' : '0')
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
    detail: { requirePhone: body.requirePhone, requireDocument, requireFace, faceMatchThreshold },
    ip: ctx.ip,
  })
  ok(ctx, { requirePhone: body.requirePhone, requireDocument, requireFace, faceMatchThreshold })
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
router.post('/exchange-rates/manual', requireRole(['super_admin', 'finance']), async (ctx) => {
  const body = ctx.request.body as { from?: string; to?: string; rate?: unknown }
  const from = String(body.from ?? '').toUpperCase()
  const to = String(body.to ?? '').toUpperCase()
  const rate = Number(body.rate)
  if (!from || !to || isNaN(rate) || rate <= 0) {
    fail(ctx, 400, 'from / to / rate 参数无效'); return
  }
  if (!RATE_PAIRS.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to)) {
    fail(ctx, 400, '不支持的基础汇率对'); return
  }
  const redis = ctx.state.redis as Redis
  const result = await setManualRate(redis, from, to, rate, ctx.state.env)
  ok(ctx, result)
})

// 清除手动汇率（恢复 API 自动获取）
router.delete('/exchange-rates/manual/:from/:to', requireRole(['super_admin', 'finance']), async (ctx) => {
  const from = ctx.params.from.toUpperCase()
  const to = ctx.params.to.toUpperCase()
  if (!RATE_PAIRS.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to)) {
    fail(ctx, 400, '不支持的基础汇率对'); return
  }
  const redis = ctx.state.redis as Redis
  await clearManualRate(redis, from, to)
  ok(ctx, null)
})

export default router
