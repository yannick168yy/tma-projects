/**
 * 菲律宾市场 SG 游戏数据富化脚本
 *
 * 用法:
 *   GEMINI_API_KEY=xxx \
 *   MYSQL_HOST=127.0.0.1 MYSQL_PORT=13307 \
 *   MYSQL_USER=tma MYSQL_PASSWORD=tma_dev \
 *   npm start
 *
 * 可选参数（环境变量）:
 *   BATCH_SIZE=50          每批处理游戏数（默认 50）
 *   OFFSET=0               从第几条开始（断点续跑用）
 *   DRY_RUN=1              只打印不写库
 *   ONLY_MISSING=1         只处理尚未评分的游戏（weight=0 且 weight_updated_at IS NULL）
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import mysql from 'mysql2/promise'

// ── 菲律宾市场供应商底分（搜索数据 + 行业经验，满分 40）─────────────────────
const PROVIDER_BASE: Record<string, number> = {
  // S 级 (35-40)：菲律宾市场绝对主流
  'JILI':                 40,
  'Pragmatic Play':       38,
  'PG Soft':              37,
  'Pocket Games Soft':    37,

  // A 级 (28-34)：菲律宾高知名度
  'JDB':                  34,
  'Fa Chai':              33,
  'Fachai':               33,
  'CQ9':                  32,
  'Spade Gaming':         31,
  'Evolution':            30,
  'Habanero':             29,
  'Playtech':             28,

  // B 级 (20-27)：全球知名，菲律宾有受众
  "Play'n GO":            27,
  'BGaming':              26,
  'NetEnt':               25,
  'Microgaming':          24,
  'RTG':                  22,
  'Boongo':               21,
  'Skywind':              21,
  'Booongo':              21,
  'KA Gaming':            20,

  // C 级 (12-19)：小众或新兴供应商
}
const PROVIDER_BASE_DEFAULT = 10 // 未知供应商

// ── 已知菲律宾热门游戏（额外加 10 分）─────────────────────────────────────
const FEATURED_GAMES = new Set([
  // JILI 热门
  'Super Ace', 'Fortune Gems', 'Fortune Gems 2', 'Fortune Gems 3',
  'Boxing King', 'Golden Empire', 'Crazy777', 'Crazy 7',
  'Crazy Hunter', 'All-Star Fishing', 'Royal Fishing', 'Dragon Fortune',
  'Money Coming', 'Charge Buffalo', 'Ali Baba', 'Lucky Ball',
  // PG Soft 热门
  'Mahjong Ways', 'Mahjong Ways 2', 'Fortune Tiger', 'Lucky Neko',
  'Dragon Hatch', 'Wild Bounty Showdown', 'Medusa', 'Legend of Perseus',
  'Pinata Wins', 'Ganesha Fortune',
  // Pragmatic Play 热门
  'Gates of Olympus', 'Sweet Bonanza', 'Big Bass Bonanza',
  'The Dog House', 'Wolf Gold', 'Starlight Princess',
  // CQ9
  'Golden Egg',
  // Evolution 热门
  'Crazy Time', 'Dream Catcher', 'Mega Ball', 'Lightning Roulette',
  // JDB
  'Fishing God', 'Dragon King',
])

// ── 特性分（满分 20）──────────────────────────────────────────────────────
function featureScore(g: GameRow): number {
  let s = 0
  if (g.is_mobile)    s += 6
  if (g.has_freespins) s += 5
  if (g.has_demo)     s += 3
  if (g.rtp && g.rtp >= 96)   s += 4
  else if (g.rtp && g.rtp >= 94) s += 2
  if (g.has_lobby)    s += 2
  return Math.min(s, 20)
}

// ── Claude 批量评分提示词 ───────────────────────────────────────────────────
function buildPrompt(games: GameRow[]): string {
  const gameList = games.map((g, i) =>
    `${i + 1}. name="${g.name}" provider="${g.provider}" type="${g.type ?? ''}" ` +
    `category="${g.category ?? ''}" tags="${(g.tags ?? []).join(',')}" ` +
    `rtp=${g.rtp ?? 'null'} volatility="${g.volatility ?? ''}" ` +
    `has_freespins=${g.has_freespins} is_mobile=${g.is_mobile}`
  ).join('\n')

  return `You are a casino gaming expert specializing in the Philippine online gambling market.

Analyze each game below and return a JSON array. Philippine players love:
- Fishing/shooting games (极高受欢迎度)
- Asian themes: mahjong, dragons, tigers, fortune, Chinese mythology
- JILI-style fast games with big multipliers
- Mobile-optimized games
- Games with free spins / bonus features
- Live dealer games (Evolution, Pragmatic Live)
- Lucky/fortune themes resonating with Filipino culture

For each game return exactly this JSON object:
{
  "index": <number 1-based>,
  "ph_bonus": <0-30, Philippine market relevance score>,
  "is_featured": <true/false, only true for globally recognized top titles>,
  "sort_category": <one of: "slots"|"fishing"|"live"|"table"|"bingo"|"crash"|"other">,
  "theme": <short theme tag, e.g.: "fishing","asian-mythology","mahjong","fortune","adventure","horror","classic","sports","fantasy">,
  "game_style": <"asian"|"western"|"classic"|"modern"|"arcade">,
  "player_type": <"casual"|"regular"|"high-roller">,
  "description_en": <1-2 sentence English description, max 120 chars>,
  "description_zh": <1-2 sentence Chinese description, max 80 chars>,
  "search_keywords": <8-12 space-separated lowercase keywords for search>
}

Rules:
- ph_bonus 25-30: fishing games, top Asian-themed slots, famous JILI/PG/Pragmatic titles
- ph_bonus 18-24: good Asian themes, live dealer, mobile-optimized
- ph_bonus 10-17: generic slots with decent features
- ph_bonus 0-9: niche/Western themes with low PH appeal
- is_featured=true only for globally well-known titles (Gates of Olympus, Mahjong Ways, etc.)
- sort_category "fishing" for any shooting/fishing game
- Return ONLY a valid JSON array, no extra text.

Games to analyze:
${gameList}`
}

// ── 类型 ─────────────────────────────────────────────────────────────────
interface GameRow {
  uuid: string
  name: string
  provider: string
  type: string | null
  category: string | null
  tags: string[] | null
  rtp: number | null
  volatility: string | null
  has_freespins: number
  is_mobile: number
  has_demo: number
  has_lobby: number
  weight: number
  weight_updated_at: Date | null
}

interface ClaudeResult {
  index: number
  ph_bonus: number
  is_featured: boolean
  sort_category: string
  theme: string
  game_style: string
  player_type: string
  description_en: string
  description_zh: string
  search_keywords: string
}

// ── 主流程 ────────────────────────────────────────────────────────────────
async function main() {
  const BATCH_SIZE  = Number(process.env.BATCH_SIZE ?? 50)
  const START_OFFSET = Number(process.env.OFFSET ?? 0)
  const DRY_RUN     = process.env.DRY_RUN === '1'
  const ONLY_MISSING = process.env.ONLY_MISSING === '1'

  const db = await mysql.createConnection({
    host:     process.env.MYSQL_HOST     ?? '47.84.34.139',
    port:     Number(process.env.MYSQL_PORT ?? 13306),
    user:     process.env.MYSQL_USER     ?? 'tma',
    password: process.env.MYSQL_PASSWORD ?? 'tma_dev',
    database: process.env.MYSQL_DATABASE ?? 'betogo',
    charset:  'utf8mb4',
  })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY 未设置')
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  const whereClause = ONLY_MISSING
    ? 'WHERE weight = 0 AND weight_updated_at IS NULL'
    : ''

  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT uuid, name, provider, type, category, tags, rtp, volatility,
            has_freespins, is_mobile, has_demo, has_lobby,
            weight, weight_updated_at
     FROM sg_games ${whereClause} ORDER BY provider, name`,
  )
  const games = rows as GameRow[]

  const total = games.length
  console.log(`\n🎮 共 ${total} 款游戏需要处理（BATCH_SIZE=${BATCH_SIZE}）\n`)

  let processed = 0
  let errors = 0

  for (let i = START_OFFSET; i < games.length; i += BATCH_SIZE) {
    const batch = games.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(games.length / BATCH_SIZE)

    process.stdout.write(`[${batchNum}/${totalBatches}] 处理 ${batch.length} 款游戏...`)

    let results: ClaudeResult[] = []
    try {
      results = await callWithRetry(async () => {
        const resp = await model.generateContent(buildPrompt(batch))
        const text = resp.response.text()
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        if (!jsonMatch) throw new Error('No JSON array in response')
        return JSON.parse(jsonMatch[0]) as ClaudeResult[]
      })
    } catch (e) {
      console.error(`\n❌ Batch ${batchNum} Claude 调用失败:`, e)
      errors++
      // 使用规则兜底：全部给基础分
      results = batch.map((_, idx) => ({
        index: idx + 1,
        ph_bonus: 10,
        is_featured: false,
        sort_category: 'slots',
        theme: 'unknown',
        game_style: 'modern',
        player_type: 'casual',
        description_en: '',
        description_zh: '',
        search_keywords: '',
      }))
    }

    if (!DRY_RUN) {
      for (const r of results) {
        const g = batch[r.index - 1]
        if (!g) continue

        const providerBase = PROVIDER_BASE[g.provider] ?? PROVIDER_BASE_DEFAULT
        const featuredBonus = FEATURED_GAMES.has(g.name) ? 10 : 0
        const phBonus = Math.min(Math.max(r.ph_bonus ?? 10, 0), 30)
        const featScore = featureScore(g)
        const weight = Math.min(providerBase + phBonus + featScore + featuredBonus, 100)

        await db.execute(
          `UPDATE sg_games SET
             weight            = ?,
             is_featured       = ?,
             sort_category     = ?,
             theme             = ?,
             game_style        = ?,
             player_type       = ?,
             description_en    = ?,
             description_zh    = ?,
             search_keywords   = ?,
             weight_updated_at = NOW(3)
           WHERE uuid = ?`,
          [
            weight,
            (r.is_featured || FEATURED_GAMES.has(g.name)) ? 1 : 0,
            r.sort_category ?? 'slots',
            r.theme ?? null,
            r.game_style ?? null,
            r.player_type ?? null,
            r.description_en || null,
            r.description_zh || null,
            r.search_keywords || null,
            g.uuid,
          ],
        )
        processed++
      }
    } else {
      // DRY_RUN：打印样本
      const sample = results[0]
      const g = batch[0]
      const providerBase = PROVIDER_BASE[g.provider] ?? PROVIDER_BASE_DEFAULT
      const weight = Math.min(providerBase + (sample.ph_bonus ?? 10) + featureScore(g) + (FEATURED_GAMES.has(g.name) ? 10 : 0), 100)
      console.log(`\n  样本 "${g.name}" (${g.provider}): weight=${weight}, category=${sample.sort_category}, theme=${sample.theme}`)
      processed += batch.length
    }

    process.stdout.write(` ✓\n`)

    // 避免触发速率限制
    if (i + BATCH_SIZE < games.length) await sleep(500)
  }

  await db.end()

  console.log(`\n✅ 完成！处理 ${processed} 款，失败批次 ${errors} 个`)
  if (DRY_RUN) console.log('（DRY_RUN 模式，未写入数据库）')

  // 打印分布统计
  if (!DRY_RUN) {
    const [stats] = await (async () => {
      const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST ?? '47.84.34.139',
        port: Number(process.env.MYSQL_PORT ?? 13306),
        user: process.env.MYSQL_USER ?? 'tma',
        password: process.env.MYSQL_PASSWORD ?? 'tma_dev',
        database: process.env.MYSQL_DATABASE ?? 'betogo',
      })
      const [r] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT
           COUNT(*) AS total,
           SUM(weight >= 80) AS high,
           SUM(weight >= 60 AND weight < 80) AS mid,
           SUM(weight >= 40 AND weight < 60) AS low,
           SUM(weight < 40) AS very_low,
           SUM(is_featured = 1) AS featured,
           ROUND(AVG(weight), 1) AS avg_weight
         FROM sg_games WHERE weight_updated_at IS NOT NULL`,
      )
      await conn.end()
      return [r]
    })()
    const s = stats[0]
    console.log(`\n📊 权重分布:`)
    console.log(`   80-100分(热门): ${s.high}`)
    console.log(`   60-79分(良好):  ${s.mid}`)
    console.log(`   40-59分(一般):  ${s.low}`)
    console.log(`   0-39分(冷门):   ${s.very_low}`)
    console.log(`   精选推荐:       ${s.featured}`)
    console.log(`   平均分:         ${s.avg_weight}`)
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('rate')
      if (!is429 || attempt === maxRetries) throw e
      // 429：解析 retryDelay 或使用指数退避
      const retryMatch = msg.match(/retryDelay["\s:]+(\d+)/)
      const waitSec = retryMatch ? Number(retryMatch[1]) + 2 : Math.min(30 * attempt, 120)
      process.stdout.write(` [429 等待 ${waitSec}s]`)
      await sleep(waitSec * 1000)
    }
  }
  throw new Error('Max retries exceeded')
}

main().catch((e) => { console.error(e); process.exit(1) })
