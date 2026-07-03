/**
 * 568Win 游戏联网富化脚本（Gemini + Google Search grounding）
 *
 * 手动执行，不进自动部署。
 *
 * 用法:
 *   GEMINI_API_KEY=xxx \
 *   MYSQL_HOST=127.0.0.1 MYSQL_PORT=13306 \
 *   MYSQL_USER=betogo MYSQL_PASSWORD=xxx \
 *   npm start
 *
 * 可选环境变量:
 *   GEMINI_MODEL=gemini-2.5-flash   模型（需支持 google_search 工具）
 *   CONCURRENCY=4                   并发请求数
 *   LIMIT=0                         最多处理条数（0=不限，试跑用 LIMIT=10）
 *   FORCE=1                         重跑已富化过的游戏（默认只跑 web_enriched_at IS NULL）
 *   DRY_RUN=1                       只打印不写库
 *   PROVIDER=JiLiGaming             只跑指定厂商
 *
 * 存储规则:
 *   - 事实字段（volatility/max_win_multiplier/rtp_official/release_date/min_bet/max_bet）
 *     必须带 source_url 才落列，否则只留在 web_sources 供人工参考
 *   - description_en/zh 只填空缺，不覆盖已有值
 *   - aliases 去重后 append 进 search_keywords
 *   - similar_games 按 name_en 匹配成本站 uuid，匹配不上的丢弃
 */

import mysql from 'mysql2/promise'

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4)
const LIMIT = Number(process.env.LIMIT ?? 0)
const FORCE = process.env.FORCE === '1'
const DRY_RUN = process.env.DRY_RUN === '1'

const VOLATILITY_VALUES = new Set(['low', 'mid', 'high'])
const FEATURE_VALUES = new Set([
  'buy_bonus', 'free_spins', 'megaways', 'jackpot', 'cascading',
  'hold_and_win', 'multiplier', 'respin', 'expanding_wilds', 'cluster_pays',
])
const RISK_VALUES = new Set(['rtp_dispute', 'ip_infringe', 'payout_complaints', 'provider_reputation'])

interface Sourced<T> { value: T | null; source_url?: string; confidence?: number }

interface GeminiResult {
  volatility?: Sourced<string>
  max_win_multiplier?: Sourced<number>
  rtp_official?: Sourced<number>
  release_date?: Sourced<string>
  min_bet?: Sourced<number>
  max_bet?: Sourced<number>
  ph_popularity?: Sourced<number>
  series?: string | null
  features?: string[]
  aliases?: string[]
  similar_games?: string[]
  risk_flags?: string[]
  tagline_en?: string | null
  tagline_tl?: string | null
  description_tl?: string | null
  description_en?: string | null
  description_zh?: string | null
}

interface GameRow extends mysql.RowDataPacket {
  game_id: number
  game_provider_id: number
  provider: string | null
  name_en: string | null
  name_zh: string | null
  new_game_type: number | null
  site_category_auto: string | null
  rtp: number | null
}

function buildPrompt(g: GameRow): string {
  return `You are researching a real online casino game for a Philippine gaming operator. Use Google Search to find FACTS about this game:

Game: "${g.name_en ?? g.name_zh}"
Provider: "${g.provider}"
Category: ${g.site_category_auto ?? 'unknown'}
Operator-reported RTP: ${g.rtp !== null && Number(g.rtp) > 0 ? `${(Number(g.rtp) <= 1 ? Number(g.rtp) * 100 : Number(g.rtp)).toFixed(2)}%` : 'unknown'}

Search the provider's official site, SlotCatalog, BigWinBoard, and similar review sites. Return ONLY a JSON object (no markdown fences):

{
  "volatility": {"value": "low"|"mid"|"high"|null, "source_url": "...", "confidence": 0.0-1.0},
  "max_win_multiplier": {"value": <int like 5000 for x5000>|null, "source_url": "...", "confidence": ...},
  "rtp_official": {"value": <number like 96.5>|null, "source_url": "...", "confidence": ...},
  "release_date": {"value": "YYYY-MM-DD"|null, "source_url": "...", "confidence": ...},
  "min_bet": {"value": <number, PHP terms>|null, "source_url": "...", "confidence": ...},
  "max_bet": {"value": <number, PHP terms>|null, "source_url": "...", "confidence": ...},
  "ph_popularity": {"value": <0-30, Philippine market popularity based on SlotCatalog PH rank / social buzz>|null, "source_url": "...", "confidence": ...},
  "series": <kebab-case series slug like "fortune-gems" if the game belongs to a series, else null>,
  "features": <array from: buy_bonus, free_spins, megaways, jackpot, cascading, hold_and_win, multiplier, respin, expanding_wilds, cluster_pays>,
  "aliases": <array of nicknames/street names players actually use, incl. Filipino/Taglish terms, lowercase>,
  "similar_games": <array of up to 5 similar game names (exact official English names)>,
  "risk_flags": <array from: rtp_dispute, ip_infringe, payout_complaints, provider_reputation — only if you found credible evidence>,
  "tagline_en": <catchy one-liner, max 100 chars>,
  "tagline_tl": <catchy Taglish one-liner, max 100 chars>,
  "description_tl": <2-3 sentence Taglish description>,
  "description_en": <1-2 sentence English description, max 200 chars>,
  "description_zh": <1-2 sentence Chinese description, max 120 chars>
}

CRITICAL RULES:
- For volatility/max_win_multiplier/rtp_official/release_date/min_bet/max_bet/ph_popularity: if you cannot find a real source, set value to null. NEVER guess numbers.
- source_url must be the actual page where you found the fact.
- If the game is obscure and you find nothing, return nulls — that is a valid answer.`
}

