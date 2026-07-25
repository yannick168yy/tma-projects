// 买量投放配置：CAPI 像素 token 映射管理。
// token 属敏感凭证：写后不回显，列表只给尾号；增删改仅 super_admin。
import Router from '@koa/router'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { writeAuditLog } from '../../services/admin-store.js'
import { ok, fail } from '../../utils/response.js'

const router = new Router({ prefix: '/marketing' })

const PLATFORMS = ['facebook', 'tiktok'] as const

router.get('/capi-tokens', async (ctx) => {
  const db = getMysqlPool(ctx.state.env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, platform, pixel_id, access_token, remark, updated_at
     FROM bg_capi_pixel_token ORDER BY platform, pixel_id`,
  )
  ok(ctx, rows.map((r) => ({
    id: Number(r.id),
    platform: String(r.platform),
    pixelId: String(r.pixel_id),
    tokenTail: String(r.access_token).slice(-6),
    remark: r.remark ? String(r.remark) : null,
    updatedAt: r.updated_at,
  })))
})

router.post('/capi-tokens', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') { fail(ctx, 403, '仅 super_admin 可配置 CAPI token', 403); return }
  const body = ctx.request.body as { platform?: string; pixelId?: string; accessToken?: string; remark?: string }
  const platform = String(body?.platform ?? '')
  const pixelId = String(body?.pixelId ?? '').trim()
  const accessToken = String(body?.accessToken ?? '').trim()
  const remark = body?.remark ? String(body.remark).trim().slice(0, 191) : null
  if (!(PLATFORMS as readonly string[]).includes(platform)
    || !/^[\w-]{5,64}$/.test(pixelId)
    || accessToken.length < 10 || accessToken.length > 512) {
    fail(ctx, 400, 'invalid params'); return
  }
  const db = getMysqlPool(ctx.state.env)
  await db.execute(
    `INSERT INTO bg_capi_pixel_token (platform, pixel_id, access_token, remark) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), remark = VALUES(remark)`,
    [platform, pixelId, accessToken, remark],
  )
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'marketing.capi_token_upsert',
    targetType: 'capi_pixel',
    targetId: `${platform}:${pixelId}`,
    detail: { remark, tokenTail: accessToken.slice(-6) },
  })
  ok(ctx, { ok: true })
})

router.delete('/capi-tokens/:id', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') { fail(ctx, 403, '仅 super_admin 可配置 CAPI token', 403); return }
  const id = Number(ctx.params.id)
  if (!Number.isInteger(id) || id <= 0) { fail(ctx, 400, 'invalid id'); return }
  const db = getMysqlPool(ctx.state.env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT platform, pixel_id FROM bg_capi_pixel_token WHERE id = ? LIMIT 1`, [id],
  )
  if (!rows[0]) { fail(ctx, 404, 'not found', 404); return }
  await db.execute<ResultSetHeader>(`DELETE FROM bg_capi_pixel_token WHERE id = ?`, [id])
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'marketing.capi_token_delete',
    targetType: 'capi_pixel',
    targetId: `${rows[0].platform}:${rows[0].pixel_id}`,
  })
  ok(ctx, { ok: true })
})

export default router
