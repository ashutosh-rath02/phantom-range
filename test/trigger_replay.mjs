// Replays thumb signals recorded from a live webcam session through the trigger and scores the shots
// against the on-screen FIRE cues the player was answering. Recorded at 6 to 10 tracking frames per
// second, where the old fixed cocked level left the trigger stuck down for seconds at a time.
import fs from 'node:fs';
import { ThumbTrigger } from '../src/hands.js';
import { GESTURE } from '../src/config.js';

function load(name) {
  const text = fs.readFileSync(new URL(`./data/${name}`, import.meta.url), 'utf8');
  const cues = (text.match(/^# cues (.*)$/m)?.[1] || '').split(/\s+/).map(Number);
  const rows = text
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('t,'))
    .map((l) => {
      const [t, s, pose, raw, fy] = l.split(',');
      return { t: +t / 1000, s: s === '' ? null : +s, pose, raw, fy: fy === '' ? 0 : +fy };
    });
  return { cues: cues.map((c) => c / 1000), rows };
}

export function replay({ rows }) {
  const tr = new ThumbTrigger();
  const fires = [];
  let inGun = false,
    gap = 0.1,
    lastT = null;
  for (const r of rows) {
    if (lastT != null) gap += (Math.min(1, r.t - lastT) - gap) * 0.2;
    lastT = r.t;
    if (r.s == null) continue;
    const gun = r.pose === 'g';
    if (gun && !inGun) tr.begin(r.s, r.t);
    inGun = gun;
    if (!gun) continue;
    const active = (r.raw === 'g' || r.raw === 'n') && r.fy > GESTURE.pointUpY;
    if (!active) {
      tr.cancel(r.s, r.t);
      continue;
    }
    const ev = tr.update(r.s, r.t, gap);
    if (ev === 'fire' || ev === 'refire') fires.push(r.t);
  }
  return fires;
}

// A cue counts as answered by the first shot from 0.5 s before it (the cues came on a steady beat, so players anticipate) to 1.5 s after.
export function score({ cues }, fires) {
  const hits = cues.map((c) => fires.find((f) => f >= c - 0.5 && f <= c + 1.5) ?? null);
  return { hits, answered: hits.filter((h) => h != null).length };
}

// Clear snaps in the recording, found from the signal alone: a drop of at least 0.3 within 0.35 s that
// ends near or below the fired level, while the hand reads as a finger gun.
export function clearSnaps({ rows }) {
  const out = [];
  const g = rows.filter((r) => r.s != null && r.pose === 'g' && (r.raw === 'g' || r.raw === 'n'));
  for (let i = 0; i < g.length; i++) {
    const r = g[i];
    if (r.s > 0.05) continue;
    const before = g.slice(0, i).filter((q) => r.t - q.t <= 0.35);
    if (before.length && Math.max(...before.map((q) => q.s)) - r.s >= 0.3 && !out.some((t) => r.t - t < 0.3)) out.push(r.t);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rec = load('live_session1.csv');
  const fires = replay(rec);
  const { hits, answered } = score(rec, fires);
  console.log('shots', fires.map((f) => f.toFixed(2)).join(' '));
  rec.cues.forEach((c, i) => console.log(`  cue ${c.toFixed(2)}  ${hits[i] == null ? 'missed' : `shot ${hits[i] >= c ? '+' : ''}${(hits[i] - c).toFixed(2)} s`}`));
  const snaps = clearSnaps(rec);
  const missed = snaps.filter((t) => !fires.some((f) => f >= t - 0.12 && f <= t + 0.25));
  // steady stretches where the player was holding the gun cocked and aiming, not firing
  const steady = [[2.6, 4.9], [15.1, 16.85], [17.3, 19.4]];
  const stray = fires.filter((f) => steady.some(([a, b]) => f >= a && f <= b));
  let fails = 0;
  const check = (ok, msg) => {
    console.log(`${ok ? '  ' : 'XX'} ${msg}`);
    if (!ok) fails++;
  };
  // Cue 4 came while the hand did not read as a finger gun at all (pointing at the camera).
  check(answered >= 6, `live session 1: ${answered} of ${rec.cues.length} cues answered`);
  check(missed.length === 0, `clear thumb snaps fired: ${snaps.length - missed.length} of ${snaps.length}${missed.length ? ` (missed at ${missed.map((t) => t.toFixed(2)).join(' ')})` : ''}`);
  check(stray.length === 0, `no shots while holding steady${stray.length ? ` (shots at ${stray.map((t) => t.toFixed(2)).join(' ')})` : ''}`);
  console.log('fails', fails);
  process.exitCode = fails ? 1 : 0;
}