async function callGemini(prompt: string): Promise<GeminiResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  )
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON in response: ${text.slice(0, 200)}`)
  return JSON.parse(jsonMatch[0]) as GeminiResult
}

async function callWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (e) {
      if (i >= retries) throw e
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
    }
  }
}

// 事实字段：必须有出处才采纳
function fact<T>(s: Sourced<T> | undefined, validate: (v: T) => boolean): T | null {
  if (!s || s.value === null || s.value === undefined) return null
  if (!s.source_url || !/^https?:\/\//.test(s.source_url)) return null
  return validate(s.value) ? s.value : null
}

function cleanEnumArray(values: unknown, allowed: Set<string>): string[] {
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string' && allowed.has(v)) : []
}

function trimOrNull(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 未设置')

  const db = await mysql.createPool({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 13306),
    user: process.env.MYSQL_USER ?? 'betogo',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'betogo',
    charset: 'utf8mb4',
    connectionLimit: CONCURRENCY + 2,
  })

  // 第一批范围：上游可用 + PHP/USDT(UCC) + 移动端
  const providerCond = process.env.PROVIDER ? 'AND g.provider = ?' : ''
  const enrichedCond = FORCE ? '' : 'AND (o.web_enriched_at IS NULL)'
  const [games] = await db.query<GameRow[]>(
    `SELECT g.game_id, g.game_provider_id, g.provider, g.name_en, g.name_zh,
            g.new_game_type, g.site_category_auto, g.rtp
     FROM bg_568win_game g
     LEFT JOIN bg_568win_game_override o
       ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     WHERE g.is_enabled = 1 AND g.is_maintain = 0
       AND g.provider_status = 'Online' AND g.is_provider_online = 1
       AND (g.supported_currencies IS NULL
         OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('PHP'))
         OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('USDT'))
         OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('UCC')))
       AND (g.device IS NULL OR FIND_IN_SET('m', REPLACE(g.device, ' ', '')) > 0)
       AND g.name_en IS NOT NULL AND g.new_game_type NOT IN (100, 200)
       ${providerCond} ${enrichedCond}
     ORDER BY g.provider, g.game_id
     ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ''}`,
    process.env.PROVIDER ? [process.env.PROVIDER] : [],
  )
  console.log(`\n🎮 待富化 ${games.length} 款（model=${GEMINI_MODEL} concurrency=${CONCURRENCY}${DRY_RUN ? ' DRY_RUN' : ''}）\n`)

  // 相似游戏名 → uuid 映射
  const [allNames] = await db.query<mysql.RowDataPacket[]>(
    `SELECT game_id, game_provider_id, name_en FROM bg_568win_game WHERE name_en IS NOT NULL AND is_enabled = 1`,
  )
  const nameToUuid = new Map<string, string>()
  for (const r of allNames) {
    nameToUuid.set(String(r.name_en).toLowerCase().trim(), `568win:${r.game_provider_id}:${r.game_id}`)
  }

  let done = 0
  let failed = 0
  let cursor = 0

  async function worker() {
    while (cursor < games.length) {
      const g = games[cursor++]
      const label = `[${g.provider}] ${g.name_en} (${g.game_provider_id}:${g.game_id})`
      try {
        const r = await callWithRetry(() => callGemini(buildPrompt(g)))

        const volatility = fact(r.volatility, (v) => VOLATILITY_VALUES.has(String(v)))
        const maxWin = fact(r.max_win_multiplier, (v) => Number.isFinite(Number(v)) && Number(v) >= 2 && Number(v) <= 1_000_000)
        const rtpOfficial = fact(r.rtp_official, (v) => Number(v) >= 50 && Number(v) <= 100)
        const releaseDate = fact(r.release_date, (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)))
        const minBet = fact(r.min_bet, (v) => Number(v) >= 0 && Number(v) < 1_000_000)
        const maxBet = fact(r.max_bet, (v) => Number(v) > 0 && Number(v) < 100_000_000)
        const phPopularity = fact(r.ph_popularity, (v) => Number(v) >= 0 && Number(v) <= 30)
        const features = cleanEnumArray(r.features, FEATURE_VALUES)
        const riskFlags = cleanEnumArray(r.risk_flags, RISK_VALUES)
        const aliases = Array.isArray(r.aliases)
          ? r.aliases.filter((a): a is string => typeof a === 'string' && !!a.trim()).map((a) => a.toLowerCase().trim()).slice(0, 15)
          : []
        const similar = Array.isArray(r.similar_games)
          ? r.similar_games
              .map((n) => typeof n === 'string' ? nameToUuid.get(n.toLowerCase().trim()) : undefined)
              .filter((u): u is string => !!u && u !== `568win:${g.game_provider_id}:${g.game_id}`)
              .slice(0, 5)
          : []

        // 上游 rtp 为 0-1 小数（-1=未知），统一换算成百分数再比对
        const rtpUpstreamPct = g.rtp !== null && Number(g.rtp) > 0
          ? (Number(g.rtp) <= 1 ? Number(g.rtp) * 100 : Number(g.rtp))
          : null
        const rtpMismatch = rtpOfficial !== null && rtpUpstreamPct !== null && Math.abs(Number(rtpOfficial) - rtpUpstreamPct) > 1

        if (DRY_RUN) {
          console.log(`✓ ${label}`, JSON.stringify({ volatility, maxWin, rtpOfficial, releaseDate, features, aliases: aliases.length, similar: similar.length }))
          done++
          continue
        }

        // 读现有 override，合并 search_keywords / 保留已有简介
        const [[existing]] = await db.query<mysql.RowDataPacket[]>(
          `SELECT search_keywords, description_en, description_zh, ph_bonus FROM bg_568win_game_override
           WHERE game_provider_id = ? AND game_id = ?`,
          [g.game_provider_id, g.game_id],
        )
        const existingKw = existing?.search_keywords ? String(existing.search_keywords).split(/\s+/) : []
        const mergedKw = [...new Set([...existingKw, ...aliases.flatMap((a) => a.split(/\s+/))])].filter(Boolean).join(' ') || null

        await db.execute(
          `INSERT INTO bg_568win_game_override
             (game_provider_id, game_id, volatility, max_win_multiplier, rtp_official, release_date,
              min_bet, max_bet, series, features, similar_games, risk_flags,
              tagline_en, tagline_tl, description_tl, description_en, description_zh,
              search_keywords, ph_bonus, web_sources, web_enriched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
           ON DUPLICATE KEY UPDATE
             volatility = VALUES(volatility),
             max_win_multiplier = VALUES(max_win_multiplier),
             rtp_official = VALUES(rtp_official),
             release_date = VALUES(release_date),
             min_bet = VALUES(min_bet),
             max_bet = VALUES(max_bet),
             series = VALUES(series),
             features = VALUES(features),
             similar_games = VALUES(similar_games),
             risk_flags = VALUES(risk_flags),
             tagline_en = VALUES(tagline_en),
             tagline_tl = VALUES(tagline_tl),
             description_tl = VALUES(description_tl),
             description_en = COALESCE(description_en, VALUES(description_en)),
             description_zh = COALESCE(description_zh, VALUES(description_zh)),
             search_keywords = VALUES(search_keywords),
             ph_bonus = COALESCE(VALUES(ph_bonus), ph_bonus),
             web_sources = VALUES(web_sources),
             web_enriched_at = NOW(3)`,
          [
            g.game_provider_id, g.game_id,
            volatility, maxWin, rtpOfficial, releaseDate, minBet, maxBet,
            trimOrNull(r.series, 64),
            JSON.stringify(features), JSON.stringify(similar), JSON.stringify(riskFlags),
            trimOrNull(r.tagline_en, 160), trimOrNull(r.tagline_tl, 160),
            trimOrNull(r.description_tl, 2000),
            trimOrNull(r.description_en, 500), trimOrNull(r.description_zh, 300),
            mergedKw,
            phPopularity,
            JSON.stringify({
              volatility: r.volatility ?? null,
              max_win_multiplier: r.max_win_multiplier ?? null,
              rtp_official: r.rtp_official ?? null,
              release_date: r.release_date ?? null,
              min_bet: r.min_bet ?? null,
              max_bet: r.max_bet ?? null,
              ph_popularity: r.ph_popularity ?? null,
              raw_similar_games: r.similar_games ?? null,
              rtp_upstream_pct: rtpUpstreamPct,
              rtp_mismatch: rtpMismatch,
            }),
          ],
        )
        done++
        const mismatch = rtpMismatch ? ' ⚠️RTP差异' : ''
        console.log(`✓ [${done + failed}/${games.length}] ${label}${mismatch}`)
      } catch (e) {
        failed++
        console.error(`✗ [${done + failed}/${games.length}] ${label}:`, e instanceof Error ? e.message : e)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  console.log(`\n完成：成功 ${done}，失败 ${failed}`)
  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
