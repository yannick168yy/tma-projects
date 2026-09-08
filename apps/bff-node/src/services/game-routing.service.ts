import { createHash } from 'node:crypto'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import type { Env } from '../config/env.js'
import { defaultDatabase, getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import type { AggregatorId } from '../lib/aggregators.js'
import { currentTenantOrNull } from '../lib/tenant-context.js'
import type { DbGame } from './sg-game.service.js'

export interface CatalogProvider { id: number; code: string; name: string; aliases: Record<AggregatorId, string[]> }
export interface CatalogGame { id: number; providerId: number; uuid: string; name: string; enabled: boolean; isActive: boolean; presentation: Partial<Pick<DbGame, 'imageUrl' | 'sortCategory' | 'siteCategory' | 'weight' | 'isFeatured'>> }
export interface CatalogSource { gameId: number; aggregator: AggregatorId; uuid: string; currencies: string[] }
export interface CatalogRule { scope: 'global' | 'provider' | 'game'; targetId: number; aggregator: AggregatorId }
export interface RoutingConfig { providers: CatalogProvider[]; games: CatalogGame[]; sources: CatalogSource[]; rules: CatalogRule[] }
export interface SourceGame { uuid: string; aggregator: AggregatorId; provider: string; name: string; imageUrl: string | null; available: boolean; currencies: string[] | null; mobile: boolean; desktop: boolean; supportsRtp: boolean; rtp: number | null; category: string; syncedAt: string }

const aggregator = z.enum(['568win', 'wxgame'])
const sourceSchema = z.object({ aggregator, uuid: z.string().min(1).max(191), currencies: z.array(z.enum(['PHP', 'USDT', 'IDR'])).min(1).max(3) }).strict()
const presentationSchema = z.object({
  imageUrl: z.string().max(512).refine((v) => !v || v.startsWith('/api/') || /^https?:\/\//.test(v), '封面须为站内路径或 HTTP 地址').optional(),
  sortCategory: z.enum(['slots', 'live', 'sports', 'fishing', 'table', 'other']).optional(),
  siteCategory: z.enum(['slots', 'casino', 'perya', 'fishing', 'lottery', 'baccarat', 'sports', 'other']).optional(),
  weight: z.number().int().min(0).max(10000).optional(), isFeatured: z.boolean().optional(),
}).strict()
export const routingChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('provider'), id: z.number().int().positive().optional(), code: z.string().regex(/^[a-z0-9_-]{1,64}$/), name: z.string().trim().min(1).max(128), aliases: z.object({ '568win': z.array(z.string().trim().min(1).max(128)).max(50), wxgame: z.array(z.string().trim().min(1).max(32)).max(50) }).strict() }).strict(),
  z.object({ kind: z.literal('game'), id: z.number().int().positive().optional(), providerId: z.number().int().positive(), uuid: z.string().min(1).max(191), name: z.string().trim().min(1).max(255), enabled: z.boolean(), isActive: z.boolean(), presentation: presentationSchema, sources: z.array(sourceSchema).min(1).max(2), confirmed: z.literal(true) }).strict(),
  z.object({ kind: z.literal('rule'), scope: z.enum(['global', 'provider', 'game']), targetId: z.number().int().min(0), aggregator: aggregator.nullable() }).strict(),
])
export type RoutingChange = z.infer<typeof routingChangeSchema>
const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T
const configCache = new Map<string, { value: RoutingConfig; expiresAt: number }>()

function routingCacheKey(): string {
  return currentTenantOrNull()?.database ?? defaultDatabase()
}

export function bustGameRoutingCache(): void {
  configCache.delete(routingCacheKey())
}

async function getRoutingConfig(env: Env): Promise<RoutingConfig> {
  const key = routingCacheKey()
  const cached = configCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const value = await readRoutingConfig(getMysqlPool(env))
  configCache.set(key, { value, expiresAt: Date.now() + 30_000 })
  return value
}

