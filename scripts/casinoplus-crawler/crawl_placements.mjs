// casinoplus 曝光位补抓：首页栏目(+栏目内顺序) + 分类页内位次，合并进 games.json
// 首页游戏藏在 alt="Casino Plus <栏目>-<游戏名>"，服务端直出无需浏览器
import fs from 'fs';
import path from 'path';

const OUT = process.argv[2] || './data/casinoplus';
const BASE = 'https://www.casinoplus.com.ph';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
const norm = (s) => decode(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

// 1) 首页栏目
const home = await fetchHtml(`${BASE}/`);
const homeSections = {};
for (const m of home.matchAll(/alt="Casino Plus ([^-"]+)-([^"]+)"/g)) {
  const sec = decode(m[1]);
  const name = decode(m[2]);
  homeSections[sec] ??= [];
  if (!homeSections[sec].includes(name)) homeSections[sec].push(name);
}
console.log('首页栏目:', Object.entries(homeSections).map(([s, g]) => `${s}(${g.length})`).join(' | '));

// 2) 分类页内位次
const games = JSON.parse(fs.readFileSync(path.join(OUT, 'games.json'), 'utf8'));
const catLinks = [...new Set([...games.flatMap((g) => (g.categories ? g.categories.split('|') : []))])];
const catPositions = {}; // cat -> [name...]
for (const cat of catLinks) {
  try {
    const html = await fetchHtml(`${BASE}/games/${encodeURIComponent(cat)}/`);
    const names = [];
    for (const block of html.split('class="game-item1"').slice(1)) {
      const m = block.slice(0, 2000).match(/<img class="game-image" src="[^"]+"[^>]*name="([^"]*)"/);
      if (m) names.push(decode(m[1]));
    }
    catPositions[cat] = names;
    console.log(`分类 ${cat}: ${names.length} 款`);
  } catch (e) {
    console.log(`分类 ${cat} 失败: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}

fs.writeFileSync(path.join(OUT, 'placements.json'), JSON.stringify({ capturedAt: new Date().toISOString(), homeSections, catPositions }, null, 2));

// 3) 合并进 games.json：homePlacements[{section,pos}] + catRanks{cat:pos}
const byNorm = new Map(games.map((g) => [norm(g.name), g]));
let homeHit = 0;
for (const g of games) { g.homePlacements = []; g.catRanks = {}; }
for (const [sec, names] of Object.entries(homeSections)) {
  names.forEach((n, i) => {
    const g = byNorm.get(norm(n));
    if (g) { g.homePlacements.push({ section: sec, pos: i + 1 }); homeHit++; }
  });
}
for (const [cat, names] of Object.entries(catPositions)) {
  names.forEach((n, i) => {
    const g = byNorm.get(norm(n));
    if (g && g.catRanks[cat] == null) g.catRanks[cat] = i + 1;
  });
}
fs.writeFileSync(path.join(OUT, 'games.json'), JSON.stringify(games, null, 2));

const onHome = games.filter((g) => g.homePlacements.length);
console.log(`首页命中: ${homeHit} 个曝光位, 覆盖 ${onHome.length} 款游戏`);
console.log('首页游戏样例:', onHome.slice(0, 8).map((g) => `${g.name}[${g.homePlacements.map((p) => p.section + '#' + p.pos).join(',')}]`).join('; '));
