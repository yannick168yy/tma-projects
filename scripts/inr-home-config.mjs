// 手动执行，不自动部署。INR（印度站）首页装修一次性配置：布局顺序/显隐/卡型 + 热门/真人/老虎机/体育的钉选与排除。
// 重复执行是幂等的（布局 upsert，钉选按 (板块,INR) 先删后插），只动 INR，不影响其他币种。
// 用法：拷进 tma-bff-node 容器的 /app 后执行 `node inr-home-config.mjs`（依赖 /app/dist）
import { loadEnv } from './dist/config/env.js'
import { runWithTenant } from './dist/lib/tenant-context.js'
import { listHomeLayout, saveHomeLayout, replaceHomepageSectionGames } from './dist/services/admin-store.js'
import { refreshHomepageSelection } from './dist/services/sg-game.service.js'

const CUR = 'INR'

// 顺序即渲染顺序；hidden 的放最后
const LAYOUT = [
  ['announcement'], ['banner'], ['recentPlayed'],
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
    pin('568win:1072:1', 1),    // Aviator (Spribe)
    pin('568win:38:808', 2),    // Andar Bahar (Pragmatic Play)
    pin('568win:1020:69', 3),   // 7 UP 7 DOWN (JILI)
    pin('568win:1042:707', 4),  // Teen Patti 20-20 (KA Gaming)
    pin('568win:1020:164', 5),  // Crash Cricket (JILI)
    pin('568win:1020:131', 6),  // Color Prediction (JILI)
    pin('568win:3:187', 7),     // Dragon Tiger (Pragmatic Play)
    pin('568win:1020:168', 8),  // Jhandi Munda (JILI)
    ex('568win:1020:90'),       // Color Game：菲律宾 perya 玩法
    ex('568win:20:6'),          // CrazyTime：INR 下常置灰
    ex('568win:1044:104'),      // SUPER GEMS (PlayStar)：INR 下置灰
    ex('568win:1044:62'),       // MAHJONG WAYS 3 (PlayStar)：INR 下置灰
    ex('568win:1046:51'),       // POKER WIN (FaChai)：INR 下置灰
    ex('568win:20:108'),        // Speed Baccarat A：算法的真人保底席位，印度不偏好百家乐
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

const env = loadEnv()
await runWithTenant({ id: 1, code: 'betogo', database: 'betogo', status: 'active', selfOperated: true }, async () => {
  await saveHomeLayout(env, CUR, LAYOUT.map(([sectionKey, params = null, hidden = false]) => ({ sectionKey, hidden, params })))
  for (const [key, items] of Object.entries(SECTION_GAMES)) await replaceHomepageSectionGames(env, key, CUR, items)
  await refreshHomepageSelection(env)
  const after = await listHomeLayout(env, CUR)
  console.log('INR 布局：', after.map((r) => `${r.sortOrder}.${r.sectionKey}${r.hidden ? '(隐藏)' : ''}${r.params ? JSON.stringify(r.params) : ''}`).join(' '))
})
process.exit(0)