export async function readRoutingConfig(db: Pool | PoolConnection): Promise<RoutingConfig> {
  if ('getConnection' in db) {
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const config = await readRoutingConfig(conn)
      await conn.commit()
      return config
    } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  }
  const [providers] = await db.query<RowDataPacket[]>('SELECT * FROM bg_game_provider ORDER BY id')
  const [games] = await db.query<RowDataPacket[]>('SELECT * FROM bg_game_catalog ORDER BY id')
  const [sources] = await db.query<RowDataPacket[]>('SELECT * FROM bg_game_source ORDER BY game_id, aggregator_id')
  const [rules] = await db.query<RowDataPacket[]>('SELECT * FROM bg_game_route_rule ORDER BY scope, target_id')
  return {
    providers: providers.map((r) => ({ id: Number(r.id), code: String(r.code), name: String(r.name), aliases: json(r.aliases) })),
    games: games.map((r) => ({ id: Number(r.id), providerId: Number(r.provider_id), uuid: String(r.uuid), name: String(r.name), enabled: Boolean(r.enabled), isActive: Boolean(r.is_active), presentation: json(r.presentation) })),
    sources: sources.map((r) => ({ gameId: Number(r.game_id), aggregator: r.aggregator_id, uuid: String(r.source_uuid), currencies: json(r.currencies) })),
    rules: rules.map((r) => ({ scope: r.scope, targetId: Number(r.target_id), aggregator: r.aggregator_id })),
  }
}

function normalizeCurrency(c: string): string {
  if (c === 'UCC') return 'USDT'
  return process.env.WIN568_USD_AS_USDT !== 'false' && (c === 'USD' || c === 'USDC') ? 'USDT' : c
}

export async function readSourceGames(db: Pool | PoolConnection): Promise<SourceGame[]> {
  const [win] = await db.query<RowDataPacket[]>(`SELECT g.game_provider_id, g.game_id, g.provider, g.new_game_type, g.device, g.rtp,
    g.is_enabled, g.is_maintain, g.provider_status, g.is_provider_online, g.supported_currencies, g.synced_at,
    COALESCE(o.name_override, g.name_en, g.name_zh) AS display_name,
    COALESCE(o.image_override, g.icon_url) AS display_image
    FROM bg_568win_game g LEFT JOIN bg_568win_game_override o
    ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id`)
  const [wx] = await db.query<RowDataPacket[]>(`SELECT game_brand, game_id, name_en, name_full, game_type,
    icon_url, icon_local, supports_rtp, is_maintain, is_enabled, synced_at FROM bg_wxgame_game`)
  return [...win.map(winSource), ...wx.map(wxSource)]
}

function winSource(r: RowDataPacket): SourceGame {
  const devices = String(r.device ?? 'm,d').split(/[,/]/).map((d) => d.trim())
  const type = Number(r.new_game_type)
  return { uuid: `568win:${r.game_provider_id}:${r.game_id}`, aggregator: '568win', provider: String(r.provider), name: String(r.display_name || r.game_id), imageUrl: r.display_image || null,
    available: Boolean(r.is_enabled) && !r.is_maintain && r.provider_status === 'Online' && Boolean(r.is_provider_online),
    currencies: r.supported_currencies == null ? null : json<string[]>(r.supported_currencies).map((c) => normalizeCurrency(c.toUpperCase())),
    mobile: devices.includes('m'), desktop: devices.includes('d'), supportsRtp: false, rtp: r.rtp == null ? null : Number(r.rtp),
    category: type === 203 ? 'fishing' : type >= 100 && type < 200 ? 'live' : type >= 200 && type < 300 ? 'slots' : 'other', syncedAt: String(r.synced_at ?? '') }
}

function wxSource(r: RowDataPacket): SourceGame {
  return { uuid: `wxgame:${r.game_brand}:${r.game_id}`, aggregator: 'wxgame', provider: String(r.game_brand), name: String(r.name_full || r.name_en || r.game_id), imageUrl: r.icon_local || r.icon_url || null,
    available: Boolean(r.is_enabled) && !r.is_maintain,
    // 当前接入已确认 PHP，其他币种在支持开户/账号币种约束后再开放路由。
    currencies: ['PHP'], mobile: true, desktop: true, supportsRtp: Boolean(r.supports_rtp), rtp: null,
    category: r.game_type === 'fish' ? 'fishing' : r.game_type === 'slot' ? 'slots' : 'table', syncedAt: String(r.synced_at ?? '') }
}

