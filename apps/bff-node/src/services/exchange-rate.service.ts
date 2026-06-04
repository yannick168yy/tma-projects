import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { isMysqlEnabled } from '../clients/mysql.client.js'

export interface RateResult {
  rate: number       // 1 from = rate to
  fetchedAt: string  // ISO
  source: string
}

const REDIS_TTL = 3600 // 1 小时
const MANUAL_TTL = 7 * 24 * 3600 // 手动覆盖：7 天
const redisKey = (from: string, to: string) => `exchange_rate:${from}:${to}`

/** 与 web-tma 钱包支持的虚拟币种对齐（均为 xxx → PHP） */
export const CRYPTO_RATE_CURRENCIES = ['USDT', 'USDC', 'TON', 'TRX', 'BNB', 'ETH', 'BTC'] as const

export const RATE_PAIRS: [string, string][] = CRYPTO_RATE_CURRENCIES.map(
  (c) => [c, 'PHP'] as [string, string],
)

const COINGECKO_IDS: Record<string, string> = {
  USDT: 'tether',
  USDC: 'usd-coin',
  TON: 'the-open-network',
  TRX: 'tron',
  BNB: 'binancecoin',
  ETH: 'ethereum',
  BTC: 'bitcoin',
}

const COINGECKO_ID_TO_SYMBOL = Object.fromEntries(
  Object.entries(COINGECKO_IDS).map(([symbol, id]) => [id, symbol]),
) as Record<string, string>

function fallbackRate(from: string, to: string, env: Env): number | null {
  if (to !== 'PHP') return null
  if (from === 'USD' || from === 'USDT' || from === 'USDC') return env.USDT_TO_PHP_RATE
  if (from === 'TON') return env.TON_TO_PHP_RATE
  if (from === 'PHP') return 1
  return null
}

function coingeckoHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {}
  if (env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = env.COINGECKO_API_KEY
  return headers
}

/** CoinGecko simple/price：一次请求批量拉取加密货币 → PHP */
async function fetchCryptoBatchFromCoinGecko(
  symbols: string[],
  to: string,
  env: Env,
): Promise<Record<string, RateResult>> {
  const ids = [...new Set(symbols.map((s) => COINGECKO_IDS[s]).filter(Boolean))]
  if (ids.length === 0) return {}

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=${to.toLowerCase()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: coingeckoHeaders(env) })
  if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${await res.text()}`)

  const data = await res.json() as Record<string, Record<string, number>>
  const fetchedAt = new Date().toISOString()
  const out: Record<string, RateResult> = {}

  for (const [coinId, prices] of Object.entries(data)) {
    const symbol = COINGECKO_ID_TO_SYMBOL[coinId]
    const rate = prices?.[to.toLowerCase()]
    if (!symbol || typeof rate !== 'number') continue
    out[symbol] = { rate, fetchedAt, source: 'coingecko' }
  }
  return out
}

async function fetchFromCoinGecko(from: string, to: string, env: Env): Promise<RateResult> {
  if (!(from in COINGECKO_IDS)) throw new Error(`Unsupported currency for CoinGecko: ${from}`)
  const batch = await fetchCryptoBatchFromCoinGecko([from], to, env)
  const result = batch[from]
  if (!result) throw new Error(`CoinGecko: missing rate for ${from}→${to}`)
  return result
}

export async function getRate(redis: Redis, from: string, to: string, env: Env): Promise<RateResult> {
  if (from === to) return { rate: 1, fetchedAt: new Date().toISOString(), source: 'identity' }

  const cached = await redis.get(redisKey(from, to))
  if (cached) return JSON.parse(cached) as RateResult

  let result: RateResult
  try {
    result = await fetchFromCoinGecko(from, to, env)
  } catch (err) {
    const fb = fallbackRate(from, to, env)
    if (fb == null) throw new Error(`No exchange rate for ${from}→${to}: ${err}`)
    console.warn(`[exchange-rate] API failed, using fallback for ${from}→${to}:`, err)
    result = { rate: fb, fetchedAt: new Date().toISOString(), source: 'env-fallback' }
  }

  await redis.setex(redisKey(from, to), REDIS_TTL, JSON.stringify(result))
  return result
}

export async function setManualRate(redis: Redis, from: string, to: string, rate: number, env: Env): Promise<RateResult> {
  const result: RateResult = { rate, fetchedAt: new Date().toISOString(), source: 'manual' }
  await redis.setex(redisKey(from, to), MANUAL_TTL, JSON.stringify(result))
  if (isMysqlEnabled(env)) {
    await getMysqlPool(env).execute(
      `INSERT INTO bg_exchange_rate (currency_from, currency_to, rate, source, fetched_at) VALUES (?, ?, ?, 'manual', NOW(3))`,
      [from, to, rate],
    )
  }
  return result
}

export async function clearManualRate(redis: Redis, from: string, to: string): Promise<void> {
  await redis.del(redisKey(from, to))
}

export async function getAllCurrentRates(redis: Redis, env: Env): Promise<Array<{
  from: string; to: string; rate: number | null; source: string | null; fetchedAt: string | null
}>> {
  return Promise.all(
    RATE_PAIRS.map(async ([from, to]) => {
      const cached = await redis.get(redisKey(from, to))
      if (cached) {
        const r = JSON.parse(cached) as RateResult
        return { from, to, rate: r.rate, source: r.source, fetchedAt: r.fetchedAt }
      }
      const fb = fallbackRate(from, to, env)
      if (fb != null) return { from, to, rate: fb, source: 'env-fallback', fetchedAt: null }
      return { from, to, rate: null, source: null, fetchedAt: null }
    }),
  )
}

export async function getRateHistory(env: Env, limit = 1000): Promise<Array<{
  id: number; fetchedAt: string; source: string; rates: Record<string, number>
}>> {
  if (!isMysqlEnabled(env)) return []
  const [rows] = await getMysqlPool(env).query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT
       MIN(id) AS id,
       MIN(fetched_at) AS fetchedAt,
       GROUP_CONCAT(DISTINCT source ORDER BY source SEPARATOR ',') AS source,
       JSON_OBJECTAGG(currency_from, CAST(rate AS DOUBLE)) AS rates
     FROM (SELECT * FROM bg_exchange_rate ORDER BY id DESC LIMIT ?) t
     GROUP BY FLOOR(UNIX_TIMESTAMP(fetched_at) / 5)
     ORDER BY id DESC`,
    [limit],
  )
  return rows.map(row => ({
    id: row.id as number,
    fetchedAt: row.fetchedAt instanceof Date ? row.fetchedAt.toISOString() : String(row.fetchedAt),
    source: row.source as string,
    rates: typeof row.rates === 'string' ? JSON.parse(row.rates) as Record<string, number> : row.rates as Record<string, number>,
  }))
}

