// casinoplus.com.ph 游戏抓取：SEO 站服务端直出 HTML，无需浏览器
// 数据源：/games/（All 全量，卡片顺序=官方运营排序）+ 各分类页（打分类标签）
// 厂商：官方未结构化输出，从图片路径段推断（pp/jili/pg/cq9 等，约六成覆盖）
import fs from 'fs';
import path from 'path';

const OUT = process.argv[2] || './data/casinoplus';
const IMG_DIR = path.join(OUT, 'images');
fs.mkdirSync(IMG_DIR, { recursive: true });

const BASE = 'https://www.casinoplus.com.ph';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function parseCards(html) {
  const cards = [];
  for (const block of html.split('class="game-item1"').slice(1)) {
    const b = block.slice(0, 2000);
    const img = b.match(/<img class="game-image" src="([^"]+)"[^>]*name="([^"]*)"/);
    if (!img) continue;
    const href = b.match(/<a href="([^"]*)"/);
    cards.push({ image: img[1], name: img[2].trim(), href: href ? href[1] : '' });
  }
  return cards;
}

// 图片路径厂商段 → 通用厂商名（与 match_covers.mjs 的映射口径对齐）
const PROVIDER_BY_SEG = {
  pp: 'PP', jili: 'JILI', pg: 'PG', cq9: 'CQ9', jdb: 'JDB', fc: 'FC',
  km: 'KM', playtech: 'PLAYTECH', PT: 'PLAYTECH', rtg: 'RTG', egs: 'EGS', '5g': '5G',
};
function providerOf(imageUrl) {
  const m = imageUrl.match(/\/cpms\/([^/]+)\//);
  return (m && PROVIDER_BY_SEG[m[1]]) || '';
}

const allHtml = await fetchHtml(`${BASE}/games/`);

// 分类导航（排除 All 自身）
const catLinks = [...allHtml.matchAll(/<a data-type="GAME" href="\/games\/([^/"]+)\/">/g)]
  .map((m) => decodeURIComponent(m[1]))
  .filter((c) => c.toLowerCase() !== 'all');
console.log('分类:', catLinks.join(' | '));

const games = new Map(); // key=name 小写归一
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

parseCards(allHtml).forEach((c, i) => {
  const k = norm(c.name);
  if (!k || games.has(k)) return;
  games.set(k, { name: c.name, provider: providerOf(c.image), rank: i + 1, categories: [], imageUrl: c.image, href: c.href });
});
console.log(`All 页游戏: ${games.size}`);

for (const cat of [...new Set(catLinks)]) {
  try {
    const html = await fetchHtml(`${BASE}/games/${encodeURIComponent(cat)}/`);
    const cards = parseCards(html);
    let added = 0;
    cards.forEach((c, i) => {
      const k = norm(c.name);
      if (!k) return;
      if (!games.has(k)) {
        games.set(k, { name: c.name, provider: providerOf(c.image), rank: 9000 + i, categories: [], imageUrl: c.image, href: c.href });
        added++;
      }
      games.get(k).categories.push(cat);
    });
    console.log(`分类 ${cat}: ${cards.length} 款（新增 ${added}）`);
  } catch (e) {
    console.log(`分类 ${cat} 抓取失败: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}

const sanitize = (s) => (s || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
const list = [...games.values()].sort((a, b) => a.rank - b.rank).map((g, i) => ({
  id: i + 1,
  ...g,
  categories: [...new Set(g.categories)].join('|'),
  localImage: `images/${sanitize(g.provider || 'unknown')}__${sanitize(g.name)}__${i + 1}${path.extname(new URL(g.imageUrl).pathname) || '.webp'}`,
}));

fs.writeFileSync(path.join(OUT, 'games.json'), JSON.stringify(list, null, 2));
const csvEsc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(
  path.join(OUT, 'games.csv'),
  ['id,name,provider,rank,categories,imageUrl,localImage']
    .concat(list.map((g) => [g.id, g.name, g.provider, g.rank, g.categories, g.imageUrl, g.localImage].map(csvEsc).join(',')))
    .join('\n')
);
console.log(`游戏总数: ${list.length}, 有厂商: ${list.filter((g) => g.provider).length}`);
const byProv = {};
for (const g of list) byProv[g.provider || '?'] = (byProv[g.provider || '?'] || 0) + 1;
console.log('厂商分布:', JSON.stringify(byProv));

// 并发下载封面
const queue = list.filter((g) => !fs.existsSync(path.join(OUT, g.localImage)));
let ok = 0, fail = 0;
const failed = [];
async function dl(g, attempt = 1) {
  try {
    const res = await fetch(g.imageUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error('too small');
    fs.writeFileSync(path.join(OUT, g.localImage), buf);
    ok++;
  } catch (e) {
    if (attempt < 3) return dl(g, attempt + 1);
    fail++;
    failed.push({ name: g.name, url: g.imageUrl, err: String(e.message || e) });
  }
}
const CONC = 12;
let idx = 0;
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (idx < queue.length) {
      const g = queue[idx++];
      await dl(g);
      if ((ok + fail) % 200 === 0) console.log(`下载进度: ${ok + fail}/${queue.length}`);
    }
  })
);
fs.writeFileSync(path.join(OUT, 'download_failed.json'), JSON.stringify(failed, null, 2));
console.log(`下载完成: 成功 ${ok}, 失败 ${fail}, 跳过 ${list.length - queue.length}`);
