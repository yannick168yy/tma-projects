// 多源封面候选构建：为每款 568win 游戏，从各竞品源匹配出候选封面，供后台换图弹窗选择
// 源：playtime(ptgaming静图) / playtime-anim(动图) / fbmplay / gzone / casinoplus
// 568win 上游原图由后端直接从 icon_url 提供，不入候选表
// 产出：candidates.sql(灌 bg_568win_game_cover_candidate) + 各源命中图拷贝到 staging/<serverdir>/ 待上传
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/yannicky/tma-projects';
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

// 我方 568win 索引
const byProviderName = new Map(); // provider||norm(name) → [{gpid,gid}]
const byName = new Map();         // norm(name) → [{gpid,gid}]（名称兜底，casinoplus 无 provider 时用）
for (const line of fs.readFileSync(`${ROOT}/scripts/competitor-matrix/win568_games.tsv`, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const [gpid, gid, provider, , , ...rest] = line.split('\t');
  const name = rest.join('\t');
  if (!name || name === 'NULL') continue;
  const rec = { gpid: Number(gpid), gid: Number(gid) };
  if (provider && provider !== 'NULL') {
    const k = `${provider}||${norm(name)}`;
    if (!byProviderName.has(k)) byProviderName.set(k, []);
    byProviderName.get(k).push(rec);
  }
  const nk = norm(name);
  if (!byName.has(nk)) byName.set(nk, []);
  byName.get(nk).push(rec);
}

// 各源配置：games.json / 厂商字段 / 厂商映射 / 图片本地目录 / 服务器目录 / source 标识
const PT_MAP = {
  jili: ['JiLiGaming', 'Jili'], pg: ['PGSoft'], pgsoft: ['PGSoft'], pp: ['PragmaticPlay', 'PragmaticPlayCasino'],
  pragmaticplay: ['PragmaticPlay', 'PragmaticPlayCasino'], cq9: ['CQ9'], jdb: ['JDB'], fc: ['FaChai'], fachai: ['FaChai'],
  km: ['KingMidas'], pt: ['PlayTech'], playtech: ['PlayTech'], ygr: ['YGR'], bng: ['Booongo'], booongo: ['Booongo'],
  '5g': ['5GGames'], playstar: ['PlayStar'], rtg: ['RTGSlots'], evolution: ['EvolutionGaming'], hbn: ['Habanero'],
  habanero: ['Habanero'], hacksaw: ['HacksawGaming'], nlc: ['NoLimitCity'], netent: ['Netent', 'NetentExtended'],
  ygg: ['Yggdrasil'], yggdrasil: ['Yggdrasil'], redtiger: ['Red Tiger'], btg: ['BigTimeGaming'], spribe: ['Spribe'],
  kagaming: ['KAGaming'], jokergaming: ['JokerGaming'], relaxgaming: ['RelaxGaming'], microgaming: ['MicroGaming'],
  sagaming: ['SexyGaming'], fastspin: ['Fastspin'], nextspin: ['Nextspin'],
};
const FBM_MAP = {
  jili: ['JiLiGaming', 'Jili'], pg: ['PGSoft'], pp: ['PragmaticPlay', 'PragmaticPlayCasino'], fc: ['FaChai'],
  jdb: ['JDB'], '5g': ['5GGames'], evo: ['EvolutionGaming'], yb: ['YellowBat'], op: ['OnlyPlay'],
};
const GZ_MAP = {
  jili: ['JiLiGaming', 'Jili'], pg: ['PGSoft'], pp: ['PragmaticPlay', 'PragmaticPlayCasino'], evolution: ['EvolutionGaming'],
  fachai: ['FaChai'], jdb: ['JDB'], spribe: ['Spribe'], yb: ['YeeBet'], ygr: ['YGR'], hbn: ['Habanero'],
  pns: ['Peter & Sons'], cq9: ['CQ9'], '5g': ['5GGames'], pt: ['PlayTech'], tpg: ['Triple PG'], playstar: ['PlayStar'],
  rtg: ['RTGSlots'], hacksaw: ['HacksawGaming'], nlc: ['NoLimitCity'], bng: ['Booongo'], redtiger: ['Red Tiger'],
  kagaming: ['KAGaming'], netent: ['Netent', 'NetentExtended'], km: ['KingMidas'], btg: ['BigTimeGaming'],
  ygg: ['Yggdrasil'], evoplay: ['Evoplay'],
};
const CP_MAP = {
  pp: ['PragmaticPlay', 'PragmaticPlayCasino'], jili: ['JiLiGaming', 'Jili'], pg: ['PGSoft'], cq9: ['CQ9'],
  jdb: ['JDB'], fc: ['FaChai'], rtg: ['RTGSlots'], playtech: ['PlayTech'], km: ['KingMidas'], '5g': ['5GGames'],
};

const SOURCES = [
  { source: 'playtime', serverDir: 'ptgaming', games: 'data/ptgaming/games.json', imgDir: 'data/ptgaming/images', provField: 'provider', map: PT_MAP },
  { source: 'fbmplay', serverDir: 'fbmplay', games: 'data/fbmplay/games.json', imgDir: 'data/fbmplay/images', provField: 'provider', map: FBM_MAP },
  { source: 'gzone', serverDir: 'gzone', games: 'data/gzone/games.json', imgDir: 'data/gzone/images', provField: 'platformName', map: GZ_MAP },
  { source: 'casinoplus', serverDir: 'casinoplus', games: 'data/casinoplus/games.json', imgDir: 'data/casinoplus/images', provField: 'provider', map: CP_MAP, nameFallback: true },
];

const STAGE = `${ROOT}/data/cover-candidates`;
fs.rmSync(STAGE, { recursive: true, force: true });

// 51 款动图：gpid:gid → 动图 webp 名（跟随 playtime 候选，不作独立源）
const animByGame = new Map();
for (const a of JSON.parse(fs.readFileSync(`${ROOT}/scripts/ptgaming-crawler/anim_cover_matches.json`, 'utf8'))) {
  animByGame.set(`${a.gpid}:${a.gid}`, a.webp);
}
const animStage = `${STAGE}/ptgaming-anim`;
fs.mkdirSync(animStage, { recursive: true });
for (const a of JSON.parse(fs.readFileSync(`${ROOT}/scripts/ptgaming-crawler/anim_cover_matches.json`, 'utf8'))) {
  const src = `${ROOT}/data/ptgaming/anim_covers/${a.webp}`;
  if (fs.existsSync(src)) fs.copyFileSync(src, `${animStage}/${a.webp}`);
}

// candidate: gpid:gid:source → {gpid,gid,source,basename,animUrl}
const cand = new Map();
const summary = {};

for (const cfg of SOURCES) {
  const games = JSON.parse(fs.readFileSync(`${ROOT}/${cfg.games}`, 'utf8'));
  const stageDir = `${STAGE}/${cfg.serverDir}`;
  fs.mkdirSync(stageDir, { recursive: true });
  let hit = 0;
  const copied = new Set();
  for (const g of games) {
    const prov = g[cfg.provField];
    const targets = [];
    const ours = cfg.map[norm(prov)];
    if (ours) {
      for (const op of ours) targets.push(...(byProviderName.get(`${op}||${norm(g.name)}`) || []));
    } else if (cfg.nameFallback) {
      targets.push(...(byName.get(norm(g.name)) || []));
    }
    if (!targets.length) continue;
    const basename = path.basename(g.localImage);
    const src = `${ROOT}/${cfg.imgDir}/${basename}`;
    if (!fs.existsSync(src)) continue;
    let added = false;
    for (const t of targets) {
      const k = `${t.gpid}:${t.gid}:${cfg.source}`;
      if (cand.has(k)) continue;
      const animWebp = cfg.source === 'playtime' ? animByGame.get(`${t.gpid}:${t.gid}`) : undefined;
      const animUrl = animWebp ? `/api/v1/home/images/covers/ptgaming-anim/${animWebp}` : null;
      cand.set(k, { gpid: t.gpid, gid: t.gid, source: cfg.source, serverDir: cfg.serverDir, basename, animUrl });
      added = true;
    }
    if (added && !copied.has(basename)) { fs.copyFileSync(src, `${stageDir}/${basename}`); copied.add(basename); }
    if (added) hit++;
  }
  summary[cfg.source] = { matchedRows: [...cand.values()].filter((c) => c.source === cfg.source).length, images: copied.size };
}

const list = [...cand.values()];
console.log(`候选总行数: ${list.length}`);
for (const [s, v] of Object.entries(summary)) console.log(`  ${s}: ${v.matchedRows} 行, ${v.images} 图`);
console.log(`  playtime 带动图: ${list.filter((c) => c.animUrl).length}`);
const gamesWithCand = new Set(list.map((c) => `${c.gpid}:${c.gid}`)).size;
console.log(`有候选的游戏数: ${gamesWithCand}`);

// 生成 SQL
const esc = (s) => String(s).replace(/'/g, "''");
const sqlVal = (v) => (v == null ? 'NULL' : `'${esc(v)}'`);
const chunk = (a, n) => a.reduce((r, _, i) => (i % n ? r : [...r, a.slice(i, i + n)]), []);
let sql = `-- 多源封面候选（手动执行，勿进迁移）生成于 ${new Date().toISOString()}\n`;
sql += `DELETE FROM bg_568win_game_cover_candidate;\n\n`;
for (const grp of chunk(list, 500)) {
  sql += `INSERT INTO bg_568win_game_cover_candidate (game_provider_id, game_id, source, url, anim_url) VALUES\n`;
  sql += grp.map((c) => `(${c.gpid},${c.gid},'${c.source}','/api/v1/home/images/covers/${c.serverDir}/${esc(c.basename)}',${sqlVal(c.animUrl)})`).join(',\n');
  sql += `\nON DUPLICATE KEY UPDATE url=VALUES(url), anim_url=VALUES(anim_url);\n\n`;
}
fs.writeFileSync(`${ROOT}/scripts/cover-candidates/candidates.sql`, sql);
console.log(`SQL: candidates.sql; staging: data/cover-candidates/<源>/`);
