// 动图拆分回填：把 51 款动画卡的 image_override 改回静态首帧(covers/ptgaming/*.png)，
// 动图URL(covers/ptgaming-anim/*.webp) 挪到新字段 image_anim；source 改回 playtime
// 前置：迁移107 已加 image_anim 字段；静图仍在服务器 covers/ptgaming/
import fs from 'fs';

const ROOT = '/Users/yannicky/tma-projects';
const hits = JSON.parse(fs.readFileSync(`${ROOT}/scripts/ptgaming-crawler/anim_cover_matches.json`, 'utf8'));
const esc = (s) => String(s).replace(/'/g, "''");

let sql = `-- 动图拆分回填（手动执行，勿进迁移）生成于 ${new Date().toISOString()}\n`;
sql += `-- ${hits.length} 款：image_override=静态首帧, image_anim=动图, source=playtime\n\n`;
sql += `INSERT INTO bg_568win_game_override (game_provider_id, game_id, image_override, image_override_source, image_anim) VALUES\n`;
sql += hits.map((h) =>
  `(${h.gpid},${h.gid},'/api/v1/home/images/covers/ptgaming/${esc(h.basename)}','playtime','/api/v1/home/images/covers/ptgaming-anim/${esc(h.webp)}')`
).join(',\n');
sql += `\nON DUPLICATE KEY UPDATE image_override=VALUES(image_override), image_override_source=VALUES(image_override_source), image_anim=VALUES(image_anim);\n`;
fs.writeFileSync(`${ROOT}/scripts/ptgaming-crawler/apply_anim_split.sql`, sql);
console.log(`SQL: apply_anim_split.sql (${hits.length} 行)`);
