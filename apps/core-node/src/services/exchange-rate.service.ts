import { env } from '../config/env.js'
import type { Redis } from 'ioredis'

// 本地缓存，1小时有效
let cachedRates: Record<string, number> | null = null
let cacheExpiry = 0

// Testnet 币种映射到对应主网，使汇率保持一致
const TESTNET_TO_MAINNET: Record<string, string> = {
  TRX_TESTNET: 'TRX',
}

// CoinGecko coin id → 平台币种符号
const COINGECKO_ID_MAP: Record<string, string> = {
  tron:         'TRX',
  tether:       'USDT',
  'usd-coin':   'USDC',
  'euro-token': 'EUR',
}

// 返回 1单位指定货币 → PHP 的汇率。
export async function getPhpRate(currency: string, redis?: Pick<Redis, 'get'>): Promise<number> {
  return getExchangeRate(currency, 'PHP', redis)
}

// 返回 1 单位 from 可兑换的 to 数量；底层复用同一批基础汇率，不增加 API 请求。
export async function getExchangeRate(from: string, to: string, redis?: Pick<Redis, 'get'>): Promise<number> {
  const fromUpper = TESTNET_TO_MAINNET[from.toUpperCase()] ?? from.toUpperCase()
  const toUpper = TESTNET_TO_MAINNET[to.toUpperCase()] ?? to.toUpperCase()
  if (fromUpper === toUpper) return 1
  const rates = redis ? await fetchManagedRates(redis) : await fetchRates()
  const fromToUsdt = rates[fromUpper] ?? fallbackRate(fromUpper)
  const toToUsdt = rates[toUpper] ?? fallbackRate(toUpper)
  return fromToUsdt / toToUsdt
}

async function fetchManagedRates(redis: Pick<Redis, 'get'>): Promise<Record<string, number>> {
  const rates = buildFallback()
  const pairs = ['USDT:PHP', 'USDC:PHP', 'TRX:PHP', 'USDT:IDR'] as const
  const cached = await Promise.all(pairs.map(async (pair) => {
    const raw = await redis.get(`exchange_rate:${pair}`)
    if (!raw) return null
    try {
      const rate = Number((JSON.parse(raw) as { rate?: number }).rate)
      return Number.isFinite(rate) && rate > 0 ? rate : null
    } catch {
      return null
    }
  }))
  const usdtToPhp = cached[0] ?? env.USDT_TO_PHP_RATE
  rates.PHP = 1 / usdtToPhp
  rates.USDC = (cached[1] ?? env.USDT_TO_PHP_RATE) / usdtToPhp
  rates.TRX = (cached[2] ?? env.TRX_TO_PHP_RATE) / usdtToPhp
  rates.IDR = 1 / (cached[3] ?? env.USDT_TO_IDR_RATE)
  return rates
}

// 返回所有货币相对 USDT 的汇率 Map；CoinGecko 仍只需一次批量请求。
export async function fetchRates(): Promise<Record<string, number>> {
  if (cachedRates && Date.now() < cacheExpiry) return cachedRates

  const result: Record<string, number> = buildFallback()

  try {
    const ids = Object.keys(COINGECKO_ID_MAP).join(',')
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=php`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`CoinGecko API ${res.status}`)
    const json = await res.json() as Record<string, { php: number }>
    const usdtToPhp = json.tether?.php || env.USDT_TO_PHP_RATE
    result.PHP = 1 / usdtToPhp
    for (const [geckoId, symbol] of Object.entries(COINGECKO_ID_MAP)) {
      const price = json[geckoId]?.php
      if (price && price > 0) result[symbol] = price / usdtToPhp
    }
    result.USD = 1
    result.USDT = 1
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
    PHP:  1 / env.USDT_TO_PHP_RATE,
    EUR:  env.EUR_TO_PHP_RATE / env.USDT_TO_PHP_RATE,
    USD:  1,
    USDT: 1,
    USDC: 1,
    TRX:  env.TRX_TO_PHP_RATE / env.USDT_TO_PHP_RATE,
    IDR:  1 / env.USDT_TO_IDR_RATE,
  }
}

function fallbackRate(currency: string): number {
  const upper = currency.toUpperCase()
  if (upper === 'PHP') return 1 / env.USDT_TO_PHP_RATE
  if (upper === 'EUR') return env.EUR_TO_PHP_RATE / env.USDT_TO_PHP_RATE
  if (upper === 'USD' || upper === 'USDT' || upper === 'USDC') return 1
  if (upper === 'TRX') return env.TRX_TO_PHP_RATE / env.USDT_TO_PHP_RATE
  if (upper === 'IDR') return 1 / env.USDT_TO_IDR_RATE
  return 1
}
