// ptgaming 动图封面应用：cover_matches.json ∩ 动画卡 → 暂存上传目录 + 覆盖 SQL
// 前置：build_animated_covers.mjs 已产出 data/ptgaming/anim_covers/*.webp
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const COVERS_DIR = `${ROOT}/data/ptgaming/anim_covers`;
const matches = JSON.parse(fs.readFileSync(`${ROOT}/scripts/ptgaming-crawler/cover_matches.json`, 'utf8'));

// 动图文件与静图 basename 同名（同一套 sanitize），仅扩展名 png→webp
const hits = [];
for (const m of matches) {
  const webp = m.basename.replace(/\.\w+$/, '.webp');
  if (fs.existsSync(path.join(COVERS_DIR, webp))) hits.push({ ...m, webp });
}
console.log(`动画卡命中我站: ${hits.length} 款`);

const STAGE = `${ROOT}/data/ptgaming/anim_covers_upload`;
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const h of hits) fs.copyFileSync(path.join(COVERS_DIR, h.webp), path.join(STAGE, h.webp));

const esc = (s) => String(s).replace(/'/g, "''");
let sql = `-- ptgaming 动图封面覆盖（手动执行，勿进迁移文件）生成于 ${new Date().toISOString()}\n`;
sql += `-- ${hits.length} 款动画卡游戏 image_override 指向动图 webp(232×235,~230KB), source=playtime-anim\n\n`;
sql += `INSERT INTO bg_568win_game_override (game_provider_id, game_id, image_override, image_override_source) VALUES\n`;
sql += hits.map((h) => `(${h.gpid},${h.gid},'/api/v1/home/images/covers/ptgaming-anim/${esc(h.webp)}','playtime-anim')`).join(',\n');
sql += `\nON DUPLICATE KEY UPDATE image_override=VALUES(image_override), image_override_source=VALUES(image_override_source);\n`;
fs.writeFileSync(`${ROOT}/scripts/ptgaming-crawler/apply_anim_covers.sql`, sql);
fs.writeFileSync(`${ROOT}/scripts/ptgaming-crawler/anim_cover_matches.json`, JSON.stringify(hits, null, 2));
console.log(`SQL: apply_anim_covers.sql (${hits.length} 行)；上传暂存: data/ptgaming/anim_covers_upload/`);
console.log(hits.map((h) => `${h.ptName} (${h.ourProvider})`).join('\n'));
