/**
 * 聚合商登记表（P3-8，core-node 侧）。
 *
 * 与 bff-node 的 `lib/aggregators.ts` 是同一份内容的两份拷贝 —— 两个服务不共享
 * TS 包（packages/api-contracts 只有 openapi 文档）。值必须一致，
 * 因为它落在 `bg_bet_order.aggregator_id` 这一列上，一边写 '568win'、
 * 另一边查别的值就会静默查不到数据。
 *
 * 这里**不做** provider 接口抽象：只有一个实现时设计的抽象会把这一家的假设焊进去
 * （回调字段、幂等键形状、余额同步时机、密钥轮换方式），第二家来了照样不合，
 * 而改造面是注单与钱包链路。第二家要实现什么见
 * docs/architecture/06-aggregator-integration.md。
 */
export const AGGREGATOR_IDS = ['568win', 'wxgame'] as const
export type AggregatorId = (typeof AGGREGATOR_IDS)[number]

export const DEFAULT_AGGREGATOR: AggregatorId = '568win'

/** SQL 里按「全部游戏聚合商」过滤用。注单表还混着别的来源，不能省掉这个 IN 直接不过滤。 */
export const AGGREGATOR_IDS_SQL = AGGREGATOR_IDS.map((id) => `'${id}'`).join(', ')

