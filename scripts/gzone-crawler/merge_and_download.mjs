import fs from 'fs';
import path from 'path';

const CAP = './gzone_capture';
const OUT = process.argv[2];
const IMG_DIR = path.join(OUT, 'images');
fs.mkdirSync(IMG_DIR, { recursive: true });

const readJson = (prefix) => {
  const f = fs.readdirSync(CAP).find((n) => n.startsWith(prefix));
  return JSON.parse(fs.readFileSync(path.join(CAP, f), 'utf8'));
};

const info = readJson('GAME_BASE_ALL_INFO_');
const imgs = readJson('GAME_BASE_ALL_IMG_');
const imgMap = new Map(imgs.map((i) => [i.id, i]));

const sanitize = (s) => (s || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);

const games = info.map((g) => {
  const im = imgMap.get(g.id) || {};
  const imageUrl = im.gameImageNewVersion || im.gameImg || '';
  return {
    id: g.id,
    gameId: g.gameId,
    name: g.nameEn,
    platformId: g.platformId,
    platformName: g.platformName,
    gameType: g.gameType,
    hotFlag: g.hotFlag,
    newFlag: g.newFlag,
    imageUrl,
    imageUrlAlt: im.gameImg || '',
    localImage: imageUrl ? `images/${sanitize(g.platformName)}__${sanitize(g.nameEn)}__${g.id}${path.extname(new URL(imageUrl).pathname) || '.webp'}` : '',
  };
});

fs.writeFileSync(path.join(OUT, 'games.json'), JSON.stringify(games, null, 2));
const csvEsc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(
  path.join(OUT, 'games.csv'),
  ['id,gameId,name,platformName,gameType,imageUrl,localImage']
    .concat(games.map((g) => [g.id, g.gameId, g.name, g.platformName, g.gameType, g.imageUrl, g.localImage].map(csvEsc).join(',')))
    .join('\n')
);

console.log(`游戏总数: ${games.length}, 有图: ${games.filter((g) => g.imageUrl).length}`);
const byPlat = {};
for (const g of games) byPlat[g.platformName] = (byPlat[g.platformName] || 0) + 1;
console.log('厂商分布:', JSON.stringify(byPlat));

// 并发下载
const queue = games.filter((g) => g.imageUrl && !fs.existsSync(path.join(OUT, g.localImage)));
let ok = 0, fail = 0;
const failed = [];

async function dl(g, attempt = 1) {
  try {
    const res = await fetch(g.imageUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error('too small');
    fs.writeFileSync(path.join(OUT, g.localImage), buf);
    ok++;
  } catch (e) {
    if (attempt < 3) return dl(g, attempt + 1);
    fail++;
    failed.push({ id: g.id, name: g.name, url: g.imageUrl, err: String(e.message || e) });
  }
}

const CONC = 16;
let idx = 0;
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (idx < queue.length) {
      const g = queue[idx++];
      await dl(g);
      if ((ok + fail) % 200 === 0) console.log(`进度: ${ok + fail}/${queue.length}`);
    }
  })
);

fs.writeFileSync(path.join(OUT, 'download_failed.json'), JSON.stringify(failed, null, 2));
console.log(`下载完成: 成功 ${ok}, 失败 ${fail}, 跳过已存在 ${games.filter((g) => g.imageUrl).length - queue.length}`);
