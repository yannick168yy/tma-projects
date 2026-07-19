// ptgaming.ph(原 PlayTime) 全量游戏整理 + 封面下载
// 数据来源：登录后截获的 /api/v2/third-party-games/full（raw_full.json），3807 款
// 封面统一 310×314 方图（全厂商重制，规格一致）；CDN static.ptgaming.ph 有防盗链，下载需带 Referer
// 运营信号：sort(站内排序,越小越靠前) / is_top(置顶) / label_name(活动标签)
import fs from 'fs';
import path from 'path';

const OUT = process.argv[2] || './data/ptgaming';
const IMG_DIR = path.join(OUT, 'images');
fs.mkdirSync(IMG_DIR, { recursive: true });

// company_id → 通用厂商名（来自 set/get 的 third_company，固定 24 家）
const PROVIDER = {
  1: 'JILI', 2: 'PGSoft', 3: 'Evolution', 4: 'RTG', 5: 'FaChai', 6: 'Galaxsys',
  7: 'APGaming', 8: 'BetConstruct', 9: 'SAGaming', 10: 'PragmaticPlay', 11: 'JDB',
  12: 'SparkGame', 13: 'PlayTime', 14: 'SABA', 15: 'YellowBat', 16: 'PlayStar',
  17: 'CQ9', 18: 'PlayTech', 19: 'YGR', 20: 'KM', 21: 'BNG', 22: '5G', 23: 'Jumbo', 24: 'Sneaky',
};

const raw = JSON.parse(fs.readFileSync(path.join(OUT, 'raw_full.json'), 'utf8'));
const rows = raw.data.list.filter((g) => g.status === 1 && g.images);

const sanitize = (s) => (s || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
const cleanName = (s) => (s || '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();

const games = rows.map((g) => {
  const name = cleanName(g.name);
  const provider = PROVIDER[g.company_id] || `id${g.company_id}`;
  return {
    id: g.id,
    provider,
    companyId: g.company_id,
    name,
    gameType: g.game_type,
    thirdPartyGameId: g.third_party_game_id,
    sort: g.sort,                    // 站内排序（越小越靠前）
    isTop: g.is_top,                 // 首页置顶
    isAnimation: g.is_animation,     // 多帧动画卡（images 为静态首帧）
    isLandscape: g.is_landscape,     // 游戏运行方向（≠封面比例；封面统一方图）
    labelName: g.label_name || '',   // 活动标签（10%包赔 等运营标记）
    createdAt: g.created_at,         // 上线时间（新游判断）
    imageUrl: g.images,
    localImage: `images/${sanitize(provider)}__${sanitize(name)}__${g.id}${path.extname(new URL(g.images).pathname) || '.png'}`,
  };
});
// 站内排序：sort 升序（0 视为未排最后），同 sort 按 id
games.sort((a, b) => (a.sort || 1e9) - (b.sort || 1e9) || a.id - b.id);

fs.writeFileSync(path.join(OUT, 'games.json'), JSON.stringify(games, null, 2));
const csvEsc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(
  path.join(OUT, 'games.csv'),
  ['id,provider,name,gameType,sort,isTop,isAnimation,labelName,createdAt,imageUrl,localImage']
    .concat(games.map((g) => [g.id, g.provider, g.name, g.gameType, g.sort, g.isTop, g.isAnimation, g.labelName, g.createdAt, g.imageUrl, g.localImage].map(csvEsc).join(',')))
    .join('\n')
);

const byProv = {};
for (const g of games) byProv[g.provider] = (byProv[g.provider] || 0) + 1;
console.log(`游戏总数: ${games.length}, 置顶: ${games.filter((g) => g.isTop).length}, 带活动标签: ${games.filter((g) => g.labelName).length}, 动画卡: ${games.filter((g) => g.isAnimation).length}`);
console.log('厂商分布:', JSON.stringify(byProv));

// 并发下载封面（带 Referer 绕防盗链）
const HDRS = { 'Referer': 'https://www.ptgaming.ph/', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' };
const queue = games.filter((g) => !fs.existsSync(path.join(OUT, g.localImage)));
let ok = 0, fail = 0;
const failed = [];
async function dl(g, attempt = 1) {
  try {
    const res = await fetch(g.imageUrl, { headers: HDRS, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error('too small');
    fs.writeFileSync(path.join(OUT, g.localImage), buf);
    ok++;
  } catch (e) {
    if (attempt < 3) return dl(g, attempt + 1);
    fail++; failed.push({ id: g.id, name: g.name, url: g.imageUrl, err: String(e.message || e) });
  }
}
const CONC = 12;
let idx = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (idx < queue.length) {
    const g = queue[idx++];
    await dl(g);
    if ((ok + fail) % 300 === 0) console.log(`下载进度: ${ok + fail}/${queue.length}`);
  }
}));
fs.writeFileSync(path.join(OUT, 'download_failed.json'), JSON.stringify(failed, null, 2));
console.log(`下载完成: 成功 ${ok}, 失败 ${fail}, 跳过 ${games.length - queue.length}`);
