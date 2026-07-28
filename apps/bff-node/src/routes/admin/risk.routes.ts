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

// 投放渠道套利客统计（只读，实时计算，支持按天刷新）。
// 口径：设备指纹(device_id 或硬件fp)被≥3账号共用=套利铁证；同IP≥5且无设备信号=疑似(IP噪声大不并入)；
// 关联范围=全站全时段(抓团伙老主号)，人群=当天带投放归因的注册；已剔除风控白名单登记的测试机账号。
// 与 scripts/farm-by-channel.sql 同源，改这里请同步那份。
const FARM_CTE = `
WITH
wl_dev  AS (SELECT value FROM bg_promo_claim_whitelist WHERE type='device'),
wl_ip   AS (SELECT value FROM bg_promo_claim_whitelist WHERE type='ip'),
wl_user AS (SELECT value FROM bg_promo_claim_whitelist WHERE type='user'),
wl_acct AS (
  SELECT DISTINCT user_id FROM bg_login_log
    WHERE device_id IN (SELECT value FROM wl_dev) OR fp_visitor IN (SELECT value FROM wl_dev)
  UNION SELECT id FROM bg_user WHERE register_device_id IN (SELECT value FROM wl_dev)
  UNION SELECT value FROM wl_user
),
pop AS (
  SELECT a.user_id,
         COALESCE(NULLIF(a.channel_code,''), NULLIF(a.utm_source,''), a.click_platform) AS channel
  FROM bg_user_attribution a
  WHERE a.created_at >= CONCAT(?, ' 00:00:00') AND a.created_at < CONCAT(?, ' 00:00:00') + INTERVAL 1 DAY
    AND (a.channel_code IS NOT NULL OR a.click_platform <> 'other')
    AND a.user_id NOT IN (SELECT user_id FROM wl_acct)
),
ud AS (
  SELECT user_id, device_id FROM bg_login_log
    WHERE device_id<>'' AND device_id IS NOT NULL
      AND device_id NOT IN (SELECT value FROM wl_dev) AND user_id NOT IN (SELECT user_id FROM wl_acct)
  UNION
  SELECT id, register_device_id FROM bg_user
    WHERE register_device_id<>'' AND register_device_id IS NOT NULL
      AND register_device_id NOT IN (SELECT value FROM wl_dev) AND id NOT IN (SELECT user_id FROM wl_acct)
),
dc AS (SELECT device_id, COUNT(DISTINCT user_id) n FROM ud GROUP BY device_id),
uf AS (
  SELECT DISTINCT user_id, fp_visitor FROM bg_login_log
    WHERE fp_visitor<>'' AND fp_visitor IS NOT NULL
      AND fp_visitor NOT IN (SELECT value FROM wl_dev) AND user_id NOT IN (SELECT user_id FROM wl_acct)
),
fc AS (SELECT fp_visitor, COUNT(DISTINCT user_id) n FROM uf GROUP BY fp_visitor),
ui AS (
  SELECT user_id, ip FROM bg_login_log
    WHERE ip<>'' AND ip IS NOT NULL AND ip NOT IN (SELECT value FROM wl_ip) AND user_id NOT IN (SELECT user_id FROM wl_acct)
  UNION
  SELECT user_id, client_ip FROM bg_user_attribution
    WHERE client_ip<>'' AND client_ip IS NOT NULL AND client_ip NOT IN (SELECT value FROM wl_ip) AND user_id NOT IN (SELECT user_id FROM wl_acct)
),
ic AS (SELECT ip, COUNT(DISTINCT user_id) n FROM ui GROUP BY ip),
u_dev AS (
  SELECT p.user_id, p.channel,
    GREATEST(
      COALESCE((SELECT MAX(dc.n) FROM ud JOIN dc ON dc.device_id=ud.device_id WHERE ud.user_id=p.user_id),0),
      COALESCE((SELECT MAX(fc.n) FROM uf JOIN fc ON fc.fp_visitor=uf.fp_visitor WHERE uf.user_id=p.user_id),0)
    ) AS dev_cluster,
    COALESCE((SELECT MAX(ic.n) FROM ui JOIN ic ON ic.ip=ui.ip WHERE ui.user_id=p.user_id),0) AS ip_cluster,
    (SELECT dc.device_id FROM ud JOIN dc ON dc.device_id=ud.device_id WHERE ud.user_id=p.user_id ORDER BY dc.n DESC LIMIT 1) AS top_device
  FROM pop p
)`