async function persistRate(
  redis: Redis,
  env: Env,
  from: string,
  to: string,
  result: RateResult,
): Promise<void> {
  await redis.setex(redisKey(from, to), REDIS_TTL, JSON.stringify(result))
  if (isMysqlEnabled(env)) {
    await getMysqlPool(env).execute(
      `INSERT INTO bg_exchange_rate (currency_from, currency_to, rate, source, fetched_at)
       VALUES (?, ?, ?, ?, NOW(3))`,
      [from, to, result.rate, result.source],
    )
  }
  console.log(`[exchange-rate] ${from}→${to} = ${result.rate} (${result.source})`)
}

async function isManualRate(redis: Redis, from: string, to: string): Promise<boolean> {
  const cached = await redis.get(redisKey(from, to))
  return Boolean(cached && (JSON.parse(cached) as RateResult).source === 'manual')
}

/** 定时刷新：单次 CoinGecko simple/price 批量请求 */
export async function refreshRates(redis: Redis, env: Env): Promise<void> {
  const toRefresh: string[] = []

  for (const [from, to] of RATE_PAIRS) {
    if (to !== 'PHP' || (await isManualRate(redis, from, to))) continue
    toRefresh.push(from)
  }

  if (toRefresh.length === 0) return

  try {
    const batch = await fetchCryptoBatchFromCoinGecko(toRefresh, 'PHP', env)
    for (const from of toRefresh) {
      const result = batch[from]
      if (!result) {
        console.error(`[exchange-rate] refresh ${from}→PHP failed: missing in CoinGecko batch`)
        continue
      }
      await persistRate(redis, env, from, 'PHP', result)
    }
  } catch (err) {
    console.error('[exchange-rate] batch refresh failed:', err)
    for (const from of toRefresh) {
      try {
        const result = await fetchFromCoinGecko(from, 'PHP', env)
        await persistRate(redis, env, from, 'PHP', result)
      } catch (singleErr) {
        console.error(`[exchange-rate] refresh ${from}→PHP failed:`, singleErr)
      }
    }
  }
}

export async function convertToPHPCents(
  amount: number,
  fromCurrency: string,
  redis: Redis,
  env: Env,
): Promise<{ cents: number; rate: RateResult }> {
  const rate = await getRate(redis, fromCurrency, 'PHP', env)
  const cents = Math.round(amount * rate.rate * 100)
  return { cents, rate }
}
