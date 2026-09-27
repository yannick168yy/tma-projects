import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const EVIDENCE_FILE = path.join(ROOT, 'data/india-market/evidence.csv')
const CATALOG_FILE = path.join(ROOT, 'scripts/competitor-matrix/win568_games.tsv')
const SUPPLEMENT_FILE = path.join(ROOT, 'data/india-market/catalog-supplement.csv')
const OUT_DIR = path.join(HERE, 'output')
const NOW = new Date('2026-09-27T00:00:00Z')

const SOURCE_QUALITY = {
  operator_metrics: 1,
  market_research: 0.9,
  operator_lobby: 0.8,
  india_review: 0.45,
  global_report: 0.35,
  provider_official: 0.35,
}

const PROVIDER_ALIASES = new Map(Object.entries({
  pragmaticplay: ['PragmaticPlay', 'PragmaticPlayCasino'],
  pragmaticplaycasino: ['PragmaticPlayCasino'],
  pragmaticplaylive: ['PragmaticPlayCasino'],
  evolution: ['Evolution', 'EvolutionGaming'],
  evolutiongaming: ['Evolution', 'EvolutionGaming'],
  spribe: ['Spribe'],
  ezugi: ['Ezugi'],
  smartsoftgaming: ['SmartSoftGaming', 'SmartSoft'],
  playngo: ['PlaynGO', "Play'n GO"],
  pushgaming: ['PushGaming'],
  relaxgaming: ['RelaxGaming'],
  hackaswgaming: ['HacksawGaming'],
  hacksawgaming: ['HacksawGaming'],
  netent: ['Netent', 'NetentExtended'],
  playson: ['Playson'],
  topspin: ['TopSpin'],
}))

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows.filter((r) => r.some(Boolean))
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

function csvCell(value) {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function toCsv(rows, columns) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
}

function norm(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
}

function canonicalProvider(value) {
  const n = norm(value)
  if (n === 'pragmaticplaycasino') return 'pragmaticplay'
  if (n === 'evolutiongaming') return 'evolution'
  return n
}

function providerCandidates(provider) {
  const n = norm(provider)
  return new Set([provider, ...(PROVIDER_ALIASES.get(n) ?? [])].map(norm))
}

function recencyFactor(date) {
  const days = Math.max(0, (NOW - new Date(`${date}T00:00:00Z`)) / 86400000)
  if (days <= 180) return 1
  if (days <= 365) return 0.8
  if (days <= 730) return 0.55
  return 0.35
}

function rankFactor(rank) {
  const n = Number(rank)
  if (!n) return 0.25
  if (n === 1) return 1
  if (n <= 3) return 0.85
  if (n <= 10) return 0.65
  if (n <= 30) return 0.4
  return 0.2
}

function geoFactor(scope) {
  return scope === 'india' ? 1 : scope === 'south_asia' ? 0.7 : 0.35
}

