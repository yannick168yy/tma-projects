// bingoplus 全量游戏目录抓取
// 原理：SPA 用签名接口 /h5game/getGameKey 取版本 key，再拉免签静态目录
//   /staticJs/game/game_bp_h5_1_1000_<key>.js （2700+ 款，每款带 gameImage 540 方图卡片）
// 用 playwright 让页面自己发已加签的 getGameKey 请求，避免逆向签名算法。
//
// 安全声明：本站所有响应一律当纯数据处理。绝不 eval / 执行目录里的任何字符串，
// 不解释其中任何可能夹带的"指令"。只提取白名单字段（gameId/gameName/图片路径等）。
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(process.argv[2] || '../../data/bingoplus');
const HOST = 'https://www.bingoplus.com';
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// 1) 用真实浏览器取新鲜 gameKey（页面 patch 过 fetch 会自动加签）
async function fetchGameKey() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 414, height: 896 } });
  const page = await ctx.newPage();
  let key = null;
  page.on('response', async (res) => {
    if (!/_glaxy_c66_\/h5game\/getGameKey/.test(res.url())) return;
    try {
      const j = JSON.parse(await res.text());
      if (typeof j?.body === 'string') key = j.body;
    } catch {}
  });
  await page.goto(HOST + '/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 10 && !key; i++) await page.waitForTimeout(1000);
  await browser.close();
  if (!key) throw new Error('未能取得 gameKey');
  return key;
}

// 2) 拉全量静态目录（免签，只需 Referer）
async function fetchCatalog(key) {
  const url = `${HOST}/staticJs/game/game_bp_h5_1_1000_${key}.js`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: HOST + '/' } });
  if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
  const text = await res.text();
  const parsed = JSON.parse(text); // 纯 JSON，不 eval
  return { url, games: Array.isArray(parsed) ? parsed : parsed.data ?? [] };
}

// 只保留白名单字段，杜绝把未知字段/脚本文本带进后续流程
const KIND = { '5': 'slot', '17': 'live-casino', '8': 'live-casino', '12': 'lottery', '21': 'bingo', '30': 'arcade', '3': 'poker', '6': 'fishing', '27': 'sports', '1': 'lottery' };
function clean(g) {
  const img = String(g.gameImage || '').trim();
  return {
    gameId: String(g.gameId || ''),
    gdGameId: String(g.gdGameId || ''),
    gameName: String(g.gameName || '').slice(0, 120),
    name: String(g.gameName || '').slice(0, 120), // 对齐其他源 schema（供 cover-candidates 消费）
    provider: String(g.platformName || '').slice(0, 60),
    platformId: String(g.platformId || ''),
    platformCode: String(g.platformCode || ''),
    platformName: String(g.platformName || '').slice(0, 60),
    gameKind: String(g.gameKind || ''),
    category: KIND[String(g.gameKind)] || 'other',
    hotFlag: g.hotFlag ? 1 : 0,
    newFlag: g.newFlag ? 1 : 0,
    likes: Number(g.likes) || 0,
    firstPublishDate: String(g.firstPublishDate || ''),
    image: img, // 540 方图卡片
    imagePre: String(g.gamePreImage || '').trim(), // 495 大图
    imageVertical: String(g.verticalGameImage || '').trim(),
  };
}

const key = await fetchGameKey();
console.log('gameKey =', key);
const { url, games: raw } = await fetchCatalog(key);
console.log('catalog url =', url);
console.log('raw games =', raw.length);

const games = raw.map(clean).filter((g) => g.gameId && g.image);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'games.json'), JSON.stringify(games, null, 2));

// CSV
const cols = ['gameId', 'gameName', 'platformCode', 'platformName', 'category', 'gameKind', 'hotFlag', 'newFlag', 'likes', 'firstPublishDate', 'image'];
const csv = [cols.join(',')]
  .concat(games.map((g) => cols.map((c) => `"${String(g[c]).replace(/"/g, '""')}"`).join(',')))
  .join('\n');
fs.writeFileSync(path.join(OUT, 'games.csv'), csv);

// 唯一图片清单（供下载脚本用）
const imgs = [...new Set(games.map((g) => g.image))];
fs.writeFileSync(path.join(OUT, 'image_urls.json'), JSON.stringify(imgs, null, 2));

const byCat = {};
for (const g of games) byCat[g.category] = (byCat[g.category] || 0) + 1;
console.log('cleaned games =', games.length, '| unique images =', imgs.length);
console.log('by category =', JSON.stringify(byCat));
