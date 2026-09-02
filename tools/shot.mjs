// usage: node tools/shot.mjs <url> <out.png> [waitMs] [width] [height]
import { chromium } from 'playwright';
const [url, out, waitMs = '4000', w = '1600', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+waitMs);
await page.screenshot({ path: out });
const info = await page.evaluate(() => document.getElementById('info')?.textContent || '');
if (info) console.log(info);
await browser.close();
