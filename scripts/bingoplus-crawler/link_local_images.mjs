// 给 data/bingoplus/games.json 补 name / provider / localImage 三字段，对齐其他竞品源 schema，
// 供 scripts/cover-candidates/build.mjs 统一消费。localImage 用 images/ 目录里
// <platformCode>__<gameId>__ 前缀精确匹配实际下载文件（兼容文件名清洗差异）。
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.argv[2] || '../../data/bingoplus');
const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'games.json'), 'utf8'));
const files = fs.readdirSync(path.join(ROOT, 'images'));

// 与 download_images.mjs 完全一致的文件名清洗规则
const sanitize = (s) => String(s).replace(/[^\w.\-]/g, '_');

let linked = 0, missing = 0;
for (const g of games) {
  g.name = g.gameName;
  g.provider = g.platformName;
  const base = g.image.split('/').pop().split('?')[0];
  const prefix = sanitize(`${g.platformCode || 'NA'}__${g.gameId}__${base}`);
  // 优先精确文件名，其次同前缀（兼容碰撞时的 _ 前缀）
  let f = files.find((x) => x === prefix) || files.find((x) => x.endsWith(prefix));
  if (f) { g.localImage = `images/${f}`; linked++; }
  else { g.localImage = null; missing++; }
}
fs.writeFileSync(path.join(ROOT, 'games.json'), JSON.stringify(games, null, 2));
console.log(`linked ${linked}, missing ${missing} of ${games.length}`);
