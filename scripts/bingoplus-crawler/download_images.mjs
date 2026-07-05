// 批量下载 bingoplus 游戏卡片图（540 方图）。防盗链需带 Referer。
// 并发受限 + 重试；文件名 = <platformCode>__<gameId>__<原文件名>，避免碰撞。
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.argv[2] || '../../data/bingoplus');
const IMG_DIR = path.join(ROOT, 'images');
const HOST = 'https://www.bingoplus.com';
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CONCURRENCY = 12;

fs.mkdirSync(IMG_DIR, { recursive: true });
const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'games.json'), 'utf8'));

// 去重：同一图片只下一次；文件名带 platformCode+gameId 保唯一
const tasks = [];
const seenFile = new Set();
for (const g of games) {
  if (!g.image) continue;
  const base = g.image.split('/').pop().split('?')[0];
  let fname = `${g.platformCode || 'NA'}__${g.gameId}__${base}`.replace(/[^\w.\-]/g, '_');
  while (seenFile.has(fname)) fname = '_' + fname;
  seenFile.add(fname);
  tasks.push({ url: g.image.startsWith('http') ? g.image : HOST + g.image, file: path.join(IMG_DIR, fname) });
}

let ok = 0, skip = 0, fail = 0;
const failed = [];
async function dl(t) {
  if (fs.existsSync(t.file) && fs.statSync(t.file).size > 0) { skip++; return; }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(t.url, { headers: { 'User-Agent': UA, Referer: HOST + '/' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('empty');
      fs.writeFileSync(t.file, buf);
      ok++;
      return;
    } catch (e) {
      if (attempt === 2) { fail++; failed.push({ url: t.url, err: String(e) }); }
      else await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

let idx = 0;
async function worker() {
  while (idx < tasks.length) {
    const t = tasks[idx++];
    await dl(t);
    if ((ok + skip + fail) % 200 === 0) console.log(`progress ${ok + skip + fail}/${tasks.length} ok=${ok} skip=${skip} fail=${fail}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (failed.length) fs.writeFileSync(path.join(ROOT, 'download_failed.json'), JSON.stringify(failed, null, 2));
console.log(`DONE total=${tasks.length} ok=${ok} skip=${skip} fail=${fail}`);
