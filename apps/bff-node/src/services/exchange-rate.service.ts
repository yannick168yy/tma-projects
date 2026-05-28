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

export const RATE_PAIRS: [string, string][] = [
  ['EUR', 'PHP'],
  ['USD', 'PHP'],
  ['USDT', 'PHP'],
  ['TON', 'PHP'],
]

// USDT/TON 是加密货币，exchangerate-api.com 不支持，直接用 env 兜底，避免浪费 API 配额
const API_SKIP_PAIRS = new Set(['USDT', 'TON'])

// ── 内置兜底汇率（从 env 读，无 API key 时使用）────────────────────────────────
function fallbackRate(from: string, to: string, env: Env): number | null {
  if (to !== 'PHP') return null
  if (from === 'USD' || from === 'USDT') return env.USDT_TO_PHP_RATE
  if (from === 'TON')                    return env.TON_TO_PHP_RATE
  if (from === 'EUR')                    return env.EUR_TO_PHP_RATE
  if (from === 'PHP')                    return 1
  return null
}

// ── 从第三方 API 拉取汇率（freecurrencyapi.com）──────────────────────────────────
async function fetchFromApi(from: string, to: string, env: Env): Promise<RateResult> {
  if (!env.EXCHANGE_RATE_API_KEY) throw new Error('EXCHANGE_RATE_API_KEY not configured')

  const url = `https://api.freecurrencyapi.com/v1/latest?apikey=${env.EXCHANGE_RATE_API_KEY}&base_currency=${from}&currencies=${to}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`freecurrencyapi ${res.status}: ${await res.text()}`)

  const data = await res.json() as { data: Record<string, number> }
  const rate = data?.data?.[to]
  if (typeof rate !== 'number') throw new Error(`freecurrencyapi: missing rate for ${from}→${to}: ${JSON.stringify(data)}`)

  return { rate, fetchedAt: new Date().toISOString(), source: 'freecurrencyapi' }
}

// ── 核心：获取汇率（Redis 缓存 → API → env 兜底）────────────────────────────────
export async function getRate(redis: Redis, from: string, to: string, env: Env): Promise<RateResult> {
  if (from === to) return { rate: 1, fetchedAt: new Date().toISOString(), source: 'identity' }

  // 1. Redis 缓存
  const cached = await redis.get(redisKey(from, to))
  if (cached) return JSON.parse(cached) as RateResult

  // 2. 拉取 API
  let result: RateResult
  try {
    result = await fetchFromApi(from, to, env)
  } catch (err) {
    // 3. API 失败 → 使用 env 兜底汇率（保证业务不中断）
    const fb = fallbackRate(from, to, env)
    if (fb == null) throw new Error(`No exchange rate for ${from}→${to}: ${err}`)
    console.warn(`[exchange-rate] API failed, using fallback for ${from}→${to}:`, err)
    result = { rate: fb, fetchedAt: new Date().toISOString(), source: 'env-fallback' }
  }

  // 写入 Redis 缓存
  await redis.setex(redisKey(from, to), REDIS_TTL, JSON.stringify(result))
  return result
}

// ── 手动覆盖汇率（管理员设置，7 天有效，不被自动刷新覆盖）────────────────────────
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

// ── 清除手动覆盖（恢复 API 自动获取）────────────────────────────────────────────
export async function clearManualRate(redis: Redis, from: string, to: string): Promise<void> {
  await redis.del(redisKey(from, to))
}

// ── 管理员查询：所有常用汇率对的当前状态 ─────────────────────────────────────────
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

// ── 汇率历史记录（按批次分组，最近 N 条原始记录合并展示）────────────────────────────
export async function getRateHistory(env: Env, limit = 1000): Promise<Array<{
  id: number; fetchedAt: string; source: string; rates: Record<string, number>
}>> {
  if (!isMysqlEnabled(env)) return []
  const [rows] = await getMysqlPool(env).query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT
       MIN(id) AS id,
       MIN(fetched_at) AS fetchedAt,
       MAX(source) AS source,
       JSON_OBJECTAGG(currency_from, CAST(rate AS DOUBLE)) AS rates
     FROM (SELECT * FROM bg_exchange_rate ORDER BY id DESC LIMIT ?) t
     GROUP BY DATE_FORMAT(fetched_at, '%Y%m%d%H%i%s')
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

// ── 定时刷新：每小时主动更新常用汇率，手动覆盖的对跳过 ───────────────────────────
export async function refreshRates(redis: Redis, env: Env): Promise<void> {
  for (const [from, to] of RATE_PAIRS) {
    // 手动覆盖的跳过自动刷新
    const cached = await redis.get(redisKey(from, to))
    if (cached && (JSON.parse(cached) as RateResult).source === 'manual') continue

    let result: RateResult
    if (env.EXCHANGE_RATE_API_KEY && !API_SKIP_PAIRS.has(from)) {
      try {
        result = await fetchFromApi(from, to, env)
      } catch (err) {
        console.error(`[exchange-rate] refresh ${from}→${to} failed:`, err)
        continue
      }
    } else {
      const fb = fallbackRate(from, to, env)
      if (fb == null) continue
      result = { rate: fb, fetchedAt: new Date().toISOString(), source: 'env-fallback' }
    }

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
}

// ── 便捷转换：原币金额 → PHP 分 ─────────────────────────────────────────────────
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