async function readSourceGame(db: Pool | PoolConnection, source: CatalogSource): Promise<SourceGame | null> {
  if (source.aggregator === '568win') {
    const match = /^568win:(\d+):(\d+)$/.exec(source.uuid)
    if (!match) return null
    const [[row]] = await db.query<RowDataPacket[]>(`SELECT g.game_provider_id, g.game_id, g.provider, g.new_game_type, g.device, g.rtp,
      g.is_enabled, g.is_maintain, g.provider_status, g.is_provider_online, g.supported_currencies, g.synced_at,
      COALESCE(o.name_override, g.name_en, g.name_zh) AS display_name, COALESCE(o.image_override, g.icon_url) AS display_image
      FROM bg_568win_game g LEFT JOIN bg_568win_game_override o
      ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
      WHERE g.game_provider_id = ? AND g.game_id = ? LIMIT 1`, [match[1], match[2]])
    return row ? winSource(row) : null
  }
  const first = source.uuid.indexOf(':')
  const second = source.uuid.indexOf(':', first + 1)
  if (source.uuid.slice(0, first) !== 'wxgame' || second < 0) return null
  const brand = source.uuid.slice(first + 1, second)
  const gameId = source.uuid.slice(second + 1)
  const [[row]] = await db.query<RowDataPacket[]>(`SELECT game_brand, game_id, name_en, name_full, game_type,
    icon_url, icon_local, supports_rtp, is_maintain, is_enabled, synced_at FROM bg_wxgame_game
    WHERE game_brand = ? AND game_id = ? LIMIT 1`, [brand, gameId])
  return row ? wxSource(row) : null
}

export function routeFor(config: RoutingConfig, game: CatalogGame) {
  const rule = config.rules.find((r) => r.scope === 'game' && r.targetId === game.id)
    ?? config.rules.find((r) => r.scope === 'provider' && r.targetId === game.providerId)
    ?? config.rules.find((r) => r.scope === 'global')
  const selected = rule?.aggregator ?? config.sources.find((s) => s.gameId === game.id && s.uuid === game.uuid)?.aggregator
  return { source: config.sources.find((s) => s.gameId === game.id && s.aggregator === selected), level: rule?.scope ?? 'original', aggregator: selected }
}

export function routingRevision(config: RoutingConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex')
}

