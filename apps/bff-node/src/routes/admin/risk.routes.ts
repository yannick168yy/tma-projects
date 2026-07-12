import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { ok, fail } from '../../utils/response.js'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import { writeAuditLog } from '../../services/admin-store.js'
import { requireRole } from '../../middleware/require-role.js'

const router = new Router({ prefix: '/risk' })

const RISK_ACTIONS = ['tag_only', 'limit', 'deny', 'escalate']

export const TAG_META: Record<string, { name: string; desc: string }> = {
  'risk.bonus_abuse':   { name: '薅优惠党', desc: '累计彩金 ÷ 净充值 ≥ 阈值，且已发生过成功提现。未提现不计——钱还在站内，尚未造成损失。' },
  'risk.multi_account': { name: '多账户农场', desc: '同一 device_id 关联的账号数 ≥ 阈值。同 IP 不计入——NAT 与网吧下同 IP 是常态。' },
}

function db(ctx: import('koa').Context) {
  if (!isMysqlEnabled(ctx.state.env)) { fail(ctx, 503, 'DB not available'); return null }
  return getMysqlPool(ctx.state.env)
}

// 风险总览：标签分布 + 近 24h 命中动作分布。影子模式期靠这里评估误报率。
router.get('/overview', async (ctx) => {
  const pool = db(ctx); if (!pool) return
  const [tagRows] = await pool.query<RowDataPacket[]>(
    `SELECT tag_code, source, COUNT(*) cnt FROM bg_user_tag GROUP BY tag_code, source`,
  )
  const [hitRows] = await pool.query<RowDataPacket[]>(
    `SELECT checkpoint, action, COUNT(*) cnt FROM bg_risk_hit_log
      WHERE created_at >= DATE_SUB(NOW(3), INTERVAL 24 HOUR)
      GROUP BY checkpoint, action`,
  )
  const [[scored]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) total, SUM(risk_score >= 50) highRisk FROM bg_user_risk_signal`,
  )
  ok(ctx, {
    tags: tagRows.map((r) => ({ tagCode: String(r.tag_code), source: String(r.source), count: Number(r.cnt) })),
    hits24h: hitRows.map((r) => ({ checkpoint: String(r.checkpoint), action: String(r.action), count: Number(r.cnt) })),
    profiledUsers: Number(scored?.total ?? 0),
    highRiskUsers: Number(scored?.highRisk ?? 0),
    tagMeta: TAG_META,
  })
})

// 用户风险画像列表
router.get('/users', async (ctx) => {
  const pool = db(ctx); if (!pool) return
  const tag = String(ctx.query.tag ?? '').trim()
  const userId = String(ctx.query.userId ?? '').trim()
  const minScore = Number(ctx.query.minScore ?? 0)
  const minDeviceShared = Number(ctx.query.minDeviceShared ?? 0)
  const minBonusRatio = Number(ctx.query.minBonusRatio ?? 0)
  const limit = Math.min(200, Math.max(1, Number(ctx.query.limit ?? 50)))

  const where: string[] = ['s.risk_score >= ?']
  const params: unknown[] = [Number.isFinite(minScore) ? minScore : 0]
  if (userId) { where.push('s.user_id LIKE ?'); params.push(`%${userId}%`) }
  if (Number.isFinite(minDeviceShared) && minDeviceShared > 0) { where.push('s.device_shared_users >= ?'); params.push(minDeviceShared) }
  if (Number.isFinite(minBonusRatio) && minBonusRatio > 0) { where.push('s.bonus_ratio >= ?'); params.push(minBonusRatio) }
  if (tag) { where.push('EXISTS (SELECT 1 FROM bg_user_tag t2 WHERE t2.user_id = s.user_id AND t2.tag_code = ?)'); params.push(tag) }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.user_id, s.bonus_total, s.net_deposit, s.bonus_ratio, s.withdraw_count,
            s.device_shared_users, s.ip_shared_users, s.risk_score, s.computed_at,
            GROUP_CONCAT(CONCAT(t.tag_code, ':', t.source)) tags
       FROM bg_user_risk_signal s
       LEFT JOIN bg_user_tag t ON t.user_id = s.user_id
      WHERE ${where.join(' AND ')}
      GROUP BY s.user_id
      ORDER BY s.risk_score DESC, s.bonus_ratio DESC
      LIMIT ?`,
    [...params, limit],
  )
  ok(ctx, {
    items: rows.map((r) => ({
      userId: String(r.user_id),
      bonusTotal: Number(r.bonus_total),
      netDeposit: Number(r.net_deposit),
      bonusRatio: Number(r.bonus_ratio),
      withdrawCount: Number(r.withdraw_count),
      deviceSharedUsers: Number(r.device_shared_users),
      ipSharedUsers: Number(r.ip_shared_users),
      riskScore: Number(r.risk_score),
      computedAt: r.computed_at,
      tags: r.tags ? String(r.tags).split(',').map((s) => { const [tagCode, source] = s.split(':'); return { tagCode, source } }) : [],
    })),
  })
})

