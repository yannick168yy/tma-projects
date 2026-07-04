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
 *   TOP=0                           按运营价值优先取前 N 款（厂商梯队分 desc → 上游 rank asc）
 *   FORCE=1                         重跑已富化过的游戏（默认只跑 web_enriched_at IS NULL）
 *   DRY_RUN=1                       只打印不写库
 *   PROVIDER=JiLiGaming             只跑指定厂商
 *   GAME_PROVIDER_ID=1 GAME_ID=123   只跑指定游戏
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
// TOP=N：按运营价值（厂商梯队分 desc → 上游 rank asc）优先取前 N 款，控制批量成本
const TOP = Number(process.env.TOP ?? 0)
const FORCE = process.env.FORCE === '1'
const DRY_RUN = process.env.DRY_RUN === '1'
const GAME_PROVIDER_ID = process.env.GAME_PROVIDER_ID ? Number(process.env.GAME_PROVIDER_ID) : null
const GAME_ID = process.env.GAME_ID ? Number(process.env.GAME_ID) : null

const VOLATILITY_VALUES = new Set(['low', 'mid', 'high'])

// ── 权重评分（对齐 enrich-sg-games 公式，×100 缩放到 568Win 的 0-10000 权重体系）──
// 厂商底分（满分 40），按 568Win provider 命名模糊匹配
const PROVIDER_BASE_PATTERNS: [RegExp, number][] = [
  [/jili/i, 40],
  [/pragmatic/i, 38],
  [/pg\s*soft|pocket\s*games/i, 37],
  [/jdb/i, 34],
  [/fa\s*chai|fachai/i, 33],
  [/cq9/i, 32],
  [/spade/i, 31],
  [/evolution/i, 30],
  [/habanero/i, 29],
  [/playtech/i, 28],
  [/play'?n\s*go/i, 27],
  [/bgaming/i, 26],
  [/netent|relax/i, 25],
  [/microgaming/i, 24],
  [/rtg|red\s*tiger/i, 22],
  [/bo+ngo|skywind/i, 21],
  [/ka\s*gaming|kagaming/i, 20],
]
const PROVIDER_BASE_DEFAULT = 10

function providerBase(provider: string | null): number {
  if (!provider) return PROVIDER_BASE_DEFAULT
  for (const [re, score] of PROVIDER_BASE_PATTERNS) {
    if (re.test(provider)) return score
  }
  return PROVIDER_BASE_DEFAULT
}

// 已知菲律宾热门游戏（名作加成 10 分 + is_featured）
const FEATURED_GAMES = new Set([
  'Super Ace', 'Fortune Gems', 'Fortune Gems 2', 'Fortune Gems 3',
  'Boxing King', 'Golden Empire', 'Crazy777', 'Crazy 7',
  'Crazy Hunter', 'All-Star Fishing', 'Royal Fishing', 'Dragon Fortune',
  'Money Coming', 'Charge Buffalo', 'Ali Baba', 'Lucky Ball',
  'Mahjong Ways', 'Mahjong Ways 2', 'Fortune Tiger', 'Lucky Neko',
  'Dragon Hatch', 'Wild Bounty Showdown', 'Medusa', 'Legend of Perseus',
  'Pinata Wins', 'Ganesha Fortune',
  'Gates of Olympus', 'Sweet Bonanza', 'Big Bass Bonanza',
  'The Dog House', 'Wolf Gold', 'Starlight Princess',
  'Golden Egg', 'Crazy Time', 'Dream Catcher', 'Mega Ball', 'Lightning Roulette',
  'Fishing God', 'Dragon King', 'JackPot Fishing', 'Bombing Fishing', 'Dinosaur Tycoon',
])

// 特性分（满分 20）：机制标签 + RTP
function featureScore(features: string[], rtpPct: number | null): number {
  let s = 0
  if (features.includes('free_spins')) s += 5
  if (features.includes('jackpot')) s += 4
  if (features.includes('buy_bonus')) s += 3
  if (features.includes('megaways') || features.includes('cascading')) s += 2
  if (features.includes('multiplier')) s += 2
  if (rtpPct !== null && rtpPct >= 96.5) s += 4
  else if (rtpPct !== null && rtpPct >= 94) s += 2
  return Math.min(s, 20)
}

const GAME_STYLE_VALUES = new Set(['asian', 'western', 'classic', 'modern', 'arcade'])
const PLAYER_TYPE_VALUES = new Set(['casual', 'regular', 'high-roller'])
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
  volatility_estimate?: string | null
  ph_bonus_estimate?: number | null
  theme?: string | null
  game_style?: string | null
  player_type?: string | null
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
  rank_no: number | null
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
  "series": <kebab-case series slug. Use for true sequels (e.g. "fortune-gems" for Fortune Gems 1/2/3) AND provider game families (e.g. "jili-fishing" for JILI fishing titles). null only for standalone games>,
  "features": <array from: buy_bonus, free_spins, megaways, jackpot, cascading, hold_and_win, multiplier, respin, expanding_wilds, cluster_pays>,
  "aliases": <array of nicknames/street names players actually use, incl. Filipino/Taglish terms, lowercase>,
  "similar_games": <array of up to 5 similar game names (exact official English names)>,
  "risk_flags": <array from: rtp_dispute, ip_infringe, payout_complaints, provider_reputation — only if you found credible evidence>,
  "tagline_en": <catchy one-liner, max 100 chars>,
  "tagline_tl": <catchy Taglish one-liner, max 100 chars>,
  "description_tl": <2-3 sentence Taglish description>,
  "description_en": <1-2 sentence English description, max 200 chars>,
  "description_zh": <1-2 sentence Chinese description, max 120 chars>,
  "volatility_estimate": <"low"|"mid"|"high" — ALWAYS give your best judgment even without a source>,
  "ph_bonus_estimate": <0-30 Philippine market appeal estimate: 25-30 fishing/top Asian titles, 18-24 good Asian themes or live dealer, 10-17 decent generic, 0-9 niche Western>,
  "theme": <short kebab-case theme tag, e.g. fishing, asian-mythology, mahjong, fortune, adventure, animal, fruit, egypt, dinosaur, ocean>,
  "game_style": <"asian"|"western"|"classic"|"modern"|"arcade">,
  "player_type": <"casual"|"regular"|"high-roller">
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
  const singleGameCond = GAME_PROVIDER_ID !== null && GAME_ID !== null ? 'AND g.game_provider_id = ? AND g.game_id = ?' : ''
  const enrichedCond = FORCE ? '' : 'AND (o.web_enriched_at IS NULL)'
  const params: unknown[] = []
  if (process.env.PROVIDER) params.push(process.env.PROVIDER)
  if (GAME_PROVIDER_ID !== null && GAME_ID !== null) params.push(GAME_PROVIDER_ID, GAME_ID)
  const [games] = await db.query<GameRow[]>(
    `SELECT g.game_id, g.game_provider_id, g.provider, g.name_en, g.name_zh,
            g.new_game_type, g.site_category_auto, g.rtp, g.rank_no
     FROM bg_568win_game g
     LEFT JOIN bg_568win_game_override o
       ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
     WHERE g.is_enabled = 1 AND g.is_maintain = 0
       AND g.provider_status = 'Online' AND g.is_provider_online = 1
       AND (g.supported_currencies IS NULL
         OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('PHP'))
         OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('USDT'))
         OR JSON_CONTAINS(g.supported_currencies, JSON_QUOTE('UCC')))
       AND (g.device IS NULL OR FIND_IN_SET('m', REPLACE(REPLACE(g.device, ' ', ''), '/', ',')) > 0)
       AND g.name_en IS NOT NULL AND g.new_game_type NOT IN (100, 200)
       ${providerCond} ${singleGameCond} ${enrichedCond}
     ORDER BY g.provider, g.game_id
     ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ''}`,
    params,
  )
  // TOP 模式：厂商梯队分高者优先，同厂商按 568Win 上游 rank 升序；
  // 单厂商设上限避免大厂全量挤占（第一遍按上限公平分配，没满再第二遍放开补齐）
  const PROVIDER_CAP = Number(process.env.PROVIDER_CAP ?? 150)
  let queue = games
  if (TOP > 0) {
    const sorted = [...games].sort((a, b) => {
      const tier = providerBase(b.provider) - providerBase(a.provider)
      if (tier !== 0) return tier
      return (a.rank_no ?? 999_999) - (b.rank_no ?? 999_999)
    })
    const picked = new Set<GameRow>()
    const perProvider = new Map<string, number>()
    for (const g of sorted) {
      if (picked.size >= TOP) break
      const p = g.provider ?? '?'
      if ((perProvider.get(p) ?? 0) >= PROVIDER_CAP) continue
      picked.add(g)
      perProvider.set(p, (perProvider.get(p) ?? 0) + 1)
    }
    for (const g of sorted) {
      if (picked.size >= TOP) break
      picked.add(g)
    }
    queue = [...picked]
  }

  console.log(`\n🎮 符合条件 ${games.length} 款，本次跑 ${queue.length} 款（model=${GEMINI_MODEL} concurrency=${CONCURRENCY}${TOP > 0 ? ` TOP=${TOP}` : ''}${DRY_RUN ? ' DRY_RUN' : ''}）\n`)
  if (TOP > 0) {
    const byProvider = new Map<string, number>()
    for (const g of queue) byProvider.set(g.provider ?? '?', (byProvider.get(g.provider ?? '?') ?? 0) + 1)
    console.log('本批厂商分布:', [...byProvider.entries()].map(([p, n]) => `${p}:${n}`).join(' '), '\n')
  }

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
    while (cursor < queue.length) {
      const g = queue[cursor++]
      const label = `[${g.provider}] ${g.name_en} (${g.game_provider_id}:${g.game_id})`
      try {
        const r = await callWithRetry(() => callGemini(buildPrompt(g)))

        const volatilitySourced = fact(r.volatility, (v) => VOLATILITY_VALUES.has(String(v)))
        const volatilityEstimate = typeof r.volatility_estimate === 'string' && VOLATILITY_VALUES.has(r.volatility_estimate) ? r.volatility_estimate : null
        const volatility = volatilitySourced ?? volatilityEstimate
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

        // 权重评分（同 enrich-sg-games 公式，×100 缩放到 0-10000）
        const phBonus = phPopularity !== null ? Number(phPopularity)
          : (typeof r.ph_bonus_estimate === 'number' && r.ph_bonus_estimate >= 0 && r.ph_bonus_estimate <= 30 ? Math.round(r.ph_bonus_estimate) : 10)
        const base = providerBase(g.provider)
        const featScore = featureScore(features, rtpOfficial !== null ? Number(rtpOfficial) : rtpUpstreamPct)
        const isFamous = !!g.name_en && FEATURED_GAMES.has(g.name_en)
        const featuredBonus = isFamous ? 10 : 0
        const weight = Math.min(base + phBonus + featScore + featuredBonus, 100) * 100
        const weightBreakdown = { provider_base: base, ph_bonus: phBonus, feature_score: featScore, featured_bonus: featuredBonus, scale: 100 }

        const theme = typeof r.theme === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(r.theme) ? r.theme : null
        const gameStyle = typeof r.game_style === 'string' && GAME_STYLE_VALUES.has(r.game_style) ? r.game_style : null
        const playerType = typeof r.player_type === 'string' && PLAYER_TYPE_VALUES.has(r.player_type) ? r.player_type : null

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
              search_keywords, ph_bonus, weight, weight_breakdown, is_featured,
              theme, game_style, player_type, web_sources, web_enriched_at, weight_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
           ON DUPLICATE KEY UPDATE
             volatility = COALESCE(VALUES(volatility), volatility),
             max_win_multiplier = COALESCE(VALUES(max_win_multiplier), max_win_multiplier),
             rtp_official = COALESCE(VALUES(rtp_official), rtp_official),
             release_date = COALESCE(VALUES(release_date), release_date),
             min_bet = COALESCE(VALUES(min_bet), min_bet),
             max_bet = COALESCE(VALUES(max_bet), max_bet),
             series = COALESCE(VALUES(series), series),
             features = VALUES(features),
             similar_games = VALUES(similar_games),
             risk_flags = VALUES(risk_flags),
             tagline_en = COALESCE(VALUES(tagline_en), tagline_en),
             tagline_tl = COALESCE(VALUES(tagline_tl), tagline_tl),
             description_tl = COALESCE(VALUES(description_tl), description_tl),
             description_en = COALESCE(description_en, VALUES(description_en)),
             description_zh = COALESCE(description_zh, VALUES(description_zh)),
             search_keywords = VALUES(search_keywords),
             ph_bonus = VALUES(ph_bonus),
             weight = VALUES(weight),
             weight_breakdown = VALUES(weight_breakdown),
             is_featured = COALESCE(is_featured, VALUES(is_featured)),
             theme = COALESCE(VALUES(theme), theme),
             game_style = COALESCE(VALUES(game_style), game_style),
             player_type = COALESCE(VALUES(player_type), player_type),
             web_sources = VALUES(web_sources),
             web_enriched_at = NOW(3),
             weight_updated_at = NOW(3)`,
          [
            g.game_provider_id, g.game_id,
            volatility, maxWin, rtpOfficial, releaseDate, minBet, maxBet,
            (() => { const s = trimOrNull(r.series, 200)?.split(',')[0].trim() ?? null; return s && /^[a-z0-9][a-z0-9-]{0,63}$/.test(s) ? s : null })(),
            JSON.stringify(features), JSON.stringify(similar), JSON.stringify(riskFlags),
            trimOrNull(r.tagline_en, 160), trimOrNull(r.tagline_tl, 160),
            trimOrNull(r.description_tl, 2000),
            trimOrNull(r.description_en, 500), trimOrNull(r.description_zh, 300),
            mergedKw,
            phBonus,
            weight,
            JSON.stringify(weightBreakdown),
            isFamous ? 1 : null,
            theme, gameStyle, playerType,
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
              volatility_estimated: volatilitySourced === null && volatility !== null,
            }),
          ],
        )
        done++
        const mismatch = rtpMismatch ? ' ⚠️RTP差异' : ''
        console.log(`✓ [${done + failed}/${queue.length}] ${label}${mismatch}`)
      } catch (e) {
        failed++
        console.error(`✗ [${done + failed}/${queue.length}] ${label}:`, e instanceof Error ? e.message : e)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  console.log(`\n完成：成功 ${done}，失败 ${failed}`)
  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
