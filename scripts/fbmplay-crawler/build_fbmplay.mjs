// fbmplay.com 游戏封面爬取：抓首页 → 解析 vike_pageContext 内嵌 JSON → 提取游戏 + 下载方图封面
// fbmplay = Vike(Vite SSR) SPA，首页 HTML 内嵌 <script id="vike_pageContext"> 含 hotGames/newGames/clientTabModuleGameList
// 全站按平台计 ~1246 款，内嵌覆盖 ~1166 款(94%)全带图；封面统一方图(170-360px)风格重制，画质好
// 图片基址 https://static.fbmplay.com/image/<imgUrl>，需带 Referer 防盗链
import fs from 'fs';
import path from 'path';

const OUT = './data/fbmplay';
const IMG_DIR = path.join(OUT, 'images');
fs.mkdirSync(IMG_DIR, { recursive: true });
const IMG_BASE = 'https://static.fbmplay.com/image/';
const HDRS = { 'Referer': 'https://www.fbmplay.com/', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' };

// 抓首页
const html = await (await fetch('https://www.fbmplay.com/', { headers: HDRS })).text();
const grab = (id) => {
  const start = html.indexOf(`<script id="${id}" type="application/json">`);
  if (start < 0) throw new Error(`未找到 ${id}`);
  const s = html.indexOf('>', start) + 1, e = html.indexOf('</script>', s);
  return JSON.parse(html.slice(s, e));
};
const d = grab('vike_pageContext').data;
fs.writeFileSync(path.join(OUT, 'pageContext_data.json'), JSON.stringify(d, null, 1));

const sanitize = (s) => (s || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);

// 三个来源去重（gameDataPkCode 主键，退化用 code）
const seen = new Map();
const collect = (arr) => {
  for (const e of arr || []) {
    const g = e.gameResponseDto, p = e.gamePlatformResponseDto;
    if (!g) continue;
    const key = g.gameDataPkCode || `c:${g.gameCode}`;
    const lang = g.langGameResponseDto || {};
    const img = e.imgUrl || lang.h5Img || lang.h5SmallImg || g.h5Img || '';
    if (!img) continue;
    if (seen.has(key)) continue;
    const show = p?.langGamePlatformResponseDto?.gameShowName || '';
    const platformKey = p?.gamePlatformKey || '';
    const name = g.fullName || g.gameName || '';
    seen.set(key, {
      code: g.gameCode,
      dataPkCode: g.gameDataPkCode,
      name,
      provider: show,          // JILI/PG/PP/EVO/FC/JDB/5G/YB/OP/FBM
      platformKey,             // JILI_SLOT/PG_SLOT/...
      gameType: p?.gameType,
      img,
      localImage: `images/${sanitize(show || 'x')}__${sanitize(name)}__${sanitize(g.gameCode)}${path.extname(img) || '.png'}`,
    });
  }
};
collect(d.hotGames); collect(d.newGames); collect(d.clientTabModuleGameList);
const games = [...seen.values()];

fs.writeFileSync(path.join(OUT, 'games.json'), JSON.stringify(games, null, 2));
const csvEsc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(path.join(OUT, 'games.csv'),
  ['code,provider,platformKey,name,gameType,img,localImage']
    .concat(games.map((g) => [g.code, g.provider, g.platformKey, g.name, g.gameType, g.img, g.localImage].map(csvEsc).join(',')))
    .join('\n'));

const byProv = {};
for (const g of games) byProv[g.provider] = (byProv[g.provider] || 0) + 1;
console.log(`游戏去重后: ${games.length}, 厂商分布: ${JSON.stringify(byProv)}`);

// 下载封面
const queue = games.filter((g) => !fs.existsSync(path.join(OUT, g.localImage)));
let ok = 0, fail = 0;
const failed = [];
async function dl(g, attempt = 1) {
  try {
    const res = await fetch(IMG_BASE + g.img, { headers: HDRS, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error('too small');
    fs.writeFileSync(path.join(OUT, g.localImage), buf);
    ok++;
  } catch (e) {
    if (attempt < 3) return dl(g, attempt + 1);
    fail++; failed.push({ code: g.code, name: g.name, img: g.img, err: String(e.message || e) });
  }
}
let idx = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (idx < queue.length) {
    const g = queue[idx++];
    await dl(g);
    if ((ok + fail) % 200 === 0) console.log(`下载: ${ok + fail}/${queue.length}`);
  }
}));
fs.writeFileSync(path.join(OUT, 'download_failed.json'), JSON.stringify(failed, null, 2));
console.log(`封面下载: 成功 ${ok}, 失败 ${fail}, 跳过 ${games.length - queue.length}`);
