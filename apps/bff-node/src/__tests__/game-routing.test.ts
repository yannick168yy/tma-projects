import { describe, expect, it } from 'vitest'
import {
  applyRoutingChange,
  gameAliasIndex,
  previewRouting,
  projectCatalog,
  routeFor,
  type RoutingConfig,
  type SourceGame,
} from '../services/game-routing.service.js'
import type { DbGame } from '../services/sg-game.service.js'
import { normalizedGameName } from '../routes/admin/game-routing.routes.js'

const config: RoutingConfig = {
  providers: [{ id: 1, code: 'pg', name: 'PG', aliases: { '568win': ['PG Soft'], wxgame: ['pg'] } }],
  games: [{ id: 1, providerId: 1, uuid: '568win:10:20', name: '麻将胡了', enabled: true, isActive: true, presentation: { weight: 9000 } }],
  sources: [
    { gameId: 1, aggregator: '568win', uuid: '568win:10:20', currencies: ['PHP', 'USDT'] },
    { gameId: 1, aggregator: 'wxgame', uuid: 'wxgame:pg:mahjong-ways', currencies: ['PHP'] },
  ],
  rules: [],
}

const upstream: SourceGame[] = [
  { uuid: '568win:10:20', aggregator: '568win', provider: 'PG Soft', name: 'Mahjong Ways', imageUrl: 'a', available: true, currencies: ['PHP', 'USDT'], mobile: true, desktop: true, supportsRtp: false, rtp: 96, category: 'slots', syncedAt: '' },
  { uuid: 'wxgame:pg:mahjong-ways', aggregator: 'wxgame', provider: 'pg', name: 'Mahjong Ways', imageUrl: 'b', available: true, currencies: ['PHP'], mobile: true, desktop: true, supportsRtp: true, rtp: null, category: 'slots', syncedAt: '' },
]

const rawGames: DbGame[] = upstream.map((g) => ({
  uuid: g.uuid, aggregator: g.aggregator, name: g.name, nameId: null, nameVi: null, nameZh: null,
  provider: g.provider, category: null, subCategory: null, sortCategory: g.category, imageUrl: g.imageUrl,
  imageHqUrl: g.imageUrl, hasLobby: false, isMobile: true, weight: 1, isFeatured: false,
  isAvailable: g.available, supportedCurrencies: g.currencies,
}))

describe('统一游戏路由', () => {
  it('候选名称只忽略大小写、空格和符号，不会把续作误认为初代', () => {
    expect(normalizedGameName('Mahjong Ways™')).toBe(normalizedGameName('mahjong-ways'))
    expect(normalizedGameName('Mahjong Ways 2')).not.toBe(normalizedGameName('Mahjong Ways'))
  })

  it('无规则时保持公开 ID 对应的原聚合商', () => {
    expect(routeFor(config, config.games[0]).source?.uuid).toBe('568win:10:20')
  })

  it('单游戏规则覆盖厂商和全局规则', () => {
    const changed = { ...config, rules: [
      { scope: 'global' as const, targetId: 0, aggregator: '568win' as const },
      { scope: 'provider' as const, targetId: 1, aggregator: '568win' as const },
      { scope: 'game' as const, targetId: 1, aggregator: 'wxgame' as const },
    ] }
    expect(routeFor(changed, changed.games[0]).source?.uuid).toBe('wxgame:pg:mahjong-ways')
  })

  it('启用统一游戏后只展示一张稳定卡，并保留两个旧 ID 别名', () => {
    const [game] = projectCatalog(rawGames, config, upstream)
    expect(game.uuid).toBe('568win:10:20')
    expect(game.aggregator).toBe('568win')
    expect(game.weight).toBe(9000)
    expect(gameAliasIndex([game]).get('wxgame:pg:mahjong-ways')).toBe(game)
  })

  it('草稿映射不会改变目录行为', () => {
    const draft = { ...config, games: [{ ...config.games[0], enabled: false }] }
    expect(projectCatalog(rawGames, draft, upstream)).toEqual(rawGames)
  })

  it('切换到维护来源时预览阻止已启用游戏保存', () => {
    const unavailable = upstream.map((g) => g.aggregator === 'wxgame' ? { ...g, available: false } : g)
    const next = applyRoutingChange(config, { kind: 'rule', scope: 'provider', targetId: 1, aggregator: 'wxgame' }, unavailable)
    const preview = previewRouting(config, next, unavailable)
    expect(preview.blocking).toBe(1)
    expect(preview.rows[0].issue).toBe('上游维护或下线')
  })

  it('未确认的来源、错误厂商和超出上游币种均不能建立映射', () => {
    const draft = { ...config, games: [], sources: [], rules: [] }
    const base = { kind: 'game' as const, providerId: 1, uuid: 'wxgame:pg:mahjong-ways', name: '麻将胡了', enabled: false, isActive: true, presentation: {}, confirmed: true as const }
    expect(() => applyRoutingChange(draft, { ...base, uuid: 'wxgame:pg:unknown', sources: [{ aggregator: 'wxgame', uuid: 'wxgame:pg:unknown', currencies: ['PHP'] }] }, upstream)).toThrow(/来源不存在/)
    expect(() => applyRoutingChange(draft, { ...base, sources: [{ aggregator: 'wxgame', uuid: 'wxgame:pg:mahjong-ways', currencies: ['USDT'] }] }, upstream)).toThrow(/币种/)
  })
})
