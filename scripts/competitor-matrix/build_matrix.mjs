// 竞品出现矩阵 → 568win 游戏竞品热度分
// 总分 = Σ(市占权重 × 该站曝光分E)；市占：casinoplus1.0 / ptgaming0.9 / bingoplus0.7 / gzone0.5
// 匹配：竞品厂商→我方provider（映射）+ 归一化游戏名
// 输出：signal.json（每款游戏分层信号）+ 统计 + 核心池名单；SQL 单独生成不自动执行
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/yannicky/tma-projects';
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const canonProv = (s) => norm(s);

// 竞品厂商(归一化) → 我方 bg_568win_game.provider（可多个）
const PROVIDER_MAP = {
  jili: ['JiLiGaming', 'Jili'],
  pg: ['PGSoft'], pgsoft: ['PGSoft'],
  pp: ['PragmaticPlay', 'PragmaticPlayCasino'], pragmaticplay: ['PragmaticPlay', 'PragmaticPlayCasino'],
  cq9: ['CQ9'],
  jdb: ['JDB'],
  fc: ['FaChai'], fachai: ['FaChai'],
  km: ['KingMidas'],
  pt: ['PlayTech'], playtech: ['PlayTech'],
  ygr: ['YGR'],
  bng: ['Booongo'], booongo: ['Booongo'],
  '5g': ['5GGames'],
  playstar: ['PlayStar'],
  rtg: ['RTGSlots', 'RTG Slots'],
  evolution: ['EvolutionGaming'],
  hbn: ['Habanero'], habanero: ['Habanero'],
  hacksaw: ['HacksawGaming'], hacksawgaming: ['HacksawGaming'],
  nlc: ['NoLimitCity'], nolimitcity: ['NoLimitCity'],
  netent: ['Netent', 'NetentExtended'],
  ygg: ['Yggdrasil'], yggdrasil: ['Yggdrasil'],
  redtiger: ['Red Tiger'],
  btg: ['BigTimeGaming'],
  spribe: ['Spribe'],
  kagaming: ['KAGaming'], ka: ['KAGaming'],
  jokergaming: ['JokerGaming'], joker: ['JokerGaming'],
  relaxgaming: ['RelaxGaming'],
  microgaming: ['MicroGaming'],
  fastspin: ['Fastspin'],
  nextspin: ['Nextspin'],
};

