import fs from 'fs';

// gzone platformName → 我方 bg_568win_game.provider（可多个）
const PROVIDER_MAP = {
  'JILI': ['JiLiGaming', 'Jili'],
  'PG': ['PGSoft', 'PG Soft'],
  'PP': ['PragmaticPlay', 'PragmaticPlayCasino', 'Pragmatic Play Casino'],
  'EVOLUTION': ['EvolutionGaming'],
  'FACHAI': ['FaChai'],
  'JDB': ['JDB'],
  'SPRIBE': ['Spribe'],
  'YB': ['YeeBet'],
  'YGR': ['YGR'],
  'HBN': ['Habanero'],
  'PNS': ['Peter & Sons'],
  'CQ9': ['CQ9', 'CQ9 Casino'],
  '5G': ['5GGames'],
  'PT': ['PlayTech', 'Playtech Casino'],
  'TPG': ['Triple PG'],
  'PLAYSTAR': ['PlayStar'],
  'RTG': ['RTG Slots'],
  'HACKSAW': ['HacksawGaming', 'Hacksaw'],
  'NLC': ['NoLimitCity'],
  'BNG': ['BNG', 'Booongo'],
  'REDTIGER': ['Red Tiger'],
  'KA GAMING': ['KAGaming', 'KA Gaming'],
  'NETENT': ['Netent', 'NetentExtended'],
  'KM': ['KingMidas', 'King Midas'],
  'BTG': ['BigTimeGaming'],
  'YGG': ['Yggdrasil'],
  'EVOPLAY': ['Evoplay'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

const gzone = JSON.parse(fs.readFileSync('/Users/yannicky/tma-projects/data/gzone/games.json', 'utf8'));

// 我方游戏：provider+归一名 → [{gpid, gid, name}]
const ours = new Map();
const lines = fs.readFileSync('./win568_games.tsv', 'utf8').split('\n').slice(1);
let ourCount = 0;
for (const line of lines) {
  if (!line.trim()) continue;
  const [gpid, gid, provider, ...rest] = line.split('\t');
  const nameEn = rest.join('\t');
  if (!provider || provider === 'NULL' || !nameEn || nameEn === 'NULL') continue;
  const key = `${provider}||${norm(nameEn)}`;
  if (!ours.has(key)) ours.set(key, []);
  ours.get(key).push({ gpid: Number(gpid), gid: Number(gid), provider, nameEn });
  ourCount++;
}

const matches = [];
const stats = {};
for (const g of gzone) {
  const providers = PROVIDER_MAP[g.platformName];
  if (!providers) continue;
  stats[g.platformName] ||= { total: 0, hit: 0 };
  stats[g.platformName].total++;
  for (const p of providers) {
    const found = ours.get(`${p}||${norm(g.name)}`);
    if (found) {
      stats[g.platformName].hit++;
      for (const f of found) {
        matches.push({
          gpid: f.gpid, gid: f.gid, ourProvider: f.provider, ourName: f.nameEn,
          gzoneName: g.name, gzonePlatform: g.platformName, localImage: g.localImage,
        });
      }
      break;
    }
  }
}

fs.writeFileSync('./cover_matches.json', JSON.stringify(matches, null, 2));
console.log(`gzone 参与匹配: ${Object.values(stats).reduce((a, s) => a + s.total, 0)}, 命中 gzone 游戏数: ${Object.values(stats).reduce((a, s) => a + s.hit, 0)}, 覆盖我方游戏行数: ${matches.length}`);
console.log('分厂商命中率:');
for (const [k, v] of Object.entries(stats).sort((a, b) => b[1].hit - a[1].hit)) {
  console.log(`  ${k}: ${v.hit}/${v.total}`);
}