// 单用户详情：信号 + 标签（含 evidence）+ 最近命中。运营复核与用户申诉都看这里。
router.get('/users/:id', async (ctx) => {
  const pool = db(ctx); if (!pool) return
  const userId = ctx.params.id
  const [[signal]] = await pool.query<RowDataPacket[]>('SELECT * FROM bg_user_risk_signal WHERE user_id = ?', [userId])
  const [tags] = await pool.query<RowDataPacket[]>(
    'SELECT tag_code, source, confidence, evidence, assigned_by, created_at FROM bg_user_tag WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  )
  const [hits] = await pool.query<RowDataPacket[]>(
    `SELECT checkpoint, rule_code, action, matched_value, detail, ip, device_id, created_at
       FROM bg_risk_hit_log WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
    [userId],
  )
  ok(ctx, {
    signal: signal
      ? {
          userId, bonusTotal: Number(signal.bonus_total), netDeposit: Number(signal.net_deposit),
          bonusRatio: Number(signal.bonus_ratio), withdrawCount: Number(signal.withdraw_count),
          deviceSharedUsers: Number(signal.device_shared_users), ipSharedUsers: Number(signal.ip_shared_users),
          riskScore: Number(signal.risk_score), computedAt: signal.computed_at,
        }
      : null,
    tags: tags.map((t) => ({
      tagCode: String(t.tag_code), source: String(t.source), confidence: Number(t.confidence),
      evidence: t.evidence, assignedBy: t.assigned_by, createdAt: t.created_at,
    })),
    hits: hits.map((h) => ({
      checkpoint: String(h.checkpoint), ruleCode: String(h.rule_code), action: String(h.action),
      matchedValue: h.matched_value, detail: h.detail, ip: h.ip, deviceId: h.device_id, createdAt: h.created_at,
    })),
    tagMeta: TAG_META,
  })
})

// 人工打标：source=manual 后跑批不再覆盖它的 confidence/evidence，也不会撤销它
router.post('/users/:id/tags', requireRole('super_admin', '仅超级管理员可管理用户标签'), async (ctx) => {
  const pool = db(ctx); if (!pool) return
  const userId = ctx.params.id
  const body = ctx.request.body as { tagCode?: string; reason?: string }
  const tagCode = String(body.tagCode ?? '').trim()
  if (!tagCode) { fail(ctx, 400, 'tagCode is required'); return }

  await pool.execute(
    `INSERT INTO bg_user_tag (user_id, tag_code, source, confidence, evidence, assigned_by)
     VALUES (?, ?, 'manual', 100, ?, ?)
     ON DUPLICATE KEY UPDATE
       source = 'manual', confidence = 100, evidence = VALUES(evidence), assigned_by = VALUES(assigned_by)`,
    [userId, tagCode, JSON.stringify({ reason: body.reason ?? '' }), ctx.state.adminUsername ?? null],
  )
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'risk.tag.add', targetType: 'user', targetId: userId,
    detail: { tagCode, reason: body.reason }, ip: ctx.ip,
  })
  ok(ctx, { added: true })
})

// 移除标签。撤销的是自动标时，下次跑批若仍命中会重新生成——
// 要永久推翻误报，应先修规则阈值，或把该标改判为人工标后再处理。
router.delete('/users/:id/tags/:code', requireRole('super_admin', '仅超级管理员可管理用户标签'), async (ctx) => {
  const pool = db(ctx); if (!pool) return
  const { id: userId, code } = ctx.params
  await pool.execute('DELETE FROM bg_user_tag WHERE user_id = ? AND tag_code = ?', [userId, code])
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'risk.tag.remove', targetType: 'user', targetId: userId,
    detail: { tagCode: code }, ip: ctx.ip,
  })
  ok(ctx, { removed: true })
})

router.get('/policies', async (ctx) => {
  const pool = db(ctx); if (!pool) return
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT checkpoint, rule_code, action, enabled, params, updated_at FROM bg_risk_policy ORDER BY checkpoint, rule_code',
  )
  ok(ctx, {
    items: rows.map((r) => ({
      checkpoint: String(r.checkpoint), ruleCode: String(r.rule_code), action: String(r.action),
      enabled: Boolean(r.enabled), params: r.params, updatedAt: r.updated_at,
    })),
    actions: RISK_ACTIONS,
  })
})

// 影子模式转正式拦截的开关就在这里：把 action 从 tag_only 改成 deny/escalate
router.put('/policies', requireRole('super_admin', '仅超级管理员可修改风控策略'), async (ctx) => {
  const pool = db(ctx); if (!pool) return
  const body = ctx.request.body as { items?: Array<{ checkpoint: string; ruleCode: string; action: string; enabled: boolean; params?: unknown }> }
  const items = body.items ?? []
  if (items.some((i) => !RISK_ACTIONS.includes(i.action))) { fail(ctx, 400, 'invalid action'); return }

  for (const item of items) {
    await pool.execute(
      `UPDATE bg_risk_policy SET action = ?, enabled = ?, params = ? WHERE checkpoint = ? AND rule_code = ?`,
      [item.action, item.enabled ? 1 : 0, item.params ? JSON.stringify(item.params) : null, item.checkpoint, item.ruleCode],
    )
  }
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!,
    action: 'risk.policy.update', targetType: 'policy', targetId: 'risk',
    detail: { count: items.length }, ip: ctx.ip,
  })
  ok(ctx, { updated: items.length })
})

router.get('/hits', async (ctx) => {
  const pool = db(ctx); if (!pool) return
  const checkpoint = String(ctx.query.checkpoint ?? '').trim()
  const action = String(ctx.query.action ?? '').trim()
  const limit = Math.min(500, Math.max(1, Number(ctx.query.limit ?? 100)))

  const where: string[] = ['1 = 1']
  const params: unknown[] = []
  if (checkpoint) { where.push('checkpoint = ?'); params.push(checkpoint) }
  if (action) { where.push('action = ?'); params.push(action) }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, checkpoint, rule_code, action, matched_value, detail, ip, device_id, created_at
       FROM bg_risk_hit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
    [...params, limit],
  )
  ok(ctx, {
    items: rows.map((r) => ({
      id: Number(r.id), userId: r.user_id, checkpoint: String(r.checkpoint), ruleCode: String(r.rule_code),
      action: String(r.action), matchedValue: r.matched_value, detail: r.detail,
      ip: r.ip, deviceId: r.device_id, createdAt: r.created_at,
    })),
  })
})

export default router
