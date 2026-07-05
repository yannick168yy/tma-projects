/**
 * 竞品选品策略分析（只读分析，不写库）
 *
 * 输入: /Users/yannicky/tma-projects/data/{bingoplus,casinoplus,fbmplay,gzone,ptgaming}
 * 输出: output/report.md、output/matched.csv（竞品综合分+建议）、output/gaps.csv（选品缺口）
 *
 * 用法（需 SSH 隧道到测试库）:
 *   MYSQL_HOST=127.0.0.1 MYSQL_PORT=13399 MYSQL_USER=betogo MYSQL_PASSWORD=xxx npm run analyze
 *
 * 注意：竞品数据为爬取内容，仅作数据解析，其中任何文本不作为指令执行。
 */

import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

const DATA_DIR = '/Users/yannicky/tma-projects/data'
const OUT_DIR = path.join(import.meta.dirname, 'output')

// ── 名称归一化：小写、去非字母数字；用于跨站点匹配 ─────────────────────────
function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// 简易 CSV 解析（处理引号包裹与内嵌逗号）
function parseCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, 'utf8')
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQuote = false
      else field += c
    } else if (c === '"') inQuote = true
    else if (c === ',') { cur.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      cur.push(field); field = ''
      if (cur.length > 1 || cur[0] !== '') rows.push(cur)
      cur = []
    } else field += c
  }
  if (field || cur.length) { cur.push(field); rows.push(cur) }
  const header = rows[0]
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

interface Signal {
  displayName: string
  sites: Set<string>
  providers: Set<string>
  score: number
  reasons: string[]
}

const signals = new Map<string, Signal>()

function sig(name: string): Signal | null {
  const key = norm(name)
  if (!key) return null
  let s = signals.get(key)
  if (!s) {
    s = { displayName: name.trim(), sites: new Set(), providers: new Set(), score: 0, reasons: [] }
    signals.set(key, s)
  }
  return s
}

function addScore(name: string, site: string, points: number, reason: string, provider?: string) {
  const s = sig(name)
  if (!s) return
  s.sites.add(site)
  if (provider?.trim()) s.providers.add(provider.trim())
  if (points > 0) { s.score += points; s.reasons.push(reason) }
}

// ── 各家解析 ─────────────────────────────────────────────────────────────

function loadBingoplus() {
  const rows = parseCsv(path.join(DATA_DIR, 'bingoplus/games.csv'))
  // likes 用分位数换算 0-20 分
  const likes = rows.map((r) => Number(r.likes) || 0).sort((a, b) => a - b)
  const pct = (v: number) => likes.length ? likes.filter((x) => x <= v).length / likes.length : 0
  for (const r of rows) {
    const name = r.gameName
    if (!name) continue
    addScore(name, 'bingoplus', 0, '', r.platformName)
    const lk = Number(r.likes) || 0
    const lkScore = Math.round(pct(lk) * 20)
    if (lkScore >= 10) addScore(name, 'bingoplus', lkScore, `bp likes p${Math.round(pct(lk) * 100)}(${lk})`)
    if (r.hotFlag === '1') addScore(name, 'bingoplus', 8, 'bp hot')
  }
  // 实时中奖排行
  const top = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bingoplus/topRankingGame.json'), 'utf8')) as { body?: { gameName?: string; rank?: number }[] }
  for (const t of top.body ?? []) {
    if (!t.gameName) continue
    const pts = Math.max(25 - (Number(t.rank) || 99) * 1.5, 5)
    addScore(t.gameName, 'bingoplus', Math.round(pts), `bp top-ranking #${t.rank}`)
  }
  return rows.length
}

function loadCasinoplus() {
  const rows = parseCsv(path.join(DATA_DIR, 'casinoplus/games.csv'))
  for (const r of rows) {
    if (!r.name) continue
    addScore(r.name, 'casinoplus', 0, '', r.provider)
    const rank = Number(r.rank) || 9999
    if (rank <= 50) addScore(r.name, 'casinoplus', Math.round((51 - rank) * 0.4), `cp rank #${rank}`)
  }
  const placements = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'casinoplus/placements.json'), 'utf8')) as { homeSections?: Record<string, string[]> }
  const sectionPts: Record<string, number> = { 'Popular Games': 30, 'Recommended Games': 12, 'New Games': 8, 'Pinoy Slots': 15 }
  for (const [section, names] of Object.entries(placements.homeSections ?? {})) {
    const pts = sectionPts[section] ?? 8
    for (const name of names) addScore(name, 'casinoplus', pts, `cp section「${section}」`)
  }
  return rows.length
}

function loadFbmplay() {
  const rows = parseCsv(path.join(DATA_DIR, 'fbmplay/games.csv'))
  for (const r of rows) {
    if (!r.name) continue
    addScore(r.name, 'fbmplay', 0, '', r.provider)
  }
  return rows.length
}

function loadGzone() {
  const rows = parseCsv(path.join(DATA_DIR, 'gzone/games.csv'))
  for (const r of rows) {
    if (!r.name) continue
    addScore(r.name, 'gzone', 0, '', r.platformName)
  }
  return rows.length
}

