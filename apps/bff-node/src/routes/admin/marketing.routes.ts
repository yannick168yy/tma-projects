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
    `SELECT id, platform, pixel_id, channel_code, access_token, test_event_code, promo_domain, remark, updated_at
     FROM bg_capi_pixel_token ORDER BY platform, pixel_id`,
  )
  ok(ctx, rows.map((r) => ({
    id: Number(r.id),
    platform: String(r.platform),
    pixelId: String(r.pixel_id),
    channelCode: r.channel_code ? String(r.channel_code) : null,
    tokenTail: String(r.access_token).slice(-6),
    testEventCode: r.test_event_code ? String(r.test_event_code) : null,
    promoDomain: r.promo_domain ? String(r.promo_domain) : null,
    remark: r.remark ? String(r.remark) : null,
    updatedAt: r.updated_at,
  })))
})

// 查看完整 token：敏感操作，仅 super_admin，每次都写审计
router.get('/capi-tokens/:id/token', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') { fail(ctx, 403, '仅 super_admin 可查看完整 token', 403); return }
  const id = Number(ctx.params.id)
  if (!Number.isInteger(id) || id <= 0) { fail(ctx, 400, 'invalid id'); return }
  const db = getMysqlPool(ctx.state.env)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT platform, pixel_id, access_token FROM bg_capi_pixel_token WHERE id = ? LIMIT 1`, [id],
  )
  if (!rows[0]) { fail(ctx, 404, 'not found', 404); return }
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'marketing.capi_token_reveal',
    targetType: 'capi_pixel',
    targetId: `${rows[0].platform}:${rows[0].pixel_id}`,
  })
  ok(ctx, { token: String(rows[0].access_token) })
})

router.post('/capi-tokens', async (ctx) => {
  if (ctx.state.adminRole !== 'super_admin') { fail(ctx, 403, '仅 super_admin 可配置 CAPI token', 403); return }
  const body = ctx.request.body as { platform?: string; pixelId?: string; channelCode?: string; accessToken?: string; testEventCode?: string; promoDomain?: string; remark?: string }
  const platform = String(body?.platform ?? '')
  const pixelId = String(body?.pixelId ?? '').trim()
  // 渠道短码：短链 /t/<code> 与归因 c 值；同一条线的 FB/TT 两行可共用一个
  const channelCode = body?.channelCode ? String(body.channelCode).trim() : ''
  // token 可留空：编辑既有像素时表示「保持原 token 不变」，新增时必须提供
  const accessToken = String(body?.accessToken ?? '').trim()
  const testEventCode = body?.testEventCode ? String(body.testEventCode).trim() : ''
  // 推广域名：去掉误粘的协议/路径，只留主机名；宽松校验，允许 betogo666.com 这类
  const promoDomain = body?.promoDomain
    ? String(body.promoDomain).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').slice(0, 191)
    : ''
  const remark = body?.remark ? String(body.remark).trim().slice(0, 191) : null
  if (!(PLATFORMS as readonly string[]).includes(platform)
    || !/^[\w-]{5,64}$/.test(pixelId)
    || (channelCode && !/^[\w.-]{1,64}$/.test(channelCode))
    || (accessToken && (accessToken.length < 10 || accessToken.length > 512))
    || (testEventCode && !/^[\w-]{1,32}$/.test(testEventCode))
    || (promoDomain && !/^[a-z0-9.-]{3,191}$/i.test(promoDomain))) {
    fail(ctx, 400, 'invalid params'); return
  }
  const db = getMysqlPool(ctx.state.env)
  // 短码是短链入口，同平台内不允许两条线共用（跨平台同线共用是预期用法）
  if (channelCode) {
    const [dup] = await db.query<RowDataPacket[]>(
      `SELECT id FROM bg_capi_pixel_token WHERE platform = ? AND channel_code = ? AND pixel_id != ? LIMIT 1`,
      [platform, channelCode, pixelId],
    )
    if (dup.length) { fail(ctx, 400, `短码 ${channelCode} 已被同平台其它像素占用`); return }
  }
  if (accessToken) {
    await db.execute(
      `INSERT INTO bg_capi_pixel_token (platform, pixel_id, channel_code, access_token, test_event_code, promo_domain, remark) VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE channel_code = VALUES(channel_code), access_token = VALUES(access_token), test_event_code = VALUES(test_event_code), promo_domain = VALUES(promo_domain), remark = VALUES(remark)`,
      [platform, pixelId, channelCode || null, accessToken, testEventCode || null, promoDomain || null, remark],
    )
  } else {
    // 无 token = 编辑既有像素的其它字段；记录不存在则拒绝（新增必须带 token）
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE bg_capi_pixel_token SET channel_code = ?, test_event_code = ?, promo_domain = ?, remark = ? WHERE platform = ? AND pixel_id = ?`,
      [channelCode || null, testEventCode || null, promoDomain || null, remark, platform, pixelId],
    )
    if (res.affectedRows === 0) { fail(ctx, 400, '新增像素必须提供 access token'); return }
  }
  await writeAuditLog(ctx.state.env, {
    adminId: ctx.state.adminId!,
    adminUsername: ctx.state.adminUsername!,
    action: 'marketing.capi_token_upsert',
    targetType: 'capi_pixel',
    targetId: `${platform}:${pixelId}`,
    detail: { remark, channelCode: channelCode || null, tokenTail: accessToken ? accessToken.slice(-6) : '(unchanged)', testEventCode: testEventCode || null, promoDomain: promoDomain || null },
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
