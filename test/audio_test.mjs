import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch(); const p = await b.newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://localhost:8080/test/audio.html'); await p.waitForFunction(() => window.ready);
const r = await p.evaluate(() => window.run());
console.log('render ms', r.ms.toFixed(0));
for (const [k, v] of Object.entries(r.stats)) console.log(k.padEnd(10), JSON.stringify(v));
// write mono 24kHz wav
const data = Int16Array.from(r.wav); const sr = 24000;
const buf = Buffer.alloc(44 + data.length * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + data.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(data.length * 2, 40);
for (let i = 0; i < data.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, data[i])), 44 + i * 2);
fs.writeFileSync('out/shots.wav', buf);
await b.close();
