/**
 * overlay 示例（P3-4）：这家客户要把「投注榜」挪到首页顶部、并且不要活动横条。
 *
 * 这类需求本该用 L2 的「首页布局」在后台点一下就完事 —— 放在这里只是为了给出一个
 * 最小可运行的 overlay 例子。真实 overlay 应该覆盖的是「后台配不出来」的东西，
 * 比如某个区块要换一套完全不同的排版。
 */
export const DEFAULT_BLOCK_ORDER = [
  'bettingTable', 'announcement', 'banner', 'recentPlayed', 'popular', 'highRebate',
  'highRtp', 'recommended', 'slots', 'providerZone', 'casino', 'newGames', 'perya',
  'fishing', 'lottery', 'baccarat', 'sports',
] as const
