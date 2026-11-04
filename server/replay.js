// Replay Stagify's lighting cues to real lights: node server/replay.js examples/snowboarding/stage_cues.csv
// Sends each 0.1 s frame of the 6 fixtures through server/lights.js at the time it was recorded; set LIGHTS_OUTPUT
// (artnet or hue) and its settings as for the dev server. With the default (sim) it only prints what it would send.
import { readFileSync } from 'node:fs';
import { mode, output } from './lights.js';

const [, , file] = process.argv;
if (!file) { console.error('usage: node server/replay.js <run>/stage_cues.csv'); process.exit(1); }
const frames = new Map();                                   // time -> fixtures in order
for (const line of readFileSync(file, 'utf8').trim().split('\n').slice(1)) {
  const [t, i, , r, g, b, level] = line.split(',');
  if (!frames.has(t)) frames.set(t, []);
  frames.get(t)[Number(i) - 1] = { r: +r, g: +g, b: +b, level: +level };
}
const times = [...frames.keys()].map(Number);
const t0 = Date.now() - times[0] * 1000;
console.log(`${times.length} frames, ${(times.at(-1) - times[0]).toFixed(1)} s, to ${mode}`);
for (const t of times) {
  const delay = t0 + t * 1000 - Date.now();
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  output(frames.get(t.toFixed(2)) ?? frames.get(String(t)));
  if (mode === 'sim' && Math.round(t * 10) % 10 === 0) console.log(t.toFixed(1), frames.get(t.toFixed(2))?.map((f) => f.level.toFixed(2)).join(' '));
}
process.exit(0);
