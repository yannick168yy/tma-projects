import { env } from '../config/env.js'

// 本地缓存，1小时有效
let cachedRates: Record<string, number> | null = null
let cacheExpiry = 0

// Testnet 币种映射到对应主网，使汇率保持一致
const TESTNET_TO_MAINNET: Record<string, string> = {
  TRX_TESTNET: 'TRX',
  TLK_TESTNET: 'TRX',
}

// CoinGecko coin id → 平台币种符号
const COINGECKO_ID_MAP: Record<string, string> = {
  tron:         'TRX',
  binancecoin:  'BNB',
  ethereum:     'ETH',
  bitcoin:      'BTC',
  tether:       'USDT',
  'usd-coin':   'USDC',
  'euro-token': 'EUR',
}

// 返回 1单位指定货币 → PHP 的汇率
// 例：getPhpRate('EUR') → 62.5 表示 1 EUR = 62.5 PHP
export async function getPhpRate(currency: string): Promise<number> {
  if (currency === 'PHP') return 1

  const key = TESTNET_TO_MAINNET[currency.toUpperCase()] ?? currency.toUpperCase()
  const rates = await fetchRates()
  return rates[key] ?? fallbackRate(key)
}

// 返回所有货币的 PHP 汇率 Map（全量从 CoinGecko 拉取）
export async function fetchRates(): Promise<Record<string, number>> {
  if (cachedRates && Date.now() < cacheExpiry) return cachedRates

  const result: Record<string, number> = buildFallback()

  try {
    const ids = Object.keys(COINGECKO_ID_MAP).join(',')
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=php`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`CoinGecko API ${res.status}`)
    const json = await res.json() as Record<string, { php: number }>
    for (const [geckoId, symbol] of Object.entries(COINGECKO_ID_MAP)) {
      const price = json[geckoId]?.php
      if (price && price > 0) result[symbol] = price
    }
    cacheExpiry = Date.now() + 60 * 60 * 1000
  } catch (err) {
    console.warn('[exchange-rate] CoinGecko failed, using env fallback:', err)
    cacheExpiry = Date.now() + 5 * 60 * 1000 // 失败后5分钟重试
  }

  cachedRates = result
  return cachedRates
}

function buildFallback(): Record<string, number> {
  return {
    EUR:  env.EUR_TO_PHP_RATE,
    USD:  env.USDT_TO_PHP_RATE,
    USDT: env.USDT_TO_PHP_RATE,
    USDC: env.USDT_TO_PHP_RATE,
    TRX:  env.TRX_TO_PHP_RATE,
    BNB:  env.BNB_TO_PHP_RATE,
    ETH:  env.ETH_TO_PHP_RATE,
    BTC:  env.BTC_TO_PHP_RATE,
  }
}

function fallbackRate(currency: string): number {
  const upper = currency.toUpperCase()
  if (upper === 'EUR') return env.EUR_TO_PHP_RATE
  if (upper === 'USD' || upper === 'USDT' || upper === 'USDC') return env.USDT_TO_PHP_RATE
  if (upper === 'TRX') return env.TRX_TO_PHP_RATE
  if (upper === 'BNB') return env.BNB_TO_PHP_RATE
  if (upper === 'ETH') return env.ETH_TO_PHP_RATE
  if (upper === 'BTC') return env.BTC_TO_PHP_RATE
  return 1
}
