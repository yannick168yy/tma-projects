import { env } from '../config/env.js'

// 本地缓存，1小时有效
let cachedRates: Record<string, number> | null = null
let cacheExpiry = 0

// Testnet 币种映射到对应主网，使汇率保持一致
const TESTNET_TO_MAINNET: Record<string, string> = {
  TRX_TESTNET: 'TRX',
  TLK_TESTNET: 'TRX',
}

// CoinGecko id → 币种符号（freecurrencyapi 不支持加密货币）
const CRYPTO_COINGECKO_IDS: Record<string, string> = {
  TRX: 'tron',
  BNB: 'binancecoin',
  ETH: 'ethereum',
  BTC: 'bitcoin',
}

// 返回 1单位指定货币 → PHP 的汇率
// 例：getPhpRate('EUR') → 62.5 表示 1 EUR = 62.5 PHP
export async function getPhpRate(currency: string): Promise<number> {
  if (currency === 'PHP') return 1

  const key = TESTNET_TO_MAINNET[currency.toUpperCase()] ?? currency.toUpperCase()
  const rates = await fetchRates()
  return rates[key] ?? fallbackRate(key)
}

// 返回多个货币的 PHP 汇率 Map
export async function fetchRates(): Promise<Record<string, number>> {
  if (cachedRates && Date.now() < cacheExpiry) return cachedRates

  if (!env.EXCHANGE_RATE_API_KEY) {
    cachedRates = buildFallback()
    cacheExpiry = Date.now() + 60 * 60 * 1000
    return cachedRates
  }

  const result: Record<string, number> = buildFallback()

  // 法币汇率（freecurrencyapi）
  try {
    const url = `https://api.freecurrencyapi.com/v1/latest?apikey=${env.EXCHANGE_RATE_API_KEY}&base_currency=PHP&currencies=EUR,USD,USDT,THB,VND,IDR,MYR,SGD`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`FX API ${res.status}`)
    const json = await res.json() as { data: Record<string, number> }
    for (const [cur, rateFromPhp] of Object.entries(json.data)) {
      if (rateFromPhp > 0) result[cur.toUpperCase()] = 1 / rateFromPhp
    }
  } catch (err) {
    console.warn('[exchange-rate] freecurrencyapi failed, using fallback for fiat:', err)
  }

  // 加密货币汇率（CoinGecko，免费无需 key）
  try {
    const ids = Object.values(CRYPTO_COINGECKO_IDS).join(',')
    const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=php`
    const cgRes = await fetch(cgUrl, { signal: AbortSignal.timeout(8000) })
    if (!cgRes.ok) throw new Error(`CoinGecko API ${cgRes.status}`)
    const cgJson = await cgRes.json() as Record<string, { php: number }>
    for (const [symbol, geckoId] of Object.entries(CRYPTO_COINGECKO_IDS)) {
      const price = cgJson[geckoId]?.php
      if (price && price > 0) result[symbol] = price
    }
  } catch (err) {
    console.warn('[exchange-rate] CoinGecko failed, using fallback for crypto:', err)
  }

  cachedRates = result
  cacheExpiry = Date.now() + 60 * 60 * 1000
  return cachedRates
}

function buildFallback(): Record<string, number> {
  return {
    EUR: env.EUR_TO_PHP_RATE,
    USD: env.USDT_TO_PHP_RATE,
    USDT: env.USDT_TO_PHP_RATE,
    USDC: env.USDT_TO_PHP_RATE,
    TRX: env.TRX_TO_PHP_RATE,
    BNB: env.BNB_TO_PHP_RATE,
    ETH: env.ETH_TO_PHP_RATE,
    BTC: env.BTC_TO_PHP_RATE,
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
