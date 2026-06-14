import Router from '@koa/router'
import { ok, fail } from '../../utils/response.js'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import { RULE_META } from '../../services/withdraw-review.service.js'
import { writeAuditLog } from '../../services/admin-store.js'
import type { RowDataPacket } from 'mysql2/promise'

const router = new Router({ prefix: '/review' })

// GET /admin/review/config — 规则配置（含中文名/说明）
router.get('/config', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { config: [] }); return }
  const pool = getMysqlPool(ctx.state.env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rule_code, enabled, threshold, params, updated_at FROM bg_withdraw_review_config`,
  )
  const config = rows.map((r) => {
    const code = String(r.rule_code)
    return {
      ruleCode: code,
      name: RULE_META[code]?.name ?? code,
      desc: RULE_META[code]?.desc ?? '',
      enabled: Boolean(r.enabled),
      threshold: r.threshold == null ? null : Number(r.threshold),
      params: r.params == null ? null : (typeof r.params === 'string' ? JSON.parse(r.params) : r.params),
      updatedAt: r.updated_at ? new Date(r.updated_at as Date).toISOString() : null,
    }
  })
  ok(ctx, { config })
})

// PUT /admin/review/config — 改阈值/开关（仅 super_admin）
router.put('/config', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') {
    fail(ctx, 403, '仅超级管理员可修改审核规则配置'); return
  }
  if (!isMysqlEnabled(ctx.state.env)) { fail(ctx, 503, 'DB not available'); return }

  const body = ctx.request.body as {
    config?: { ruleCode: string; enabled: boolean; threshold?: number | null; params?: Record<string, unknown> | null }[]
  }
  if (!Array.isArray(body.config) || body.config.length === 0) {
    fail(ctx, 400, 'config array required'); return
  }

  const pool = getMysqlPool(ctx.state.env)
  for (const item of body.config) {
    if (!item.ruleCode || !(item.ruleCode in RULE_META)) {
      fail(ctx, 400, `unknown ruleCode: ${item.ruleCode}`); return
    }
    await pool.execute(
      `UPDATE bg_withdraw_review_config SET enabled = ?, threshold = ?, params = ? WHERE rule_code = ?`,
      [
        item.enabled ? 1 : 0,
        item.threshold ?? null,
        item.params == null ? null : JSON.stringify(item.params),
        item.ruleCode,
      ],
    )
  }

  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'review.config.update',
    targetType: 'review_config',
    detail: { rules: body.config.map((c) => c.ruleCode) },
    ip: ctx.ip,
  })
  ok(ctx, { saved: body.config.length })
})

// GET /admin/review/stats — 近7天各规则命中（manual）次数 + 自动通过率
router.get('/stats', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { hits: [], autoApproveRate: null, manualCount: 0, totalReviewed: 0 }); return }
  const pool = getMysqlPool(ctx.state.env)

  const [hitRows] = await pool.query<RowDataPacket[]>(
    `SELECT rule_code, COUNT(*) AS cnt
     FROM bg_withdraw_review_log
     WHERE verdict = 'manual' AND created_at > NOW() - INTERVAL 7 DAY
     GROUP BY rule_code ORDER BY cnt DESC`,
  )
  const hits = hitRows.map((r) => ({
    ruleCode: String(r.rule_code),
    name: RULE_META[String(r.rule_code)]?.name ?? String(r.rule_code),
    count: Number(r.cnt),
  }))

  const [[agg]] = await pool.query<RowDataPacket[]>(
    `SELECT
       SUM(review_verdict = 'pass')   AS pass_cnt,
       SUM(review_verdict = 'manual') AS manual_cnt
     FROM bg_withdraw_order
     WHERE reviewed_at > NOW() - INTERVAL 7 DAY`,
  )
  const passCnt = Number(agg?.pass_cnt ?? 0)
  const manualCnt = Number(agg?.manual_cnt ?? 0)
  const total = passCnt + manualCnt

  ok(ctx, {
    hits,
    manualCount: manualCnt,
    totalReviewed: total,
    autoApproveRate: total > 0 ? Math.round((passCnt / total) * 1000) / 10 : null,
  })
})

export default router