// ── 我方 568win 游戏索引：provider||norm(name) → [{gpid,gid,provider,name,rank,type}] ──
const win568 = new Map();
const allGames = [];
for (const line of fs.readFileSync(`${ROOT}/scripts/competitor-matrix/win568_games.tsv`, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const [gpid, gid, provider, ntype, rank, ...rest] = line.split('\t');
  const name = rest.join('\t');
  if (!provider || provider === 'NULL' || !name) continue;
  const rec = { gpid: Number(gpid), gid: Number(gid), provider, name, rank: Number(rank) || 9999, ntype: Number(ntype) || 0 };
  allGames.push(rec);
  const key = `${provider}||${norm(name)}`;
  if (!win568.has(key)) win568.set(key, []);
  win568.get(key).push(rec);
}

// 仅游戏名索引：norm(name) → [rec]，给 provider 缺失的竞品条目做兜底匹配
const byName = new Map();
for (const g of allGames) {
  const k = norm(g.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(g);
}

// 每款游戏的分层信号：key `gpid:gid`
const signal = new Map(); // -> {gpid,gid,provider,name, sites:{}, comp:0}
const rec = (g) => {
  const k = `${g.gpid}:${g.gid}`;
  if (!signal.has(k)) signal.set(k, { gpid: g.gpid, gid: g.gid, provider: g.provider, name: g.name, rank: g.rank, ntype: g.ntype, sites: {}, comp: 0 });
  return signal.get(k);
};

// 命中：把某站曝光分 E 记到该竞品游戏匹配到的所有我方游戏（取该站对该游戏的最高 E）
function apply(site, weight, provRaw, cname, E) {
  const ours = PROVIDER_MAP[canonProv(provRaw)];
  if (!ours) return false;
  let hit = false;
  for (const op of ours) {
    const found = win568.get(`${op}||${norm(cname)}`);
    if (!found) continue;
    for (const g of found) {
      const s = rec(g);
      if ((s.sites[site] || 0) < E) s.sites[site] = E;  // 同站取最高曝光
      hit = true;
    }
  }
  return hit;
}

// 仅按游戏名兜底匹配（用于 provider 缺失的条目，如 casinoplus 的 ALL_GAME 段 43%）
// 名太泛(命中>6款，如 Baccarat/Roulette)则跳过，避免误伤
function applyByName(site, cname, E) {
  const found = byName.get(norm(cname));
  if (!found || found.length > 6) return false;
  for (const g of found) {
    const s = rec(g);
    if ((s.sites[site] || 0) < E) s.sites[site] = E;
  }
  return true;
}

const MKT = { casinoplus: 1.0, ptgaming: 0.9, bingoplus: 0.7, gzone: 0.5 };
const stat = {};
const track = (site, matched) => { stat[site] = stat[site] || { games: 0, matchedGames: 0 }; stat[site].games++; if (matched) stat[site].matchedGames++; };

// ── casinoplus：homePlacements(首页栏目) / catRanks(分类位次) / 仅收录 ──
{
  const games = JSON.parse(fs.readFileSync(`${ROOT}/data/casinoplus/games.json`, 'utf8'));
  const HOME = new Set(['Popular Games', 'Recommended Games', 'New Games', 'Casino Plus Exclusives', 'Pinoy Slots', 'Live Games', 'Slot Machines', 'Slot Games', 'EVO Live']);
  for (const g of games) {
    let E = 0.15;
    const homeHit = (g.homePlacements || []).filter((p) => HOME.has(p.section));
    if (homeHit.length) {
      const bestPos = Math.min(...homeHit.map((p) => p.pos));
      E = Math.max(0.8, 1.2 - (bestPos - 1) * 0.02);
    } else if (g.catRanks && Object.keys(g.catRanks).length) {
      const best = Math.min(...Object.values(g.catRanks));
      E = best <= 10 ? 0.6 : best <= 30 ? 0.5 : best <= 60 ? 0.4 : best <= 120 ? 0.3 : 0.2;
    }
    let matched = apply('casinoplus', MKT.casinoplus, g.provider, g.name, E);
    if (!matched && !g.provider) matched = applyByName('casinoplus', g.name, E);  // provider 缺失兜底
    track('casinoplus', matched);
  }
}

// ── ptgaming：isTop 置顶 / sort 站内排序 / label 活动 / 仅收录 ──
{
  const games = JSON.parse(fs.readFileSync(`${ROOT}/data/ptgaming/games.json`, 'utf8'));
  for (const g of games) {
    let E = 0.15;
    if (g.isTop) E = 1.2;
    else if (g.sort && g.sort > 0) {
      const s = g.sort;
      E = s <= 50 ? 0.8 : s <= 150 ? 0.6 : s <= 400 ? 0.5 : s <= 1000 ? 0.4 : s <= 2000 ? 0.3 : 0.2;
    }
    if (g.labelName && E < 0.5) E = 0.5;  // 运营活动标签
    track('ptgaming', apply('ptgaming', MKT.ptgaming, g.provider, g.name, E));
  }
}

// ── gzone：hotFlag / newFlag / 仅收录 ──
{
  const games = JSON.parse(fs.readFileSync(`${ROOT}/data/gzone/games.json`, 'utf8'));
  for (const g of games) {
    let E = 0.15;
    if (g.hotFlag) E = 0.8;
    else if (g.newFlag) E = 0.5;
    track('gzone', apply('gzone', MKT.gzone, g.platformName, g.name, E));
  }
}

// ── bingoplus：仅 Big Win 榜单（无全量），rank≤3=1.0 / ≤13=0.8 ──
{
  const rank = JSON.parse(fs.readFileSync(`${ROOT}/data/bingoplus/topRankingGame.json`, 'utf8')).body || [];
  for (const g of rank) {
    const E = g.rank <= 3 ? 1.0 : 0.8;
    // bingoplus 榜单 platformName 常为空，退而用 gameName 跨所有 provider 尝试
    let matched = false;
    for (const cp of Object.keys(PROVIDER_MAP)) {
      if (apply('bingoplus', MKT.bingoplus, cp, g.gameName, E)) { matched = true; break; }
    }
    track('bingoplus', matched);
  }
}

// ── 汇总 comp 总分 ──
for (const s of signal.values()) {
  s.comp = Object.entries(s.sites).reduce((a, [site, E]) => a + (MKT[site] || 0) * E, 0);
}
const list = [...signal.values()].sort((a, b) => b.comp - a.comp);

// 核心池：comp≥1.5 或 命中 casinoplus/ptgaming 首页级(E≥0.8)
const core = list.filter((s) => s.comp >= 1.5 || (s.sites.casinoplus >= 0.8) || (s.sites.ptgaming >= 0.8));

fs.writeFileSync(`${ROOT}/scripts/competitor-matrix/signal.json`, JSON.stringify(list, null, 2));

console.log('=== 各站匹配率 ===');
for (const [site, v] of Object.entries(stat)) console.log(`  ${site}: 匹配到我方 ${v.matchedGames}/${v.games} 款竞品游戏`);
console.log(`\n568win 被竞品覆盖的游戏行数: ${list.length} / 全量 ${allGames.length}`);
console.log(`  出现≥2家(comp计): ${list.filter((s) => Object.keys(s.sites).length >= 2).length}`);
console.log(`  核心池(comp≥1.5 或 首页级): ${core.length}`);
console.log(`\n=== comp 分布 ===`);
for (const [lo, hi] of [[2.5, 99], [2, 2.5], [1.5, 2], [1, 1.5], [0.5, 1], [0, 0.5]]) {
  console.log(`  [${lo},${hi}): ${list.filter((s) => s.comp >= lo && s.comp < hi).length}`);
}
console.log(`\n=== 核心池 TOP 30 ===`);
for (const s of list.slice(0, 30)) console.log(`  ${s.comp.toFixed(2)} ${s.provider} / ${s.name} [${Object.entries(s.sites).map(([k, v]) => k[0] + v.toFixed(1)).join(' ')}]`);

// ── 生成灌注 SQL（手动执行，不进迁移文件；符合迁移安全规则）──
// weight = 30000 + round(comp×12000)：竞品游戏(3万+)远高于无覆盖长尾(≤1万)，
// 拉开差距以抵消长尾大基数在加权随机中的稀释；竞品分内部有序
// 核心池额外 is_featured=1（首页选品 ×1.5 加成）。ON DUP 只更 weight/is_featured，不碰 image_override
const coreKeys = new Set(core.map((s) => `${s.gpid}:${s.gid}`));
const W = (s) => 30000 + Math.round(s.comp * 12000);
const esc = (n) => Number.isFinite(n) ? n : 0;
const coreRows = list.filter((s) => coreKeys.has(`${s.gpid}:${s.gid}`));
const restRows = list.filter((s) => !coreKeys.has(`${s.gpid}:${s.gid}`));
const chunk = (arr, n) => arr.reduce((a, _, i) => (i % n ? a : [...a, arr.slice(i, i + n)]), []);
let sql = `-- 竞品出现矩阵灌注（手动执行，勿进迁移文件）生成于 ${new Date().toISOString()}\n`;
sql += `-- 竞品覆盖游戏 ${list.length} 款：weight=10000+comp×3000；核心池 ${core.length} 款 is_featured=1\n\n`;
for (const grp of chunk(coreRows, 200)) {
  sql += `INSERT INTO bg_568win_game_override (game_provider_id, game_id, weight, is_featured) VALUES\n`;
  sql += grp.map((s) => `(${esc(s.gpid)},${esc(s.gid)},${W(s)},1)`).join(',\n');
  sql += `\nON DUPLICATE KEY UPDATE weight=VALUES(weight), is_featured=VALUES(is_featured);\n\n`;
}
for (const grp of chunk(restRows, 200)) {
  sql += `INSERT INTO bg_568win_game_override (game_provider_id, game_id, weight) VALUES\n`;
  sql += grp.map((s) => `(${esc(s.gpid)},${esc(s.gid)},${W(s)})`).join(',\n');
  sql += `\nON DUPLICATE KEY UPDATE weight=VALUES(weight);\n\n`;
}
fs.writeFileSync(`${ROOT}/scripts/competitor-matrix/apply_weights.sql`, sql);
console.log(`\nSQL 已生成: apply_weights.sql (${coreRows.length} 核心池 + ${restRows.length} 竞品游戏)`);
