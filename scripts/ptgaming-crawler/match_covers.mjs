// ptgaming(playtime) 方图封面 → 568win image_override
// 匹配：ptgaming provider→我方 provider(映射) + 归一化游戏名；命中即用 ptgaming 统一310×314方图覆盖
// 产出：covers_upload/(待上传的方图,扁平) + apply_covers.sql(image_override + source='playtime')
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/yannicky/tma-projects';
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

// ptgaming 厂商(归一化) → 我方 bg_568win_game.provider（与 build_matrix 同口径）
const PROVIDER_MAP = {
  jili: ['JiLiGaming', 'Jili'], pg: ['PGSoft'], pgsoft: ['PGSoft'],
  pp: ['PragmaticPlay', 'PragmaticPlayCasino'], pragmaticplay: ['PragmaticPlay', 'PragmaticPlayCasino'],
  cq9: ['CQ9'], jdb: ['JDB'], fc: ['FaChai'], fachai: ['FaChai'], km: ['KingMidas'],
  pt: ['PlayTech'], playtech: ['PlayTech'], ygr: ['YGR'], bng: ['Booongo'], booongo: ['Booongo'],
  '5g': ['5GGames'], playstar: ['PlayStar'], rtg: ['RTGSlots'], evolution: ['EvolutionGaming'],
  hbn: ['Habanero'], habanero: ['Habanero'], hacksaw: ['HacksawGaming'], nlc: ['NoLimitCity'],
  netent: ['Netent', 'NetentExtended'], ygg: ['Yggdrasil'], yggdrasil: ['Yggdrasil'],
  redtiger: ['Red Tiger'], btg: ['BigTimeGaming'], spribe: ['Spribe'], kagaming: ['KAGaming'],
  jokergaming: ['JokerGaming'], relaxgaming: ['RelaxGaming'], microgaming: ['MicroGaming'],
  sagaming: ['SexyGaming'], fastspin: ['Fastspin'], nextspin: ['Nextspin'],
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

const ptgaming = JSON.parse(fs.readFileSync(`${ROOT}/data/ptgaming/games.json`, 'utf8'));

// 一个 568win 游戏(gpid:gid)只取一张封面（首个命中）
const covers = new Map(); // gpid:gid -> {gpid,gid,basename,ptName,ourProvider}
const stat = {};
for (const g of ptgaming) {
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
      if (covers.has(k)) continue;
      covers.set(k, { gpid: w.gpid, gid: w.gid, basename: path.basename(g.localImage), ptName: g.name, ourProvider: op });
      hitThis = true;
    }
  }
  if (hitThis) stat[g.provider].hit++;
}

const list = [...covers.values()];
console.log(`ptgaming 参与匹配厂商: ${Object.keys(stat).length}, 覆盖我方游戏行数: ${list.length}`);
for (const [k, v] of Object.entries(stat).sort((a, b) => b[1].hit - a[1].hit)) console.log(`  ${k}: ${v.hit}/${v.total}`);

// 拷贝命中的方图到扁平上传暂存目录
const STAGE = `${ROOT}/data/ptgaming/covers_upload`;
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
let copied = 0, missing = 0;
for (const c of list) {
  const src = `${ROOT}/data/ptgaming/images/${c.basename}`;
  if (fs.existsSync(src)) { fs.copyFileSync(src, `${STAGE}/${c.basename}`); copied++; }
  else missing++;
}
console.log(`封面拷贝到暂存: ${copied}, 源缺失: ${missing}`);

// 生成 SQL（image_override + source=playtime；覆盖旧 gzone 竖图）
const chunk = (a, n) => a.reduce((r, _, i) => (i % n ? r : [...r, a.slice(i, i + n)]), []);
const esc = (s) => String(s).replace(/'/g, "''");
let sql = `-- ptgaming 方图封面覆盖（手动执行，勿进迁移文件）生成于 ${new Date().toISOString()}\n`;
sql += `-- ${list.length} 款 568win 游戏 image_override 指向 ptgaming 统一310×314方图, source=playtime\n\n`;
for (const grp of chunk(list, 200)) {
  sql += `INSERT INTO bg_568win_game_override (game_provider_id, game_id, image_override, image_override_source) VALUES\n`;
  sql += grp.map((c) => `(${c.gpid},${c.gid},'/api/v1/home/images/covers/ptgaming/${esc(c.basename)}','playtime')`).join(',\n');
  sql += `\nON DUPLICATE KEY UPDATE image_override=VALUES(image_override), image_override_source=VALUES(image_override_source);\n\n`;
}
fs.writeFileSync(`${ROOT}/scripts/ptgaming-crawler/apply_covers.sql`, sql);
fs.writeFileSync(`${ROOT}/scripts/ptgaming-crawler/cover_matches.json`, JSON.stringify(list, null, 2));
console.log(`SQL: apply_covers.sql (${list.length} 行覆盖)`);
