// node bench/test_stage.mjs — the stage mode's pure parts: rhythm from movement, Art-Net packets, Hue colors.
import assert from 'node:assert/strict';
import { rhythmBpm } from '../src/session.js';
import { artnetPacket, hueState } from '../server/lights.js';

const fps = 30;
const wave = (hz, s = 8) => Float32Array.from({ length: s * fps }, (_, i) => 1 + Math.sin((2 * Math.PI * hz * i) / fps));
const r = rhythmBpm(wave(2));                          // a limb moving twice a second
assert.ok(Math.abs(r.bpm - 120) < 4 && r.strength > 0.8, `120 BPM expected, got ${JSON.stringify(r)}`);
assert.ok(Math.abs(rhythmBpm(wave(1.5)).bpm - 90) < 4);
assert.equal(rhythmBpm(new Float32Array(8 * fps).fill(0.3)), null);   // standing still: no rhythm
assert.equal(rhythmBpm(wave(2, 2)), null);                           // under 4 s: too short to tell
assert.equal(rhythmBpm(wave(0.3)), null);                           // slow drift, no beat: no peak in 60-180 BPM

const p = artnetPacket([255, 10, 20, 30, 7], 3, 9);
assert.equal(p.subarray(0, 8).toString('latin1'), 'Art-Net\0');
assert.deepEqual([...p.subarray(8, 18)], [0x00, 0x50, 0, 14, 9, 0, 3, 0, 0, 6]);    // OpDmx, v14, seq, universe 3, length 6
assert.deepEqual([...p.subarray(18)], [255, 10, 20, 30, 7, 0]);

const red = hueState({ r: 255, g: 0, b: 0, level: 1 });
assert.deepEqual([red.on, red.bri, red.hue, red.sat], [true, 254, 0, 254]);
assert.equal(hueState({ r: 0, g: 0, b: 255, level: 0 }).on, false);
console.log('stage tests passed');