export function applyRoutingChange(config: RoutingConfig, change: RoutingChange, upstream: SourceGame[]): RoutingConfig {
  const next = structuredClone(config)
  if (change.kind === 'provider') {
    if (change.id && !next.providers.some((p) => p.id === change.id)) throw new Error('厂商不存在')
    if (next.providers.some((p) => p.id !== change.id && (p.code === change.code || Object.entries(change.aliases).some(([a, names]) => names.some((n) => p.aliases[a as AggregatorId].includes(n)))))) throw new Error('厂商编码或上游厂商别名已被关联')
    const id = change.id ?? Math.max(0, ...next.providers.map((p) => p.id)) + 1
    const { kind: _, ...value } = change
    next.providers = [...next.providers.filter((p) => p.id !== id), { ...value, id }].sort((a, b) => a.id - b.id)
  } else if (change.kind === 'game') {
    const old = next.games.find((g) => g.id === change.id)
    if (change.id && !old) throw new Error('游戏不存在')
    if (!old && change.enabled) throw new Error('新建游戏先保存草稿，再预览启用')
    if (old && old.uuid !== change.uuid) throw new Error('公开游戏 ID 创建后不可变更')
    if (next.games.some((g) => g.id !== change.id && g.uuid === change.uuid)) throw new Error('该游戏已存在')
    const id = change.id ?? Math.max(0, ...next.games.map((g) => g.id)) + 1
    if (old?.enabled && (old.providerId !== change.providerId || JSON.stringify(next.sources.filter((s) => s.gameId === id).map(({ gameId: _, ...s }) => s)) !== JSON.stringify([...change.sources].sort((a, b) => a.aggregator.localeCompare(b.aggregator))))) throw new Error('修改已启用映射前，请先停用接管并保存')
    if (!change.sources.some((s) => s.uuid === change.uuid)) throw new Error('必须保留公开 ID 对应的展示来源')
    if (new Set(change.sources.map((s) => s.aggregator)).size !== change.sources.length) throw new Error('每家聚合商只能映射一款游戏')
    const { kind: _, sources, confirmed: __, ...value } = change
    next.games = [...next.games.filter((g) => g.id !== id), { ...value, id }].sort((a, b) => a.id - b.id)
    next.sources = [...next.sources.filter((s) => s.gameId !== id), ...sources.map((s) => ({ ...s, gameId: id }))].sort((a, b) => a.gameId - b.gameId || a.aggregator.localeCompare(b.aggregator))
  } else {
    if ((change.scope === 'global' && change.targetId !== 0) || (change.scope === 'provider' && !next.providers.some((p) => p.id === change.targetId)) || (change.scope === 'game' && !next.games.some((g) => g.id === change.targetId))) throw new Error('路由目标不存在')
    next.rules = next.rules.filter((r) => r.scope !== change.scope || r.targetId !== change.targetId)
    if (change.aggregator) next.rules.push({ scope: change.scope, targetId: change.targetId, aggregator: change.aggregator })
  }
  const rawByUuid = new Map(upstream.map((s) => [s.uuid, s]))
  const claimed = new Set<string>()
  for (const source of next.sources) {
    const game = next.games.find((g) => g.id === source.gameId)!
    const provider = next.providers.find((p) => p.id === game.providerId)
    const raw = rawByUuid.get(source.uuid)
    if (!provider || !raw || raw.aggregator !== source.aggregator || !provider.aliases[source.aggregator].includes(raw.provider)) throw new Error(`来源不存在或厂商别名未确认：${source.uuid}`)
    if (claimed.has(source.uuid)) throw new Error(`来源已绑定其他业务游戏：${source.uuid}`)
    claimed.add(source.uuid)
    if (raw.currencies?.length && source.currencies.some((c) => !raw.currencies!.includes(c))) throw new Error(`来源未支持所选币种：${source.uuid}`)
  }
  return next
}

export function previewRouting(before: RoutingConfig, after: RoutingConfig, upstream: SourceGame[]) {
  const raw = new Map(upstream.map((s) => [s.uuid, s]))
  const rows = after.games.map((game) => {
    const previous = before.games.find((g) => g.id === game.id)
    const old = previous && routeFor(before, previous)
    const route = routeFor(after, game)
    const origin = route.source && raw.get(route.source.uuid)
    return { id: game.id, name: game.name, enabled: game.enabled, isActive: game.isActive, before: old?.source?.uuid ?? null, after: route.source?.uuid ?? null, level: route.level,
      changed: !!(previous?.enabled || game.enabled) && (previous?.enabled !== game.enabled || previous?.isActive !== game.isActive || old?.source?.uuid !== route.source?.uuid),
      issue: !route.source ? '缺少目标聚合商映射' : !origin?.available ? '上游维护或下线' : null,
      currencies: route.source?.currencies ?? [], aliases: after.sources.filter((s) => s.gameId === game.id).map((s) => s.uuid) }
  })
  return { rows, changed: rows.filter((r) => r.changed).length, missing: rows.filter((r) => !r.after).length, unavailable: rows.filter((r) => r.issue).length,
    blocking: rows.filter((r) => r.enabled && r.isActive && r.changed && r.issue).length }
}

