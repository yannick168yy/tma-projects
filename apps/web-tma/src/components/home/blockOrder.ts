/**
 * 首页区块的兜底顺序（P3-1）。
 *
 * 正常情况下顺序由服务端下发（`/slots/homepage` 的 sections，源头是 bff 的
 * HOME_LAYOUT_SECTIONS），这份只在拿到老缓存或接口失败时用。
 *
 * 两处清单无法合成一处：bff 与 web-tma 不共享 TS 包（packages/api-contracts 只有
 * openapi 文档）。真要合并得先起一个 workspace 包，收益不抵改造面 ——
 * 所以这里靠 HomeContent 里的开发期断言兜住「加了块忘了加顺序」。
 */
export const DEFAULT_BLOCK_ORDER = [
  'announcement', 'banner', 'recentPlayed', 'popular', 'cashRebate', 'highRebate', 'highRtp',
  'lossRebate', 'recommended', 'slots', 'providerZone', 'casino', 'newGames', 'perya',
  'fishing', 'lottery', 'baccarat', 'sports', 'bettingTable',
] as const
