import { chromium } from 'playwright';
import fs from 'fs';

const OUT = process.argv[2] || './gzone_capture';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 414, height: 896 },
});

const captured = [];
page.on('response', async (res) => {
  const url = res.url();
  if (/gpgame|gameBaseAll|block_game|productPlatformConfig|provider/i.test(url)) {
    try {
      const body = await res.text();
      const name = url.split('/').pop().split('?')[0].slice(0, 120);
      fs.writeFileSync(`${OUT}/${name}`, body);
      captured.push({ url, size: body.length, file: name });
    } catch (e) { captured.push({ url, err: String(e) }); }
  }
});

await page.goto('https://gzone.ph/all', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(15000);

fs.writeFileSync(`${OUT}/_captured.json`, JSON.stringify(captured, null, 2));
console.log(JSON.stringify(captured, null, 2));
await browser.close();