function loadCatalog() {
  const games = []
  for (const line of fs.readFileSync(CATALOG_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const [gpid, gameId, provider, ntype, rank, ...nameParts] = line.split('\t')
    const name = nameParts.join('\t').replaceAll('�', '').trim()
    if (!provider || provider === 'NULL' || !name) continue
    games.push({ gpid: Number(gpid), gameId: Number(gameId), provider, name, ntype: Number(ntype), upstreamRank: Number(rank) })
  }
  for (const row of parseCsv(fs.readFileSync(SUPPLEMENT_FILE, 'utf8'))) {
    games.push({ gpid: Number(row.gpid), gameId: Number(row.game_id), provider: row.provider, name: row.name, ntype: 0, upstreamRank: 0 })
  }
  return games
}

function matchGame(signal, catalog) {
  const wantedProviders = providerCandidates(signal.provider)
  const exact = catalog.filter((g) => norm(g.name) === norm(signal.gameName) && wantedProviders.has(norm(g.provider)))
  if (exact.length === 1) return { status: 'matched', game: exact[0], matchType: 'exact' }
  if (exact.length > 1) return { status: 'ambiguous', matches: exact, matchType: 'duplicate_exact' }

  const aliases = new Set([norm(signal.gameName)])
  if (norm(signal.gameName) === 'rouletteindia') aliases.add('rouletteindian')
  if (norm(signal.gameName) === 'crazytime') aliases.add('crazytime')
  if (norm(signal.gameName) === 'speedbaccarat') aliases.add('speedbaccarata')
  const aliasHits = catalog.filter((g) => aliases.has(norm(g.name)) && wantedProviders.has(norm(g.provider)))
  if (aliasHits.length === 1) return { status: 'matched', game: aliasHits[0], matchType: 'alias' }
  if (aliasHits.length > 1) return { status: 'ambiguous', matches: aliasHits, matchType: 'duplicate_alias' }

  const sameName = catalog.filter((g) => norm(g.name) === norm(signal.gameName))
  return sameName.length
    ? { status: 'ambiguous', matches: sameName, matchType: 'provider_mismatch' }
    : { status: 'gap', matches: [], matchType: 'not_found' }
}

const evidence = parseCsv(fs.readFileSync(EVIDENCE_FILE, 'utf8'))
const grouped = new Map()
for (const row of evidence) {
  const provider = row.provider.trim()
  if (!provider) continue
  const key = `${canonicalProvider(provider)}||${norm(row.game_name)}`
  const quality = SOURCE_QUALITY[row.source_kind]
  if (!quality) throw new Error(`未知来源类型: ${row.source_kind}`)
  const points = 100 * quality * geoFactor(row.geo_scope) * rankFactor(row.rank) * recencyFactor(row.source_date) * Number(row.match_confidence || 1)
  const item = grouped.get(key) ?? { provider, gameName: row.game_name, category: row.category, evidence: [] }
  item.evidence.push({ ...row, points })
  grouped.set(key, item)
}

const signals = []
for (const item of grouped.values()) {
  const bestByDomain = new Map()
  for (const e of item.evidence) {
    const prev = bestByDomain.get(e.source_domain)
    if (!prev || e.points > prev.points) bestByDomain.set(e.source_domain, e)
  }
  const independentSources = bestByDomain.size
  const raw = [...bestByDomain.values()].reduce((sum, e) => sum + e.points, 0)
  const consensus = Math.min(1.4, 1 + Math.max(0, independentSources - 1) * 0.1)
  const adjusted = raw * consensus
  let weight = Math.min(10000, Math.round(2500 + adjusted * 30))
  const kinds = new Set([...bestByDomain.values()].map((e) => e.source_kind))
  if (kinds.size === 1 && kinds.has('provider_official')) weight = Math.min(weight, 3500)
  if (independentSources === 1 && !kinds.has('operator_metrics') && !kinds.has('market_research')) weight = Math.min(weight, 4500)
  const confidence = independentSources >= 3 && (kinds.has('operator_metrics') || kinds.has('market_research'))
    ? 'high'
    : independentSources >= 2 || kinds.has('operator_metrics') || kinds.has('market_research') ? 'medium' : 'low'
  signals.push({ ...item, raw, adjusted, independentSources, weight, confidence, evidenceKinds: [...kinds].sort().join('|') })
}
signals.sort((a, b) => b.weight - a.weight || b.adjusted - a.adjusted || a.gameName.localeCompare(b.gameName))

const catalog = loadCatalog()
const matched = []
const ambiguous = []
const gaps = []
for (const signal of signals) {
  const result = matchGame(signal, catalog)
  const sources = [...new Set(signal.evidence.map((e) => e.source_url))].join('|')
  const base = {
    game_name: signal.gameName,
    provider: signal.provider,
    category: signal.category,
    suggested_weight: signal.weight,
    confidence: signal.confidence,
    independent_sources: signal.independentSources,
    score: signal.adjusted.toFixed(2),
    evidence_kinds: signal.evidenceKinds,
    sources,
  }
  if (result.status === 'matched') {
    matched.push({ uuid: `568win:${result.game.gpid}:${result.game.gameId}`, ...base, catalog_name: result.game.name, catalog_provider: result.game.provider, match_type: result.matchType })
  } else if (result.status === 'ambiguous') {
    ambiguous.push({ ...base, match_type: result.matchType, candidates: result.matches.map((g) => `568win:${g.gpid}:${g.gameId}:${g.provider}:${g.name}`).join('|') })
  } else gaps.push({ ...base, reason: result.matchType })
}

const providerGroups = new Map()
for (const signal of signals) {
  const key = canonicalProvider(signal.provider)
  const group = providerGroups.get(key) ?? { signals: [], matched: [] }
  group.signals.push(signal)
  providerGroups.set(key, group)
}
for (const row of matched) providerGroups.get(canonicalProvider(row.provider))?.matched.push(row)
const providerScores = [...providerGroups.values()].map((group) => {
  group.signals.sort((a, b) => b.weight - a.weight)
  const top = group.signals.slice(0, 5)
  const mean = top.reduce((sum, g) => sum + g.weight, 0) / top.length
  const breadth = Math.min(1000, group.signals.filter((g) => g.weight >= 4000).length * 125)
  return {
    provider: group.signals[0].provider,
    suggested_weight: Math.min(10000, Math.round(mean * 0.9 + breadth)),
    evidence_games: group.signals.length,
    matched_games: group.matched.length,
    catalog_coverage_pct: Math.round(group.matched.length / group.signals.length * 100),
    top_games: top.map((g) => `${g.gameName}:${g.weight}`).join('|'),
  }
}).sort((a, b) => b.suggested_weight - a.suggested_weight)

fs.mkdirSync(OUT_DIR, { recursive: true })
const commonCols = ['game_name', 'provider', 'category', 'suggested_weight', 'confidence', 'independent_sources', 'score', 'evidence_kinds', 'sources']
fs.writeFileSync(path.join(OUT_DIR, 'matched.csv'), toCsv(matched, ['uuid', ...commonCols, 'catalog_name', 'catalog_provider', 'match_type']))
fs.writeFileSync(path.join(OUT_DIR, 'ambiguous.csv'), toCsv(ambiguous, [...commonCols, 'match_type', 'candidates']))
fs.writeFileSync(path.join(OUT_DIR, 'gaps.csv'), toCsv(gaps, [...commonCols, 'reason']))
fs.writeFileSync(path.join(OUT_DIR, 'provider-score.csv'), toCsv(providerScores, ['provider', 'suggested_weight', 'evidence_games', 'matched_games', 'catalog_coverage_pct', 'top_games']))

const topRows = matched.slice(0, 20).map((r, i) => `${i + 1}. ${r.game_name} / ${r.provider} — ${r.suggested_weight}（${r.confidence}，${r.independent_sources} 个独立来源）`).join('\n')
const marketTopRows = signals.slice(0, 20).map((r, i) => `${i + 1}. ${r.gameName} / ${r.provider} — ${r.weight}（${r.confidence}，${r.independentSources} 个独立来源）`).join('\n')
const report = `# 印度市场初始游戏权重研究

生成日期：2026-09-27

## 结果摘要

- 原始证据：${evidence.length} 条
- 厂商明确、可进入游戏级评分：${signals.length} 款
- 成功匹配 568Win：${matched.length} 款
- 存在同名或厂商歧义：${ambiguous.length} 款
- 我方目录未找到：${gaps.length} 款
- 生成厂商初始分：${providerScores.length} 家

## 评分口径

单条证据分 = 来源可信度 × 印度地域系数 × 榜单位置系数 × 时效系数 × 名称/厂商匹配置信度。  
同一域名对同一游戏只保留最强证据，随后按独立域名数量给予最高 1.4 倍共识加成。  
建议权重 = 2500 + 调整后证据分 × 30，封顶 10000。仅厂商宣传的游戏封顶 3500；单一普通推荐来源封顶 4500。

## 市场证据 Top 20

${marketTopRows || '无'}

## 已匹配 568Win Top 20

${topRows || '无'}

## 使用限制

- 这是互联网资料冷启动分，不是我方 INR 真实投注表现。
- 旧市场研究因时效衰减只提供弱到中等加分。
- 通用玩法但未指明厂商的证据不分摊给所有同名游戏，避免把错误版本推高。
- 目录快照来自 scripts/competitor-matrix/win568_games.tsv，并补充 scripts/inr-home-config.mjs 中已确认的 Evolution 游戏；应用前应再与测试库当前目录核对。
- 本轮不写数据库，不改变菲律宾权重。
`
fs.writeFileSync(path.join(OUT_DIR, 'report.md'), report)
console.log(report)
