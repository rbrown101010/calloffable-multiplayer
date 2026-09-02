// usage: node tools/play.mjs <url> <outDir> "<script>"
// script commands separated by ';' : wait:ms | shot:name | click:selector | key:Code | down:Code | up:Code | mouse:dx:dy[:steps] | mdown:btn | mup:btn | eval:js | waitfor:selector | text:selector
import { chromium } from 'playwright';
import fs from 'fs';
const [url, outDir, script = ''] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || /\[game\]/.test(t)) logs.push(`[${m.type()}] ${t.slice(0, 400)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
let mx = 800, my = 450; await page.mouse.move(mx, my);
for (const raw of script.split('§')) {
  const cmd = raw.trim(); if (!cmd) continue; const [op, ...args] = cmd.split(':'); const a = args.join(':');
  try {
    if (op === 'wait') await page.waitForTimeout(+a);
    else if (op === 'shot') { await page.screenshot({ path: `${outDir}/${a}.png` }); console.log('shot', a); }
    else if (op === 'click') await page.click(a, { timeout: 5000 });
    else if (op === 'key') await page.keyboard.press(a);
    else if (op === 'down') await page.keyboard.down(a);
    else if (op === 'up') await page.keyboard.up(a);
    else if (op === 'mouse') { const [dx, dy, steps = '10'] = args; const tx = mx + +dx, ty = my + +dy; await page.mouse.move(tx, ty, { steps: +steps }); mx = tx; my = ty; if (mx < 50 || mx > 1550 || my < 50 || my > 850) { /* recenter silently without delta: not possible; keep */ } }
    else if (op === 'mdown') await page.mouse.down({ button: a === '2' ? 'right' : 'left' });
    else if (op === 'mup') await page.mouse.up({ button: a === '2' ? 'right' : 'left' });
    else if (op === 'eval') { const r = await page.evaluate(a); console.log('eval =>', JSON.stringify(r)?.slice(0, 6000)); }
    else if (op === 'waitfor') await page.waitForSelector(a, { timeout: 90000, state: 'visible' });
    else if (op === 'text') console.log('text =>', (await page.textContent(a))?.trim().slice(0, 300));
  } catch (e) { console.log('ERR', cmd, e.message.slice(0, 200)); }
}
console.log('--- console ---'); console.log(logs.slice(0, 40).join('\n'));
await browser.close();