export async function resolveGameRoute(env: Env, uuid: string, currency?: string, device?: string, userId?: string): Promise<{ uuid: string; canonicalUuid: string; managed: boolean }> {
  if (!isMysqlEnabled(env)) return { uuid, canonicalUuid: uuid, managed: false }
  const db = getMysqlPool(env)
  // 起游戏必须读取刚提交的路由；进程缓存只用于目录展示，不能让多实例在切换后各走不同渠道。
  const config = await readRoutingConfig(db)
  const binding = config.sources.find((s) => s.uuid === uuid)
  const game = config.games.find((g) => g.enabled && (g.uuid === uuid || g.id === binding?.gameId))
  if (!game) return { uuid, canonicalUuid: uuid, managed: false }
  if (!game.isActive) throw new Error('该游戏已下架')
  const { source } = routeFor(config, game)
  if (!source) throw new Error('当前渠道缺少已确认的游戏映射')
  const selectedCurrency = (currency || 'PHP').toUpperCase()
  if (!source.currencies.includes(selectedCurrency)) throw new Error('当前游戏渠道不支持所选币种')
  const raw = await readSourceGame(db, source)
  if (!raw?.available) throw new Error('当前游戏渠道正在维护')
  if (raw.currencies?.length && !raw.currencies.includes(selectedCurrency)) throw new Error('上游不支持所选币种')
  if (device === 'desktop' ? !raw.desktop : !raw.mobile) throw new Error('当前游戏渠道不支持此设备')
  if (source.aggregator === 'wxgame' && userId) {
    const [players] = await db.query<RowDataPacket[]>('SELECT currency FROM bg_aggregator_player WHERE aggregator_id = ? AND user_id = ?', ['wxgame', userId])
    if (players.some((p) => p.currency !== selectedCurrency)) throw new Error('WXGame 账号币种与所选币种不一致')
  }
  return { uuid: source.uuid, canonicalUuid: game.uuid, managed: true }
}

export function projectCatalog(games: DbGame[], config: RoutingConfig, upstream: SourceGame[]): DbGame[] {
  const active = config.games.filter((g) => g.enabled)
  if (!active.length) return games
  const raw = new Map(upstream.map((s) => [s.uuid, s]))
  const managedIds = new Set(config.sources.filter((s) => active.some((g) => g.id === s.gameId)).map((s) => s.uuid))
  const output = games.filter((g) => !managedIds.has(g.uuid))
  for (const game of active) {
    if (!game.isActive) continue
    const display = raw.get(game.uuid)
    if (!display) continue
    const base = games.find((g) => g.uuid === game.uuid)
    const selected = routeFor(config, game).source
    const target = selected && raw.get(selected.uuid)
    output.push({
      nameId: null, nameVi: null, nameZh: null, category: null, subCategory: null, sortCategory: display.category, imageUrl: display.imageUrl,
      hasLobby: false, isMobile: true, weight: 1, isFeatured: false, ...base, ...game.presentation,
      uuid: game.uuid, name: game.name, provider: config.providers.find((p) => p.id === game.providerId)!.name,
      aggregator: selected?.aggregator, imageHqUrl: game.presentation.imageUrl ?? base?.imageHqUrl ?? display.imageUrl,
      rtp: target?.rtp ?? null, supportedCurrencies: selected?.currencies ?? [], isAvailable: !!target?.available && !!target.mobile,
      cashbackTier: selected?.uuid === game.uuid ? base?.cashbackTier : games.find((g) => g.uuid === selected?.uuid)?.cashbackTier,
      aliases: config.sources.filter((s) => s.gameId === game.id).map((s) => s.uuid),
    })
  }
  return output
}

export async function projectGameCatalog(env: Env, games: DbGame[]): Promise<DbGame[]> {
  const config = await getRoutingConfig(env)
  if (!config.games.some((g) => g.enabled)) return games
  const sources = games.flatMap((g): SourceGame[] => g.aggregator ? [{
    uuid: g.uuid,
    aggregator: g.aggregator,
    provider: g.provider,
    name: g.name,
    imageUrl: g.imageUrl,
    available: g.isAvailable !== false,
    currencies: g.supportedCurrencies ?? null,
    mobile: g.isMobile,
    desktop: true,
    supportsRtp: false,
    rtp: g.rtp ?? null,
    category: g.sortCategory ?? 'other',
    syncedAt: g.createdAt ?? '',
  }] : [])
  return projectCatalog(games, config, sources)
}

export function gameAliasIndex(games: DbGame[]): Map<string, DbGame> {
  return new Map(games.flatMap((g) => [g.uuid, ...(g.aliases ?? [])].map((uuid) => [uuid, g] as const)))
}