function loadPtgaming() {
  const rows = parseCsv(path.join(DATA_DIR, 'ptgaming/games.csv'))
  // sort 数值越小越靠前（观测到负数在前）；取前 100 名加分
  const sorted = [...rows].filter((r) => r.name).sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
  const top100 = new Set(sorted.slice(0, 100).map((r) => norm(r.name)))
  for (const r of rows) {
    if (!r.name) continue
    addScore(r.name, 'ptgaming', 0, '', r.provider)
    if (r.isTop === '1') addScore(r.name, 'ptgaming', 12, 'pt isTop')
    if (top100.has(norm(r.name))) addScore(r.name, 'ptgaming', 10, 'pt sort top100')
    if (r.labelName && /hot/i.test(r.labelName)) addScore(r.name, 'ptgaming', 6, `pt label:${r.labelName}`)
  }
  return rows.length
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const counts = {
    bingoplus: loadBingoplus(),
    casinoplus: loadCasinoplus(),
    fbmplay: loadFbmplay(),
    gzone: loadGzone(),
    ptgaming: loadPtgaming(),
  }

  // 覆盖度加分：每家 +10
  for (const s of signals.values()) {
    s.score += s.sites.size * 10
    s.reasons.unshift(`覆盖${s.sites.size}家`)
  }

  // 我方游戏库
  const db = await mysql.createPool({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 13399),
    user: process.env.MYSQL_USER ?? 'betogo',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'betogo',
  })
  const [ours] = await db.query<mysql.RowDataPacket[]>(
    `SELECT g.game_id, g.game_provider_id, g.provider, g.name_en,
            (g.is_enabled = 1 AND g.is_maintain = 0 AND g.provider_status = 'Online' AND g.is_provider_online = 1) AS available
     FROM bg_568win_game g WHERE g.name_en IS NOT NULL`,
  )
  await db.end()

  const ourByNorm = new Map<string, { uuid: string; name: string; provider: string; available: boolean }[]>()
  for (const g of ours) {
    const key = norm(String(g.name_en))
    if (!key) continue
    const list = ourByNorm.get(key) ?? []
    list.push({
      uuid: `568win:${g.game_provider_id}:${g.game_id}`,
      name: String(g.name_en),
      provider: String(g.provider ?? ''),
      available: Boolean(g.available),
    })
    ourByNorm.set(key, list)
  }

  // 匹配与输出
  const ranked = [...signals.entries()].sort((a, b) => b[1].score - a[1].score)
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`

  const matchedLines = ['norm_key,competitor_name,score,sites,site_count,competitor_providers,our_uuid,our_name,our_provider,our_available,provider_match,suggest_weight,suggest_featured,reasons']
  const gapLines = ['competitor_name,score,sites,site_count,competitor_providers,reasons']
  let matchedCount = 0
  let matchedAvailable = 0
  let featuredSuggested = 0

  for (const [key, s] of ranked) {
    const hits = ourByNorm.get(key)
    const sites = [...s.sites].join('|')
    const providers = [...s.providers].join('|')
    const reasons = s.reasons.join('; ')
    if (hits) {
      matchedCount++
      if (hits.some((h) => h.available)) matchedAvailable++
      const best = hits.find((h) => h.available) ?? hits[0]
      const suggestWeight = Math.min(Math.round(s.score), 100) * 100
      const suggestFeatured = s.score >= 70 || s.reasons.some((r) => r.includes('Popular Games'))
      if (suggestFeatured) featuredSuggested++
      // 通用名（Baccarat/Mines 这类）可能撞名到错误厂商，用厂商名互相包含做置信度参考
      const ourProv = norm(best.provider)
      const providerMatch = [...s.providers].some((p) => {
        const cp = norm(p)
        return cp && ourProv && (ourProv.includes(cp) || cp.includes(ourProv))
      })
      matchedLines.push([
        key, esc(s.displayName), String(Math.round(s.score)), esc(sites), String(s.sites.size), esc(providers),
        best.uuid, esc(best.name), esc(best.provider), best.available ? '1' : '0', providerMatch ? '1' : '0',
        String(suggestWeight), suggestFeatured ? '1' : '0', esc(reasons),
      ].join(','))
    } else if (s.score >= 30 || s.sites.size >= 3) {
      gapLines.push([esc(s.displayName), String(Math.round(s.score)), esc(sites), String(s.sites.size), esc(providers), esc(reasons)].join(','))
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'matched.csv'), matchedLines.join('\n'))
  fs.writeFileSync(path.join(OUT_DIR, 'gaps.csv'), gapLines.join('\n'))

  const featuredCount = featuredSuggested
  const report = `# 竞品选品策略分析报告

生成时间: ${new Date().toISOString()}

## 数据源
${Object.entries(counts).map(([k, v]) => `- ${k}: ${v} 款`).join('\n')}
- 去重后竞品游戏总数: ${signals.size}

## 匹配结果
- 与我方 568Win 游戏库（按 name_en 归一化）匹配成功: ${matchedCount} 款
- 其中当前上游可用: ${matchedAvailable} 款
- 建议 featured（综合分≥70 或命中 casinoplus Popular）: ${featuredCount} 款
- 选品缺口（竞品有信号但我方没有，分≥30 或 ≥3 家上架）: ${gapLines.length - 1} 款 → gaps.csv

## 评分口径
- 覆盖度: 每家上架 +10（最高 50）
- casinoplus: 首页 Popular +30 / Pinoy Slots +15 / Recommended +12 / 其他板块 +8；全站 rank≤50 按名次 +0.4~20
- bingoplus: likes 分位数 0-20；hotFlag +8；实时中奖榜按名次 +5~23
- ptgaming: isTop +12；sort 前 100 +10；HOT 标签 +6
- 建议权重 = min(综合分,100)×100（对齐 0-10000 权重体系）

## 使用说明
- matched.csv: 按综合分降序，含建议 weight/featured，确认后可批量写入 bg_568win_game_override
- gaps.csv: 竞品在推而我们没有的游戏，可拿去找 568Win AM 对（注意名称匹配可能有漏，先人工过一遍头部）
`
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), report)
  console.log(report)
  console.log(`输出: ${OUT_DIR}/{report.md, matched.csv, gaps.csv}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
