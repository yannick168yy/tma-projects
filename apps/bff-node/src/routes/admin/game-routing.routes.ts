import Router from '@koa/router'
import { z } from 'zod'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../../clients/mysql.client.js'
import { requireRole } from '../../middleware/require-role.js'
import { ok, fail } from '../../utils/response.js'
import { writeAuditLog } from '../../services/admin-store.js'
import { scheduleCacheRefresh } from '../../services/sg-game.service.js'
import { applyRoutingChange, bustGameRoutingCache, previewRouting, readRoutingConfig, readSourceGames, routingChangeSchema, routingRevision, type RoutingChange, type RoutingConfig } from '../../services/game-routing.service.js'

const router = new Router({ prefix: '/game-routing' })
const guard = requireRole(['super_admin', 'ops'])

router.post('/wxgame-sync', guard, async (ctx) => {
  const tenant = ctx.state.tenant
  const prefix = !tenant || tenant.selfOperated ? '' : `/t/${tenant.code}`
  const result = await fetch(`${ctx.state.env.CORE_NODE_URL}${prefix}/internal/wxgame/games/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Token': ctx.state.env.INTERNAL_TOKEN }, body: '{}',
  })
  const data = await result.json() as { received?: number; error?: string }
  if (!result.ok) { fail(ctx, 502, data.error || '同步失败'); return }
  await writeAuditLog(ctx.state.env, { adminId: ctx.state.adminId!, adminUsername: ctx.state.adminUsername!, action: 'wxgame.game.sync', targetType: 'game', targetId: 'wxgame', detail: data, ip: ctx.ip })
  scheduleCacheRefresh(ctx.state.env)
  ok(ctx, data)
})

router.get('/', async (ctx) => {
  const db = getMysqlPool(ctx.state.env)
  const config = await readRoutingConfig(db)
  ok(ctx, { ...config, revision: routingRevision(config) })
})

router.get('/sources', async (ctx) => {
  const rows = await readSourceGames(getMysqlPool(ctx.state.env))
  const search = String(ctx.query.search ?? '').toLowerCase()
  const selected = rows.filter((r) => (!ctx.query.aggregator || r.aggregator === ctx.query.aggregator)
    && (!ctx.query.provider || r.provider === ctx.query.provider)
    && (!search || `${r.name} ${r.uuid}`.toLowerCase().includes(search)))
  const page = Math.max(1, Number(ctx.query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(ctx.query.pageSize) || 30))
  ok(ctx, { items: selected.slice((page - 1) * pageSize, page * pageSize), total: selected.length,
    providers: [...new Set(rows.filter((r) => !ctx.query.aggregator || r.aggregator === ctx.query.aggregator).map((r) => r.provider))].sort() })
})

export function normalizedGameName(name: string): string {
  return name.replace(/[™®©]/g, '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join('') ?? ''
}

router.get('/candidates', async (ctx) => {
  const providerId = Number(ctx.query.providerId)
  const db = getMysqlPool(ctx.state.env)
  const config = await readRoutingConfig(db)
  const provider = config.providers.find((p) => p.id === providerId)
  if (!provider) { fail(ctx, 404, '统一厂商不存在'); return }
  const claimed = new Set(config.sources.map((s) => s.uuid))
  const raw = (await readSourceGames(db)).filter((s) => provider.aliases[s.aggregator].includes(s.provider) && !claimed.has(s.uuid))
  const wxByName = new Map<string, typeof raw>()
  for (const source of raw.filter((s) => s.aggregator === 'wxgame')) {
    const key = normalizedGameName(source.name)
    if (key) wxByName.set(key, [...(wxByName.get(key) ?? []), source])
  }
  const candidates = raw.filter((s) => s.aggregator === '568win').flatMap((win) =>
    (wxByName.get(normalizedGameName(win.name)) ?? []).map((wx) => ({ win, wx })))
  const search = String(ctx.query.search ?? '').toLowerCase()
  const filtered = search ? candidates.filter((c) => `${c.win.name} ${c.win.uuid} ${c.wx.uuid}`.toLowerCase().includes(search)) : candidates
  const page = Math.max(1, Number(ctx.query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(ctx.query.pageSize) || 30))
  ok(ctx, { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length })
})

router.post('/preview', guard, async (ctx) => {
  const parsed = routingChangeSchema.safeParse(ctx.request.body)
  if (!parsed.success) { fail(ctx, 400, parsed.error.issues.map((i) => i.message).join('；')); return }
  const db = getMysqlPool(ctx.state.env)
  const before = await readRoutingConfig(db)
  const raw = await readSourceGames(db)
  try {
    const after = applyRoutingChange(before, parsed.data, raw)
    const preview = previewRouting(before, after, raw)
    const providerIds = parsed.data.kind === 'provider' ? [parsed.data.id] : parsed.data.kind === 'rule' && parsed.data.scope === 'provider' ? [parsed.data.targetId] : []
    const aliases = before.providers.filter((p) => providerIds.includes(p.id)).flatMap((p) => Object.entries(p.aliases).flatMap(([aggregator, names]) => names.map((name) => `${aggregator}|${name}`)))
    const unmapped = raw.filter((s) => aliases.includes(`${s.aggregator}|${s.provider}`) && !after.sources.some((m) => m.uuid === s.uuid))
    ok(ctx, { revision: routingRevision(before), ...preview, unmapped: unmapped.length, unmappedItems: unmapped.map((s) => ({ uuid: s.uuid, name: s.name })) })
  } catch (e) { fail(ctx, 400, (e as Error).message) }
})

async function persistChange(conn: PoolConnection, next: RoutingConfig, change: RoutingChange) {
  if (change.kind === 'provider') {
    const p = next.providers.find((p) => p.code === change.code)!
    await conn.execute(`INSERT INTO bg_game_provider (id, code, name, aliases) VALUES (?,?,?,?)
      ON DUPLICATE KEY UPDATE code=VALUES(code), name=VALUES(name), aliases=VALUES(aliases)`, [p.id, p.code, p.name, JSON.stringify(p.aliases)])
  } else if (change.kind === 'game') {
    const g = next.games.find((g) => g.uuid === change.uuid)!
    await conn.execute(`INSERT INTO bg_game_catalog (id, provider_id, uuid, name, enabled, is_active, presentation) VALUES (?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE provider_id=VALUES(provider_id), name=VALUES(name), enabled=VALUES(enabled), is_active=VALUES(is_active), presentation=VALUES(presentation)`,
    [g.id, g.providerId, g.uuid, g.name, g.enabled, g.isActive, JSON.stringify(g.presentation)])
    await conn.execute('DELETE FROM bg_game_source WHERE game_id = ?', [g.id])
    for (const s of next.sources.filter((s) => s.gameId === g.id)) {
      await conn.execute('INSERT INTO bg_game_source (game_id, aggregator_id, source_uuid, currencies) VALUES (?,?,?,?)', [s.gameId, s.aggregator, s.uuid, JSON.stringify(s.currencies)])
    }
  } else {
    await conn.execute('DELETE FROM bg_game_route_rule WHERE scope = ? AND target_id = ?', [change.scope, change.targetId])
    if (change.aggregator) await conn.execute('INSERT INTO bg_game_route_rule (scope, target_id, aggregator_id) VALUES (?,?,?)', [change.scope, change.targetId, change.aggregator])
  }
}

router.post('/apply', guard, async (ctx) => {
  const parsed = z.object({ change: routingChangeSchema, revision: z.string().length(64), reason: z.string().trim().min(1).max(255) }).strict().safeParse(ctx.request.body)
  if (!parsed.success) { fail(ctx, 400, parsed.error.issues.map((i) => i.message).join('；')); return }
  const conn = await getMysqlPool(ctx.state.env).getConnection()
  let lockName = ''
  try {
    const [[db]] = await conn.query<RowDataPacket[]>('SELECT DATABASE() AS name')
    lockName = `game-routing:${String(db.name).slice(0, 50)}`
    const [[lock]] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 5) AS acquired', [lockName])
    if (Number(lock.acquired) !== 1) { fail(ctx, 409, '其他管理员正在保存，请重新预览'); return }
    await conn.beginTransaction()
    const before = await readRoutingConfig(conn)
    if (routingRevision(before) !== parsed.data.revision) { await conn.rollback(); fail(ctx, 409, '配置已变化，请重新预览'); return }
    const raw = await readSourceGames(conn)
    const next = applyRoutingChange(before, parsed.data.change, raw)
    const preview = previewRouting(before, next, raw)
    if (preview.blocking) { await conn.rollback(); fail(ctx, 409, '启用或切换涉及不可用来源，请先处理预览中的问题'); return }
    await persistChange(conn, next, parsed.data.change)
    // 配置与审计同一事务，避免配置成功但审计缺失。
    const change = parsed.data.change
    let targetId: number
    let beforeState: unknown
    let afterState: unknown
    if (change.kind === 'provider') {
      targetId = next.providers.find((p) => p.code === change.code)!.id
      beforeState = before.providers.find((p) => p.id === change.id) ?? null
      afterState = next.providers.find((p) => p.id === targetId) ?? null
    } else if (change.kind === 'game') {
      targetId = next.games.find((g) => g.uuid === change.uuid)!.id
      beforeState = { game: before.games.find((g) => g.id === change.id) ?? null, sources: before.sources.filter((s) => s.gameId === change.id) }
      afterState = { game: next.games.find((g) => g.id === targetId) ?? null, sources: next.sources.filter((s) => s.gameId === targetId) }
    } else {
      targetId = change.targetId
      beforeState = before.rules.find((r) => r.scope === change.scope && r.targetId === change.targetId) ?? null
      afterState = next.rules.find((r) => r.scope === change.scope && r.targetId === change.targetId) ?? null
    }
    await conn.execute(`INSERT INTO admin_audit_log (admin_id, admin_username, action, target_type, target_id, detail, ip) VALUES (?,?,?,?,?,?,?)`,
      [ctx.state.adminId!, ctx.state.adminUsername!, 'game.routing.update', parsed.data.change.kind,
        String(targetId), JSON.stringify({ reason: parsed.data.reason, before: beforeState, after: afterState,
          impact: { changed: preview.changed, missing: preview.missing, unavailable: preview.unavailable, changedGameIds: preview.rows.filter((r) => r.changed).map((r) => r.id) } }), ctx.ip])
    await conn.commit()
    bustGameRoutingCache()
    scheduleCacheRefresh(ctx.state.env)
    ok(ctx, { saved: true })
  } catch (e) {
    await conn.rollback()
    fail(ctx, 400, (e as Error).message)
  } finally {
    try { if (lockName) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]) } finally { conn.release() }
  }
})

export default router
