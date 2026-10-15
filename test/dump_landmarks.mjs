import { chromium } from 'playwright';
import fs from 'node:fs';
const names = fs.readdirSync('img').filter(f=>f.endsWith('.png')).map(f=>f.replace('.png',''));
const items = [];
for (const n of names) { items.push({name:n, src:`/test/img/${n}.png`}); }
for (const n of ['thumb_index','one','gun','point','fist','palm','like']) { items.push({name:n+'_ccw', src:`/test/img/${n}.png`, rot:-90}); items.push({name:n+'_cw', src:`/test/img/${n}.png`, rot:90}); }
const browser = await chromium.launch({ args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('console', m => { if (m.type()==='error') console.log('console:', m.text()); });
await page.goto('http://localhost:8080/test/landmarks.html'); await page.waitForFunction(()=>window.ready);
const out = await page.evaluate(items => window.run(items), items);
fs.writeFileSync('landmarks.json', JSON.stringify(out));
for (const [k,v] of Object.entries(out)) console.log(k.padEnd(18), v.hands.length, v.hands.map(h=>h.hd+':'+h.sc.toFixed(2)).join(' '));
await browser.close();
