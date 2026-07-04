// ptgaming 动画封面：下载 images_detail 帧序列 → sips 缩到 232×235 → img2webp 合成动图 WebP
// 102 款 is_animation=1，帧数 7-30（主流 20 帧），原始 310×314（个别帧 290×290，缩放统一修正）
// 卡片显示宽 ~127px，232 已是 1.8x 密度；q60+缩放后单图约 150-300KB（310 q70 时平均 403KB 过重）
// 产出：data/ptgaming/anim_frames/<id>/*.png（原帧,gitignore） + data/ptgaming/anim_covers/<basename>.webp
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const OUT = './data/ptgaming';
const FRAMES_DIR = path.join(OUT, 'anim_frames');
const COVERS_DIR = path.join(OUT, 'anim_covers');
fs.mkdirSync(FRAMES_DIR, { recursive: true });
fs.mkdirSync(COVERS_DIR, { recursive: true });

const PROVIDER = {
  1: 'JILI', 2: 'PGSoft', 3: 'Evolution', 4: 'RTG', 5: 'FaChai', 6: 'Galaxsys',
  7: 'APGaming', 8: 'BetConstruct', 9: 'SAGaming', 10: 'PragmaticPlay', 11: 'JDB',
  12: 'SparkGame', 13: 'PlayTime', 14: 'SABA', 15: 'YellowBat', 16: 'PlayStar',
  17: 'CQ9', 18: 'PlayTech', 19: 'YGR', 20: 'KM', 21: 'BNG', 22: '5G', 23: 'Jumbo', 24: 'Sneaky',
};
const sanitize = (s) => (s || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
const cleanName = (s) => (s || '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();

const raw = JSON.parse(fs.readFileSync(path.join(OUT, 'raw_full.json'), 'utf8'));
const anim = raw.data.list.filter((g) => g.is_animation === 1 && g.status === 1 && Array.isArray(g.images_detail) && g.images_detail.length > 1);
console.log(`动画卡: ${anim.length} 款, 总帧数: ${anim.reduce((a, g) => a + g.images_detail.length, 0)}`);

const HDRS = { 'Referer': 'https://www.ptgaming.ph/', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' };
async function dl(url, dest, attempt = 1) {
  if (fs.existsSync(dest)) return true;
  try {
    const res = await fetch(url, { headers: HDRS, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error('too small');
    fs.writeFileSync(dest, buf);
    return true;
  } catch (e) {
    if (attempt < 3) return dl(url, dest, attempt + 1);
    console.error(`下载失败: ${url} — ${e.message || e}`);
    return false;
  }
}

// 帧序号取 URL 尾部 _N.png，保证顺序正确
const jobs = [];
for (const g of anim) {
  const dir = path.join(FRAMES_DIR, String(g.id));
  fs.mkdirSync(dir, { recursive: true });
  for (const url of g.images_detail) {
    const m = new URL(url).pathname.match(/_(\d+)\.(\w+)$/);
    const idx = m ? Number(m[1]) : g.images_detail.indexOf(url);
    jobs.push({ url, dest: path.join(dir, `${String(idx).padStart(3, '0')}.png`) });
  }
}
let done = 0, failCount = 0;
let idx = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (idx < jobs.length) {
    const j = jobs[idx++];
    if (!(await dl(j.url, j.dest))) failCount++;
    if (++done % 300 === 0) console.log(`帧下载: ${done}/${jobs.length}`);
  }
}));
console.log(`帧下载完成: ${done - failCount}/${jobs.length}`);

// 缩放帧 → 合成动图 webp：lossy q60，帧间隔 100ms 无限循环
const RS_DIR = path.join(OUT, 'anim_frames_rs');
let built = 0, skipped = 0;
for (const g of anim) {
  const name = cleanName(g.name);
  const provider = PROVIDER[g.company_id] || `id${g.company_id}`;
  const out = path.join(COVERS_DIR, `${sanitize(provider)}__${sanitize(name)}__${g.id}.webp`);
  if (fs.existsSync(out)) { built++; continue; }
  const dir = path.join(FRAMES_DIR, String(g.id));
  const frames = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  if (frames.length !== g.images_detail.length) { console.error(`帧不全跳过: ${g.id} ${name} (${frames.length}/${g.images_detail.length})`); skipped++; continue; }
  const rsDir = path.join(RS_DIR, String(g.id));
  fs.mkdirSync(rsDir, { recursive: true });
  try {
    execFileSync('sips', ['-z', '235', '232', ...frames.map((f) => path.join(dir, f)), '--out', rsDir], { stdio: 'pipe' });
    execFileSync('img2webp', ['-loop', '0', '-lossy', '-q', '60', '-d', '100', ...frames.map((f) => path.join(rsDir, f)), '-o', out], { stdio: 'pipe' });
    built++;
  } catch (e) {
    console.error(`合成失败: ${g.id} ${name} — ${String(e.stderr || e.message).slice(0, 200)}`);
    skipped++;
  }
}
const sizes = fs.readdirSync(COVERS_DIR).map((f) => fs.statSync(path.join(COVERS_DIR, f)).size);
const kb = (n) => Math.round(n / 1024);
console.log(`合成完成: ${built} 成功, ${skipped} 跳过; 体积 min ${kb(Math.min(...sizes))}KB / avg ${kb(sizes.reduce((a, b) => a + b, 0) / sizes.length)}KB / max ${kb(Math.max(...sizes))}KB`);
