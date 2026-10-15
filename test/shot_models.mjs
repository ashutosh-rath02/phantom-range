import { chromium } from 'playwright';
const b = await chromium.launch({ args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport:{width:1600,height:900} });
p.on('console', m => { if (['error','warning'].includes(m.type())) console.log('console:', m.text()); });
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto('http://localhost:8080/test/models.html'); await p.waitForFunction(()=>window.ready, null, {timeout:30000});
for (const v of process.argv.slice(2)) { await p.evaluate(v=>window.render(v), v); await p.screenshot({ path: `out/models_${v}.png` }); console.log('saved', v); }
await b.close();
