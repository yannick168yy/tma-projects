// fbmplay 方图封面 → 568win image_override，仅补 ptgaming 未覆盖的游戏
// 匹配：fbmplay provider(gameShowName)→我方 provider(映射) + 归一化游戏名
// 排除：已被 ptgaming(playtime/playtime-anim)覆盖的 gpid:gid（读 cover_matches.json + anim_cover_matches.json）
// 产出：covers_upload/(待上传方图,扁平) + apply_covers.sql(image_override + source='fbmplay')
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/yannicky/tma-projects';
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

// fbmplay gameShowName(归一) → 我方 bg_568win_game.provider
const PROVIDER_MAP = {
  jili: ['JiLiGaming', 'Jili'], pg: ['PGSoft'], pp: ['PragmaticPlay', 'PragmaticPlayCasino'],
  fc: ['FaChai'], jdb: ['JDB'], '5g': ['5GGames'], evo: ['EvolutionGaming'],
  yb: ['YellowBat'], op: ['OnlyPlay'],
};

// 我方 568win 索引：provider||norm(name) → [{gpid,gid}]
const win568 = new Map();
for (const line of fs.readFileSync(`${ROOT}/scripts/competitor-matrix/win568_games.tsv`, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const [gpid, gid, provider, , , ...rest] = line.split('\t');
  const name = rest.join('\t');
  if (!provider || provider === 'NULL' || !name) continue;
  const key = `${provider}||${norm(name)}`;
  if (!win568.has(key)) win568.set(key, []);
  win568.get(key).push({ gpid: Number(gpid), gid: Number(gid) });
}

// ptgaming 已覆盖的 gpid:gid（不重复覆盖，fbmplay 只补空缺）
const ptCovered = new Set();
for (const f of ['cover_matches.json', 'anim_cover_matches.json']) {
  for (const c of JSON.parse(fs.readFileSync(`${ROOT}/scripts/ptgaming-crawler/${f}`, 'utf8'))) ptCovered.add(`${c.gpid}:${c.gid}`);
}
console.log(`ptgaming 已覆盖 ${ptCovered.size} 款，fbmplay 仅补空缺`);

const fbm = JSON.parse(fs.readFileSync(`${ROOT}/data/fbmplay/games.json`, 'utf8'));

const covers = new Map(); // gpid:gid -> {...}
const stat = {};
let skipPtCovered = 0;
for (const g of fbm) {
  const ours = PROVIDER_MAP[norm(g.provider)];
  if (!ours) continue;
  stat[g.provider] ??= { total: 0, hit: 0 };
  stat[g.provider].total++;
  let hitThis = false;
  for (const op of ours) {
    const found = win568.get(`${op}||${norm(g.name)}`);
    if (!found) continue;
    for (const w of found) {
      const k = `${w.gpid}:${w.gid}`;
      if (ptCovered.has(k)) { skipPtCovered++; continue; }
      if (covers.has(k)) continue;
      covers.set(k, { gpid: w.gpid, gid: w.gid, basename: path.basename(g.localImage), fbmName: g.name, ourProvider: op });
      hitThis = true;
    }
  }
  if (hitThis) stat[g.provider].hit++;
}

const list = [...covers.values()];
console.log(`fbmplay 命中(去除ptgaming已覆盖): ${list.length} 款；跳过已被ptgaming覆盖 ${skipPtCovered}`);
for (const [k, v] of Object.entries(stat).sort((a, b) => b[1].hit - a[1].hit)) console.log(`  ${k}: ${v.hit}/${v.total}`);

// 拷贝命中封面到扁平上传暂存目录
const STAGE = `${ROOT}/data/fbmplay/covers_upload`;
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
let copied = 0, missing = 0;
for (const c of list) {
  const src = `${ROOT}/data/fbmplay/images/${c.basename}`;
  if (fs.existsSync(src)) { fs.copyFileSync(src, `${STAGE}/${c.basename}`); copied++; }
  else missing++;
}
console.log(`封面拷贝到暂存: ${copied}, 源缺失: ${missing}`);

const chunk = (a, n) => a.reduce((r, _, i) => (i % n ? r : [...r, a.slice(i, i + n)]), []);
const esc = (s) => String(s).replace(/'/g, "''");
let sql = `-- fbmplay 方图封面覆盖（手动执行，勿进迁移文件）生成于 ${new Date().toISOString()}\n`;
sql += `-- ${list.length} 款 568win 游戏 image_override 指向 fbmplay 方图, source=fbmplay（仅补 ptgaming 未覆盖）\n\n`;
for (const grp of chunk(list, 200)) {
  sql += `INSERT INTO bg_568win_game_override (game_provider_id, game_id, image_override, image_override_source) VALUES\n`;
  sql += grp.map((c) => `(${c.gpid},${c.gid},'/api/v1/home/images/covers/fbmplay/${esc(c.basename)}','fbmplay')`).join(',\n');
  sql += `\nON DUPLICATE KEY UPDATE image_override=VALUES(image_override), image_override_source=VALUES(image_override_source);\n\n`;
}
fs.writeFileSync(`${ROOT}/scripts/fbmplay-crawler/apply_covers.sql`, sql);
fs.writeFileSync(`${ROOT}/scripts/fbmplay-crawler/cover_matches.json`, JSON.stringify(list, null, 2));
console.log(`SQL: apply_covers.sql (${list.length} 行覆盖)`);
