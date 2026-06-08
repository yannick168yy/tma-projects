import { env } from '../config/env.js'

// 本地缓存，1小时有效
let cachedRates: Record<string, number> | null = null
let cacheExpiry = 0

// 返回 1单位指定货币 → PHP 的汇率
// 例：getPhpRate('EUR') → 62.5 表示 1 EUR = 62.5 PHP
export async function getPhpRate(currency: string): Promise<number> {
  if (currency === 'PHP') return 1

  const rates = await fetchRates()
  return rates[currency.toUpperCase()] ?? fallbackRate(currency)
}

// 返回多个货币的 PHP 汇率 Map
export async function fetchRates(): Promise<Record<string, number>> {
  if (cachedRates && Date.now() < cacheExpiry) return cachedRates

  if (!env.EXCHANGE_RATE_API_KEY) {
    cachedRates = buildFallback()
    cacheExpiry = Date.now() + 60 * 60 * 1000
    return cachedRates
  }

  try {
    const url = `https://api.freecurrencyapi.com/v1/latest?apikey=${env.EXCHANGE_RATE_API_KEY}&base_currency=PHP&currencies=EUR,USD,USDT,THB,VND,IDR,MYR,SGD`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`FX API ${res.status}`)
    const json = await res.json() as { data: Record<string, number> }
    // freecurrencyapi 返回：1 PHP = X 外币，需要取倒数
    const raw = json.data
    const result: Record<string, number> = {}
    for (const [cur, rateFromPhp] of Object.entries(raw)) {
      if (rateFromPhp > 0) result[cur.toUpperCase()] = 1 / rateFromPhp
    }
    cachedRates = result
    cacheExpiry = Date.now() + 60 * 60 * 1000
    return cachedRates
  } catch {
    // API 失败时用 env 兜底
    cachedRates = buildFallback()
    cacheExpiry = Date.now() + 5 * 60 * 1000 // 失败后5分钟再重试
    return cachedRates
  }
}

function buildFallback(): Record<string, number> {
  return {
    EUR: env.EUR_TO_PHP_RATE,
    USD: env.USDT_TO_PHP_RATE,
    USDT: env.USDT_TO_PHP_RATE,
    USDC: env.USDT_TO_PHP_RATE,
    TRX: env.TRX_TO_PHP_RATE,
    TRX_TESTNET: env.TRX_TO_PHP_RATE,
    BNB: env.BNB_TO_PHP_RATE,
    ETH: env.ETH_TO_PHP_RATE,
    BTC: env.BTC_TO_PHP_RATE,
  }
}

function fallbackRate(currency: string): number {
  const upper = currency.toUpperCase()
  if (upper === 'EUR') return env.EUR_TO_PHP_RATE
  if (upper === 'USD' || upper === 'USDT' || upper === 'USDC') return env.USDT_TO_PHP_RATE
  if (upper === 'TRX' || upper === 'TRX_TESTNET') return env.TRX_TO_PHP_RATE
  if (upper === 'BNB') return env.BNB_TO_PHP_RATE
  if (upper === 'ETH') return env.ETH_TO_PHP_RATE
  if (upper === 'BTC') return env.BTC_TO_PHP_RATE
  return 1
}
