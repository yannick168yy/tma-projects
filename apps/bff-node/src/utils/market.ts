/** 后台报表的市场口径：币种、日切时区、渠道归属。
 *  单独成模块，避免 bi.service 与 marketing-bi.service 互相 import 形成循环。 */

export type BiMarket = 'ALL' | 'PH' | 'ID' | 'IN'

export function marketCurrency(market: BiMarket): 'ALL' | 'PHP' | 'IDR' | 'INR' {
  return market === 'PH' ? 'PHP' : market === 'ID' ? 'IDR' : market === 'IN' ? 'INR' : 'ALL'
}

/** 综合视图没有本币，统一折 USDT 展示 */
export function displayCurrency(market: BiMarket): 'USDT' | 'PHP' | 'IDR' | 'INR' {
  const currency = marketCurrency(market)
  return currency === 'ALL' ? 'USDT' : currency
}

/** 印度是 UTC+5:30，日切偏移必须允许半小时 */
export function marketOffsetHours(market: BiMarket): number {
  return market === 'ID' ? 7 : market === 'IN' ? 5.5 : 8
}

/** SQL 里日切用 MINUTE：INTERVAL 只吃整数，UTC+5:30 写成 HOUR 会被截断 */
export function marketOffsetMinutes(market: BiMarket): number {
  return Math.round(marketOffsetHours(market) * 60)
}

export function marketTimezoneLabel(market: BiMarket): string {
  return market === 'ID' ? 'UTC+7' : market === 'IN' ? 'UTC+5:30' : 'UTC+8'
}

/** 把小时偏移转成 ISO 时区串（+08:00 / +05:30） */
export function tzSuffix(offsetHours: number): string {
  const sign = offsetHours < 0 ? '-' : '+'
  const abs = Math.abs(offsetHours)
  const hh = String(Math.floor(abs)).padStart(2, '0')
  const mm = String(Math.round((abs - Math.floor(abs)) * 60)).padStart(2, '0')
  return `${sign}${hh}:${mm}`
}

/** bi_daily_channel 只有渠道名，按支付服务商前缀反推市场 */
export function marketChannelFilter(market: BiMarket): string {
  if (market === 'ID') return " AND channel LIKE 'unispay%'"
  if (market === 'IN') return " AND channel LIKE 'huitone%'"
  if (market === 'PH') return " AND channel NOT LIKE 'unispay%' AND channel NOT LIKE 'huitone%'"
  return ''
}
