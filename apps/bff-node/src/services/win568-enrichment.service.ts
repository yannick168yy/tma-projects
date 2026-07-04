import type { RowDataPacket } from 'mysql2'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { tryConsumeGeminiSearchQuota } from './gemini-quota.service.js'

export class GeminiQuotaExhaustedError extends Error {
  constructor() { super('今日 Gemini 免费额度已用完，太平洋时间零点后自动恢复') }
}

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const VOLATILITY_VALUES = new Set(['low', 'mid', 'high'])
const GAME_STYLE_VALUES = new Set(['asian', 'western', 'classic', 'modern', 'arcade'])
const PLAYER_TYPE_VALUES = new Set(['casual', 'regular', 'high-roller'])
const FEATURE_VALUES = new Set([
  'buy_bonus', 'free_spins', 'megaways', 'jackpot', 'cascading',
  'hold_and_win', 'multiplier', 'respin', 'expanding_wilds', 'cluster_pays',
])
const RISK_VALUES = new Set(['rtp_dispute', 'ip_infringe', 'payout_complaints', 'provider_reputation'])

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

interface GameRow extends RowDataPacket {
  game_id: number
  game_provider_id: number
  provider: string | null
  name_en: string | null
  name_zh: string | null
  new_game_type: number | null
  site_category_auto: string | null
  rtp: number | null
}

export function providerBase(provider: string | null): number {
  if (!provider) return 10
  for (const [re, score] of PROVIDER_BASE_PATTERNS) {
    if (re.test(provider)) return score
  }
  return 10
}

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

async function callGemini(apiKey: string, prompt: string): Promise<GeminiResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
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

export async function enrichWin568Game(env: Env, gameProviderId: number, gameId: number): Promise<void> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 未设置')
  const db = getMysqlPool(env)
  const [[game]] = await db.query<GameRow[]>(
    `SELECT game_id, game_provider_id, provider, name_en, name_zh, new_game_type, site_category_auto, rtp
     FROM bg_568win_game
     WHERE game_provider_id = ? AND game_id = ? LIMIT 1`,
    [gameProviderId, gameId],
  )
  if (!game) throw new Error('568Win game not found')

  const [allNames] = await db.query<RowDataPacket[]>(
    `SELECT game_id, game_provider_id, name_en FROM bg_568win_game WHERE name_en IS NOT NULL AND is_enabled = 1`,
  )
  const nameToUuid = new Map<string, string>()
  for (const row of allNames) {
    nameToUuid.set(String(row.name_en).toLowerCase().trim(), `568win:${row.game_provider_id}:${row.game_id}`)
  }

  if (!await tryConsumeGeminiSearchQuota(env)) throw new GeminiQuotaExhaustedError()
  const r = await callGemini(env.GEMINI_API_KEY, buildPrompt(game))
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
        .filter((u): u is string => !!u && u !== `568win:${game.game_provider_id}:${game.game_id}`)
        .slice(0, 5)
    : []

  const rtpUpstreamPct = game.rtp !== null && Number(game.rtp) > 0
    ? (Number(game.rtp) <= 1 ? Number(game.rtp) * 100 : Number(game.rtp))
    : null
  const rtpMismatch = rtpOfficial !== null && rtpUpstreamPct !== null && Math.abs(Number(rtpOfficial) - rtpUpstreamPct) > 1
  const phBonus = phPopularity !== null ? Number(phPopularity)
    : (typeof r.ph_bonus_estimate === 'number' && r.ph_bonus_estimate >= 0 && r.ph_bonus_estimate <= 30 ? Math.round(r.ph_bonus_estimate) : 10)
  const base = providerBase(game.provider)
  const featScore = featureScore(features, rtpOfficial !== null ? Number(rtpOfficial) : rtpUpstreamPct)
  const isFamous = !!game.name_en && FEATURED_GAMES.has(game.name_en)
  const featuredBonus = isFamous ? 10 : 0
  const weight = Math.min(base + phBonus + featScore + featuredBonus, 100) * 100
  const weightBreakdown = { provider_base: base, ph_bonus: phBonus, feature_score: featScore, featured_bonus: featuredBonus, scale: 100 }
  const theme = typeof r.theme === 'string' && /^[a-z][a-z0-9-]{1,30}$/.test(r.theme) ? r.theme : null
  const gameStyle = typeof r.game_style === 'string' && GAME_STYLE_VALUES.has(r.game_style) ? r.game_style : null
  const playerType = typeof r.player_type === 'string' && PLAYER_TYPE_VALUES.has(r.player_type) ? r.player_type : null
  const [[existing]] = await db.query<RowDataPacket[]>(
    `SELECT search_keywords FROM bg_568win_game_override WHERE game_provider_id = ? AND game_id = ?`,
    [game.game_provider_id, game.game_id],
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
      game.game_provider_id, game.game_id,
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
}
