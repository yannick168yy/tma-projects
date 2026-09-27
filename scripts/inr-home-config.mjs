// 手动执行，不自动部署。INR（印度站）首页装修一次性配置：布局顺序/显隐/卡型 + 热门/真人/老虎机/体育的钉选与排除。
// 重复执行是幂等的（布局 upsert，钉选按 (板块,INR) 先删后插），只动 INR，不影响其他币种。
// INR 下可用状态变化后（厂商在 INR 线路恢复/下线）重跑一次，自动排除名单会跟着刷新。
// 用法：拷进 tma-bff-node 容器的 /app 后执行 `node inr-home-config.mjs`（依赖 /app/dist）
import { loadEnv } from './dist/config/env.js'
import { runWithTenant } from './dist/lib/tenant-context.js'
import { listHomeLayout, saveHomeLayout, replaceHomepageSectionGames } from './dist/services/admin-store.js'
import { getGamesFromCache, refreshHomepageSelection } from './dist/services/sg-game.service.js'

const CUR = 'INR'

// 顺序即渲染顺序；hidden 的放最后
const LAYOUT = [
  ['announcement'], ['banner'], ['recentPlayed'],
  ['crash'],                         // Crash & 即开：Aviator 等，印度最热门的玩法放首屏
  ['indianCards'],                   // 印度纸牌：Andar Bahar / Teen Patti / 7 Up 7 Down 等
  ['popular', { limit: 12 }],
  ['sports', { limit: 3 }],          // 板球流量承接，从倒数第二上提
  ['casino'],
  ['cashRebate'],
  ['slots'],
  ['providerZone'],
  ['highRtp', { layout: 'small' }],
  ['lossRebate'],
  ['recommended'],
  ['highRebate', { layout: 'small' }],
  ['newGames'],
  ['lottery', { layout: 'small' }],
  ['bettingTable'],
  ['perya', null, true], ['fishing', null, true], ['baccarat', null, true],
]

const pin = (gameUuid, pinPosition = null) => ({ gameUuid, action: 'pin', pinPosition })
const ex = (gameUuid) => ({ gameUuid, action: 'exclude', pinPosition: null })

const SECTION_GAMES = {
  popular: [
    // Aviator / Andar Bahar 等印度玩法已由 crash、indianCards 两个专区承接（选品先于热门），这里不再钉
    ex('568win:1020:90'),       // Color Game：菲律宾 perya 玩法
    ex('568win:20:6'),          // CrazyTime：INR 下常置灰
    ex('568win:1044:104'),      // SUPER GEMS (PlayStar)：INR 下置灰
    ex('568win:1044:62'),       // MAHJONG WAYS 3 (PlayStar)：INR 下置灰
    ex('568win:1046:51'),       // POKER WIN (FaChai)：INR 下置灰
    ex('568win:20:108'),        // Speed Baccarat A：算法的真人保底席位，印度不偏好百家乐
  ],
  // 推荐精选的池是全库：热门排除掉的游戏会流到这里，要同样排除；另排除 INR 下置灰的与百家乐
  recommended: [
    ex('568win:1020:90'),       // Color Game
    ex('568win:20:108'),        // Speed Baccarat A
    ex('568win:20:168'),        // Golden Wealth Baccarat
    ex('568win:20:6'),          // CrazyTime：INR 下置灰
    ex('568win:1044:104'),      // SUPER GEMS：INR 下置灰
    ex('568win:1044:62'),       // MAHJONG WAYS 3：INR 下置灰
    ex('568win:1046:51'),       // POKER WIN：INR 下置灰
    ex('568win:3:694'),         // Sugar Rush Super Scatter：INR 下置灰
    ex('568win:1034:68'),       // Sugar Crush (AdvantPlay)：INR 下置灰
    ex('568win:2:111'),         // Poseidon (CQ9)：INR 下置灰
  ],
  highRtp: [
    ex('568win:1020:90'),       // Color Game
  ],
  // 真人区钉选属第2组：维护中的会让位给可用游戏，不会置灰占位
  casino: [
    pin('568win:20:166'),       // Super Andar Bahar (Evolution)
    pin('568win:38:787'),       // Roulette Indian (Pragmatic Play)
    pin('568win:20:162'),       // Emperor Dragon Tiger (Evolution)
    pin('568win:1020:149'),     // Pool Rummy (JILI)
  ],
  slots: [
    pin('568win:1031:225'),     // Golden Taj Mahal (Habanero)
    pin('568win:1031:108'),     // Indian Cash Catcher (Habanero)
    ex('568win:1046:2'),        // CHINESE NEW YEAR (FaChai)
    ex('568win:1046:4'),        // NIGHT MARKET (FaChai)
  ],
  sports: [
    ex('568win:44:2'),          // Saba E-Sports：留 BTi / Saba / Panda 三个有板球盘口的
    ex('568win:1080:7'),        // Lucky Sports Basketball
  ],
}

// 热门/推荐/高RTP/高洗码从全库选品、维护游戏置灰占位 —— 这是为临时维护设计的。
// 代码侧已按「连续不可用满 24h」自动出池（sg-game.service LONG_UNAVAILABLE_MS），但计时从新代码上线起算，
// 上线后 24h 内仍靠这里按执行时的 INR 实时状态排除；满 24h 后把这段删掉重跑一次，释放这些排除项。
// 权重 <4000 是上游兜底权重，进不了这几个板块，不必写入；elite 档不看权重（高洗码按档位选）。
const ALL_POOL_SECTIONS = ['popular', 'recommended', 'highRtp', 'highRebate']

const env = loadEnv()
await runWithTenant({ id: 1, code: 'betogo', database: 'betogo', status: 'active', selfOperated: true }, async () => {
  await saveHomeLayout(env, CUR, LAYOUT.map(([sectionKey, params = null, hidden = false]) => ({ sectionKey, hidden, params })))
  const unavailable = (await getGamesFromCache(env, CUR))
    .filter((g) => g.isAvailable === false && (g.weight >= 4000 || g.cashbackTier === 'elite'))
    .map((g) => g.uuid)
  console.log(`INR 不可用且可能进首页的游戏 ${unavailable.length} 款，并入 ${ALL_POOL_SECTIONS.join('/')} 的排除`)
  for (const key of ALL_POOL_SECTIONS) {
    const items = SECTION_GAMES[key] ?? (SECTION_GAMES[key] = [])
    const listed = new Set(items.map((it) => it.gameUuid))
    for (const u of unavailable) if (!listed.has(u)) items.push(ex(u))
  }
  for (const [key, items] of Object.entries(SECTION_GAMES)) await replaceHomepageSectionGames(env, key, CUR, items)
  await refreshHomepageSelection(env)
  const after = await listHomeLayout(env, CUR)
  console.log('INR 布局：', after.map((r) => `${r.sortOrder}.${r.sectionKey}${r.hidden ? '(隐藏)' : ''}${r.params ? JSON.stringify(r.params) : ''}`).join(' '))
})
process.exit(0)
