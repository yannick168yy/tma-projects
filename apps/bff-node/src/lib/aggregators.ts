/**
 * 聚合商登记表（P3-8）。
 *
 * 现状是单聚合商（win568）。这里**不做** provider 接口抽象 ——
 * 只有一个实现时设计出来的抽象会把这一家的假设焊进去（回调字段、幂等键形状、
 * 余额同步时机、密钥轮换方式），第二家来了照样不合，而改造面是注单与钱包链路。
 *
 * 这里做的是「把缝留出来」：
 *   1. `aggregator_id` 的取值集中在这一处，不再散落 48 个字符串字面量
 *   2. 第二家接入时要实现哪些能力，写在 docs/architecture/06-aggregator-integration.md，
 *      那份清单是从现有代码里描出来的，不是凭空设计的
 *
 * 判断「该不该抽象」的标准很实际：等真有第二家的接口文档在手，
 * 两家的差异点摆在一起才知道该抽在哪一层。
 */
export const AGGREGATOR_IDS = ['568win'] as const
export type AggregatorId = (typeof AGGREGATOR_IDS)[number]

/**
 * 默认聚合商。所有按 `aggregator_id` 过滤的查询都用它，
 * 第二家接入时 grep 这个常量就能找到全部需要按聚合商分流的地方。
 *
 * SQL 里用模板插值而不是占位符：这几条查询的参数数组很长（VIP 负盈利那条有十几个），
 * 重新编号占位符是最容易埋 bug 的改法；而插的是联合类型的编译期常量，不是入参，
 * 没有注入面。
 */
export const DEFAULT_AGGREGATOR: AggregatorId = '568win'

export function isAggregatorId(v: unknown): v is AggregatorId {
  return typeof v === 'string' && (AGGREGATOR_IDS as readonly string[]).includes(v)
}
