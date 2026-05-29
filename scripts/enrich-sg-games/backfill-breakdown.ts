import mysql from 'mysql2/promise'

const PROVIDER_BASE: Record<string, number> = {
  'JILI':                 40,
  'Pragmatic Play':       38,
  'PG Soft':              37,
  'Pocket Games Soft':    37,
  'JDB':                  34,
  'Fa Chai':              33,
  'Fachai':               33,
  'CQ9':                  32,
  'Spade Gaming':         31,
  'Evolution':            30,
  'Habanero':             29,
  'Playtech':             28,
  "Play'n GO":            27,
  'BGaming':              26,
  'NetEnt':               25,
  'Microgaming':          24,
  'RTG':                  22,
  'Boongo':               21,
  'Skywind':              21,
  'Booongo':              21,
  'KA Gaming':            20,
}
const PROVIDER_BASE_DEFAULT = 10

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
  'Golden Egg',
  'Crazy Time', 'Dream Catcher', 'Mega Ball', 'Lightning Roulette',
  'Fishing God', 'Dragon King',
])

interface GameRow {
  uuid: string
  name: string
  provider: string
  weight: number
  is_mobile: number
  has_freespins: number
  has_demo: number
  has_lobby: number
  rtp: number | null
}

function featureScore(g: GameRow): number {
  let s = 0
  if (g.is_mobile)     s += 6
  if (g.has_freespins) s += 5
  if (g.has_demo)      s += 3
  if (g.rtp && g.rtp >= 96)        s += 4
  else if (g.rtp && g.rtp >= 94)   s += 2
  if (g.has_lobby)     s += 2
  return Math.min(s, 20)
}

async function main() {
  const db = await mysql.createConnection({
    host:     process.env.MYSQL_HOST     ?? '127.0.0.1',
    port:     Number(process.env.MYSQL_PORT ?? 13306),
    user:     process.env.MYSQL_USER     ?? 'tma',
    password: process.env.MYSQL_PASSWORD ?? 'tma_dev',
    database: process.env.MYSQL_DATABASE ?? 'betogo',
    charset:  'utf8mb4',
  })

  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT uuid, name, provider, weight,
            is_mobile, has_freespins, has_demo, has_lobby, rtp
     FROM sg_games
     WHERE weight_updated_at IS NOT NULL AND weight_breakdown IS NULL`,
  )
  const games = rows as GameRow[]
  console.log(`共 ${games.length} 条需要回填`)

  let done = 0
  for (const g of games) {
    const providerBase  = PROVIDER_BASE[g.provider] ?? PROVIDER_BASE_DEFAULT
    const featuredBonus = FEATURED_GAMES.has(g.name) ? 10 : 0
    const featScore     = featureScore(g)
    const phBonus       = Math.max(0, Math.min(30, g.weight - providerBase - featScore - featuredBonus))

    const breakdown = JSON.stringify({
      provider_base:  providerBase,
      ph_bonus:       phBonus,
      feature_score:  featScore,
      featured_bonus: featuredBonus,
    })

    await db.execute(
      `UPDATE sg_games SET ph_bonus = ?, weight_breakdown = ? WHERE uuid = ?`,
      [phBonus, breakdown, g.uuid],
    )
    done++
    if (done % 500 === 0) process.stdout.write(`\r回填进度: ${done}/${games.length}`)
  }

  await db.end()
  console.log(`\n✅ 回填完成，共 ${done} 条`)
}

main().catch((e) => { console.error(e); process.exit(1) })