function farmDate(ctx: import('koa').Context): string | null {
  const date = String(ctx.query.date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { fail(ctx, 400, 'date 需为 YYYY-MM-DD'); return null }
  return date
}

// 分渠道汇总。前端点「刷新」即重跑，当天数据实时。
router.get('/farm-channels', async (ctx) => {
  const pool = db(ctx); if (!pool) return
  const date = farmDate(ctx); if (!date) return
  const [rows] = await pool.query<RowDataPacket[]>(
    `${FARM_CTE}
     SELECT COALESCE(p.channel,'__total__') AS channel,
       COUNT(*)                                             AS entrants,
       SUM(x.dev_cluster>=3)                                AS farmDevice,
       SUM(x.dev_cluster<3 AND x.ip_cluster>=5)             AS suspectIp,
       ROUND(100*SUM(x.dev_cluster>=3 OR (x.dev_cluster<3 AND x.ip_cluster>=5))/COUNT(*),1) AS farmPct,
       MAX(x.dev_cluster)                                   AS maxRing
     FROM pop p JOIN u_dev x ON x.user_id=p.user_id
     GROUP BY p.channel WITH ROLLUP
     ORDER BY GROUPING(p.channel), farmPct DESC, entrants DESC`,
    [date, date],
  )
  ok(ctx, {
    date,
    items: rows.map((r) => ({
      channel: String(r.channel),
      isTotal: r.channel === '__total__',
      entrants: Number(r.entrants),
      farmDevice: Number(r.farmDevice),
      suspectIp: Number(r.suspectIp),
      farmPct: Number(r.farmPct),
      maxRing: Number(r.maxRing),
    })),
  })
})

// 某天套利客明细（可按渠道过滤），供运营复核与处置。
router.get('/farm-channels/detail', async (ctx) => {
  const pool = db(ctx); if (!pool) return
  const date = farmDate(ctx); if (!date) return
  const channel = String(ctx.query.channel ?? '').trim()
  const params: unknown[] = [date, date]
  let channelFilter = ''
  if (channel) { channelFilter = 'AND x.channel = ?'; params.push(channel) }
  const [rows] = await pool.query<RowDataPacket[]>(
    `${FARM_CTE}
     SELECT x.channel, x.user_id AS userId, x.dev_cluster AS ring,
            LEFT(x.top_device,16) AS deviceFp, u.status, u.created_at AS createdAt,
            s.bonus_total AS bonusTotal, s.net_deposit AS netDeposit, s.withdraw_count AS withdrawCount
     FROM u_dev x
     JOIN bg_user u ON u.id = x.user_id
     LEFT JOIN bg_user_risk_signal s ON s.user_id = x.user_id
     WHERE x.dev_cluster >= 3 ${channelFilter}
     ORDER BY x.dev_cluster DESC, x.channel, x.user_id`,
    params,
  )
  ok(ctx, {
    date,
    channel: channel || null,
    items: rows.map((r) => ({
      channel: String(r.channel),
      userId: String(r.userId),
      ring: Number(r.ring),
      deviceFp: r.deviceFp ? String(r.deviceFp) : null,
      status: String(r.status),
      createdAt: r.createdAt,
      bonusTotal: r.bonusTotal == null ? null : Number(r.bonusTotal),
      netDeposit: r.netDeposit == null ? null : Number(r.netDeposit),
      withdrawCount: r.withdrawCount == null ? null : Number(r.withdrawCount),
    })),
  })
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
