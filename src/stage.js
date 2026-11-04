// LifeLens stage performance mode: lights, cues, sound effects and the full-screen Show view.
// Hybrid: every frame, rules on the 3D body (each light follows its body part; hand height and arm spread open the arm
// lights, a jump lifts every light, a crouch dims them, turning shifts the colour, a sudden arm move strobes). Every
// ~8 s Meta Muse Spark, as lighting designer, gets the body's numbers and the song and picks the scene: palette,
// beat pattern, focus, strobe, intensity, with a reason (/api/stage/scene). The fixtures go to real lights through
// /api/lights (simulator unless LIGHTS_OUTPUT is set, server/lights.js). main.js calls updateStage() every frame.

import { session } from './session.js';

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const FPS = 30;
const SCENE_EVERY_MS = 10000;    // after the last answer; Muse takes ~10-20 s per scene
const LIGHTS_EVERY_MS = 200;

// Each light's own body part, as 0-1 at full: elbow/knee bending speed (deg/s), trunk lean + turning, walking pace.
export const FIXTURES = [
  { name: 'Left arm', group: 'arms', read: (n) => n.armL / 90 },
  { name: 'Right arm', group: 'arms', read: (n) => n.armR / 90 },
  { name: 'Left leg', group: 'legs', read: (n) => n.legL / 120 },
  { name: 'Right leg', group: 'legs', read: (n) => n.legR / 120 },
  { name: 'Torso', group: 'torso', read: (n) => n.trunk / 45 + Math.abs(n.turn) / 360 },
  { name: 'Pace', group: 'torso', read: (n) => n.speed / 1.2 },
];

// Colours per body part. With Muse's palette: arms, legs and torso take its 1st, 2nd and 3rd colour, left and right
// 14 degrees apart. Without one (rules only): one hue family per part around the director's colour.
const PART = [0, 0, 1, 1, 2, 2];
const PART_HUE = [-18, 18, 110, 150, 230, 265];
// A 2-colour palette gives the torso and pace a contrasting third colour (150 degrees from the first).
const colorFor = (i, palette) => (palette.length >= 2
  ? shiftHue(PART[i] < palette.length ? palette[PART[i]] : shiftHue(palette[0], 150), i % 2 ? 14 : -14)
  : shiftHue(palette[0], PART_HUE[i]));

export const stage = {
  scene: null,            // Muse's last scene {name, palette, pattern, focus, strobe_on_hits, intensity, reason}
  asking: false, askedAt: 0, sceneNote: 'Rules only until Muse Spark designs the first scene.',
  fixtures: FIXTURES.map(() => ({ level: 0, color: '#3977FF' })),
  spot: { x: 0.5, y: 0.5, level: 0 },
  cues: [],               // [{t, text}] newest last
  flashUntil: 0, last: {}, fx: false, open: false, lightsOut: null, sentAt: 0, beats: 0, energy: 0,
  plan: null,             // Stagify's plan {segment_s, scenes[], music[]}: its scene for the time, instead of live ones
  recDest: null,
};

export function setPlan(plan) { stage.plan = plan; }
const planScene = (t) => (stage.plan ? stage.plan.scenes[Math.min(stage.plan.scenes.length - 1, Math.floor(t / stage.plan.segment_s))] : null);
export function recordFx() { return null; }

// ---------- Colour ----------

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function shiftHue(hex, deg) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d || !deg) return hex;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + deg + 720) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// ---------- Cues: moments the rules see (silent — no synthesized boom/thump SFX) ----------

function cue(t, text) {
  stage.cues.push({ t, text });
  if (stage.cues.length > 30) stage.cues.shift();
  renderCues();
}

const edge = (key, on, now, gap) => {           // true once when `on` starts, then not again for `gap` ms
  const was = stage.last[key];
  stage.last[key] = on ? (was ?? now) : null;
  if (!on || was) return false;
  if (now - (stage.last[`${key}At`] ?? -1e9) < gap) return false;
  stage.last[`${key}At`] = now;
  return true;
};

// ---------- Every frame ----------

// f: bodyFeatures(); ctx: { t, master (director brightness 0-1), color (director), live, songBpm, songBeats }.
export function updateStage(f, ctx) {
  const n = f.now;
  const now = performance.now();
  stage.t = ctx.t;
  if (ctx.live) {
    if (edge('hit', n.hit > 0.45, now, 350)) {
      cue(ctx.t, `Hit · ${n.hitLimb === 0 ? 'left' : 'right'} arm`, 'hit', n.hit);
      if (stage.scene?.strobe_on_hits ?? true) stage.flashUntil = now + 110;
    }
    if (edge('jump', n.lift > 0.06, now, 1000)) cue(ctx.t, 'Jump', 'jump', 1);
    if (edge('crouch', n.lift < -0.15, now, 1500)) cue(ctx.t, 'Crouch: lights down');
    if (edge('turn', Math.abs(n.turn) > 120, now, 1500)) cue(ctx.t, `Turn ${n.turn > 0 ? 'left' : 'right'}`, 'turn', 0.8);
    if (edge('up', n.up > 0.95, now, 2000)) cue(ctx.t, 'Arms up: arm lights open');
  }
  // The beat: the playing song's (its measured BPM), else the body's own rhythm.
  const bpm = ctx.songBpm || (f.rhythm?.strength > 0.3 ? f.rhythm.bpm : 0);
  const dt = Math.min(0.1, (now - (stage.frameAt ?? now)) / 1000);
  stage.frameAt = now;
  if (ctx.songBeats != null) stage.beats = ctx.songBeats;
  else if (bpm && ctx.live) stage.beats += (bpm / 60) * dt;
  const frac = stage.beats % 1;
  const scene = planScene(ctx.t) ?? stage.scene;
  if (stage.plan && scene !== stage.last.planned) {          // a planned scene starts: show it and log it
    stage.last.planned = scene;
    if (ctx.live) cue(ctx.t, `Scene: ${scene.name} (${scene.pattern})`);
    renderScene();
  }
  const pattern = scene?.pattern ?? (bpm ? 'pulse' : 'still');
  const palette = scene?.palette ?? [ctx.color];
  const crouch = n.lift < -0.12 ? Math.max(0.2, 1 + (n.lift + 0.12) / 0.25) : 1;
  const jump = clamp01(n.lift / 0.06);
  const pose = { arms: 0.6 * clamp01((n.up - 0.6) / 0.5) + 0.4 * clamp01((n.spread - 0.5) / 0.9), legs: jump, torso: 0 };
  const master = ctx.master * (scene?.intensity ?? 1) * crouch;
  const hue = Math.max(-1, Math.min(1, n.turn / 180)) * 40;       // turning shifts the colour, up to 40 degrees
  const flash = now < stage.flashUntil;
  stage.energy = clamp01(0.5 * n.speed / 1.2 + 0.3 * n.hit + 0.2 * jump + 0.2 * pose.arms);
  stage.fixtures = FIXTURES.map((fx, i) => {
    if (flash) return { level: 1, color: '#FFFFFF', own: 1 };
    const own = clamp01(fx.read(n));
    const focus = scene && scene.focus !== 'all' && scene.focus !== fx.group ? 0.55 : 1;
    const beat = pattern === 'pulse' ? 0.6 + 0.4 * (1 - frac) ** 3
      : pattern === 'chase' ? (Math.floor(stage.beats) % FIXTURES.length === i ? 1 : 0.3)
        : pattern === 'strobe' ? 0.75 : 1;
    const level = master * (0.12 + 0.88 * clamp01(own + pose[fx.group])) * focus * beat;
    return { level, color: shiftHue(colorFor(i, palette), hue), own };
  });
  stage.spot = { x: n.x, y: n.y, level: master, spread: clamp01((n.spread - 0.5) / 0.9) };
  if (stage.open && now - (stage.hudAt ?? 0) > 400) {
    stage.hudAt = now;
    $('show-tempo').textContent = `${ctx.songBpm ? `${ctx.songBpm} BPM · song` : bpm ? `body rhythm ${Math.round(bpm)}/min` : 'No beat'}`
      + `${ctx.mood ? ` · ${ctx.mood}` : ''} · ${ctx.t ? clock(ctx.t) : ''}`;
  }
  if (ctx.live) {
    if (now - stage.sentAt > LIGHTS_EVERY_MS) sendLights(now);
    // Muse designs from at least 6 s of the body, on any tab, so a scene is ready when Stage or the Show view opens
    if (!stage.plan && !stage.asking && ctx.t >= 6 && now - stage.askedAt > SCENE_EVERY_MS) askScene(f, ctx);
  }
  return stage;
}

// ---------- Real lights (dev server) ----------

function sendLights(now) {
  stage.sentAt = now;
  const fixtures = stage.fixtures.map(({ level, color }) => { const [r, g, b] = rgbOf(color); return { r, g, b, level }; });
  fetch('/api/lights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fixtures }) })
    .then((r) => r.json()).then((s) => { stage.lightsOut = s; renderOut(); }).catch(() => {});
}

// ---------- Muse Spark as lighting designer ----------

function facts(f, ctx) {
  const q = session.kin;
  const j1 = Math.min(Math.round(ctx.t * FPS), (q?.n ?? 1) - 1), j0 = Math.max(0, j1 - 8 * FPS);
  const avg = (a, fn = (v) => v) => { let s = 0; for (let k = j0; k <= j1; k++) s += fn(a[k]); return s / Math.max(1, j1 - j0 + 1); };
  const recent = stage.cues.filter((c) => c.t > ctx.t - 30);
  const count = (w) => recent.filter((c) => c.text.startsWith(w)).length;
  return [
    `Pace ${f.pace.toFixed(2)} m/s, still ${Math.round(f.still * 100)}% of the time, trunk lean ${Math.round(f.lean)} deg.`,
    f.rhythm?.strength > 0.3 ? `Body rhythm ${Math.round(f.rhythm.bpm)}/min, how often the limbs' speed pattern repeats (strength ${f.rhythm.strength.toFixed(2)}).` : 'No steady body rhythm.',
    q ? `Hands above the shoulders ${Math.round(100 * avg(q.up, (v) => (v > 0.8 ? 1 : 0)))}% of the time; arm spread ${avg(q.spread).toFixed(2)} m on average.` : '',
    q ? `Turning ${Math.round(Math.abs(q.yaw[j1] - q.yaw[j0]) / 8)} deg/s on average.` : '',
    `In the last 30 s: ${count('Hit')} sudden arm moves, ${count('Jump')} jumps, ${count('Crouch')} crouches, ${count('Turn')} fast turns.`,
    ctx.mood ? `Mood (Muse Spark, from the captions): ${ctx.mood}.` : '',
    ctx.song ? `Song playing: "${ctx.song.name}" by ${ctx.song.artist}, ${ctx.song.tempo ?? '?'} BPM.` : 'No song playing yet.',
    stage.scene ? `Current scene: ${stage.scene.name} (${stage.scene.pattern}). Change it only if the numbers call for it.` : '',
  ].filter(Boolean).join('\n');
}

// The 3D body now, as a 320 px JPEG, so Muse sees the pose and not only its numbers.
function bodyFrame() {
  const v = bodySource();
  if (!v || v.readyState < 2 || !v.videoWidth) return null;
  const c = Object.assign(document.createElement('canvas'), { width: 320, height: Math.round((320 * v.videoHeight) / v.videoWidth) });
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

async function askScene(f, ctx) {
  stage.asking = true;
  stage.askedAt = performance.now();
  renderScene();
  try {
    const res = await fetch('/api/stage/scene', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facts: facts(f, ctx), image: bodyFrame() }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `the dev server answered ${res.status}`);
    const changed = body.name !== stage.scene?.name;
    stage.scene = body;
    if (changed) cue(stage.t, `Scene: ${body.name} (${body.pattern})`);        // when it arrived, not when asked
    renderScene();
  } catch (err) {
    renderScene(stage.scene ? undefined : `No scene yet: ${err.message}.`);   // keep a scene that is showing
  } finally {
    stage.asking = false;
    stage.askedAt = performance.now();
  }
}

// ---------- Stage tab text ----------

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function renderScene(note) {
  const s = (stage.plan && stage.last.planned) || stage.scene;
  const text = note ?? (s ? `${s.name} · ${s.pattern}${s.focus !== 'all' ? `, ${s.focus}` : ''}. ${s.reason}`
    : stage.asking ? 'Muse Spark is designing the first scene…' : stage.sceneNote);
  for (const id of ['stage-scene', 'show-scene']) if ($(id)) $(id).textContent = text;
  const sw = $('show-palette');
  if (sw) sw.replaceChildren(...(s?.palette ?? []).map((c) => Object.assign(document.createElement('span'), { style: `background:${c}` })));
}

function renderCues() {
  const list = $('show-cues');
  if (!list) return;
  list.replaceChildren(...stage.cues.slice(-7).map((c) => {
    const li = document.createElement('li');
    li.append(Object.assign(document.createElement('time'), { textContent: clock(c.t) }), ` ${c.text}`);
    return li;
  }));
}

function renderOut() {
  const s = stage.lightsOut;
  const box = $('show-out');
  if (!s || !box) return;
  box.querySelector('.show-out-mode').textContent = s.mode === 'sim' ? 'Lights out: simulator (no hardware set)'
    : `Lights out: ${s.mode === 'hue' ? 'Philips Hue' : 'Art-Net DMX'}${s.error ? ` · ${s.error}` : ''}`;
  box.querySelector('.show-out-strip').replaceChildren(...s.fixtures.map((x) => Object.assign(document.createElement('span'),
    { style: `background: rgb(${x.r} ${x.g} ${x.b} / ${0.15 + 0.85 * x.level})` })));
  const stageOut = $('stage-out');
  if (stageOut) stageOut.textContent = box.querySelector('.show-out-mode').textContent;
}

// ---------- Show view: a full-screen virtual stage ----------

const canvas = $('show-canvas');
const g = canvas?.getContext('2d');
const particles = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), v: 0.2 + Math.random(), c: Math.random() }));
const videoOf = (pane) => document.querySelector(`#media [data-pane="${pane}"] video`);

// The performer: the 3D body cut out of its render (mesh_exo: a light-blue body on a white background and a grey
// floor), so the real mesh moves on the virtual stage. Bluish, saturated pixels stay. The key runs on a crop around the
// body at the video's own resolution (found on a small full frame first), so the avatar stays sharp when scaled up.
const key = document.createElement('canvas');
const kg = key.getContext('2d', { willReadFrequently: true });
function keyRegion(v, sx, sy, sw, sh, scale) {
  key.width = Math.max(1, Math.round(sw * scale));
  key.height = Math.max(1, Math.round(sh * scale));
  kg.drawImage(v, sx, sy, sw, sh, 0, 0, key.width, key.height);
  const img = kg.getImageData(0, 0, key.width, key.height);
  const d = img.data;
  let x0 = key.width, y0 = key.height, x1 = -1, y1 = -1;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gr = d[i + 1], b = d[i + 2], max = Math.max(r, gr, b);
    const sat = max ? (max - Math.min(r, gr, b)) / max : 0;
    // the body's lit side is only ~0.17 saturated; the white background and grey floor are ~0-0.02
    const a = b - r > 20 ? Math.max(0, Math.min(255, (sat - 0.07) * 3000)) : 0;
    d[i + 3] = a;
    if (a > 160) {
      const p = i / 4, x = p % key.width, y = (p / key.width) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 - x0 < 6 || y1 - y0 < 12) return null;
  kg.putImageData(img, 0, 0);
  // the pelvis column: the middle of the body's pixels at hip height (45-62% down the box), so arms don't move it
  let hs = 0, hn = 0;
  for (let y = Math.round(y0 + 0.45 * (y1 - y0)); y <= Math.round(y0 + 0.62 * (y1 - y0)); y++) {
    for (let x = x0; x <= x1; x++) if (d[(y * key.width + x) * 4 + 3] > 160) { hs += x; hn += 1; }
  }
  // the body's box in video pixels, and in key-canvas pixels for drawing
  return { vx0: sx + x0 / scale, vy0: sy + y0 / scale, vx1: sx + x1 / scale, vy1: sy + y1 / scale, x0, y0, x1, y1,
    hip: hn ? hs / hn : (x0 + x1) / 2 };
}
// The original render (mesh_exo.mp4, ~2 Mbit/s) keys far cleaner than the page's compressed copy: a hidden copy of it
// follows the page's 3D body clock while the Show view is open.
const hq = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto' });
function bodySource() {
  const v = videoOf('body');
  const url = session.rec?.files?.['mesh_exo.mp4'];
  if (!url || !v) return v;
  if (hq.dataset.src !== url) { hq.dataset.src = url; hq.src = url; }
  if (hq.readyState >= 1 && Math.abs(hq.currentTime - v.currentTime) > 0.3) hq.currentTime = v.currentTime;
  if (v.paused && !hq.paused) hq.pause();
  if (!v.paused && hq.paused) hq.play().catch(() => {});
  return hq.readyState >= 2 ? hq : v;
}
export { key as bodyKey };      // the cut-out body, for the Gym viewer (gym.js) too
export function keyedBody(retry = true) {
  const v = bodySource();
  // no new frame yet (a seek or a busy decoder): keep the last cut-out rather than an empty stage
  if (!v || v.readyState < 2 || !v.videoWidth) { stage.keyStale = (stage.keyStale ?? 0) + 1; return stage.vbox && { ...stage.vbox, fresh: false }; }
  const frameKey = `${v.currentSrc || ''}:${Math.round((v.currentTime || 0) * 30)}`;
  if (retry && stage.keyFrame === frameKey && stage.vbox) {
    return { ...stage.vbox, fresh: false };
  }
  const W = v.videoWidth, H = v.videoHeight, b = stage.vbox;
  let found = null;
  if (b) {                                             // track: the last box, 40% bigger, capped to 260 px height for 60 fps
    const mw = (b.vx1 - b.vx0) * 0.4 + 12, mh = (b.vy1 - b.vy0) * 0.4 + 12;
    const sx = Math.max(0, b.vx0 - mw), sy = Math.max(0, b.vy0 - mh);
    const sw = Math.min(W, b.vx1 + mw) - sx, sh = Math.min(H, b.vy1 + mh) - sy;
    const scale = Math.min(1, 260 / Math.max(1, sh));
    found = keyRegion(v, sx, sy, sw, sh, scale);
  }
  if (!found && retry) {                               // lost (or first frame): find it on a small full frame, then key it
    const whole = keyRegion(v, 0, 0, W, H, 280 / W);
    if (whole) { stage.vbox = whole; return keyedBody(false); }
    stage.keyLost = (stage.keyLost ?? 0) + 1;
    return null;
  }
  if (found) {
    stage.vbox = found;
    stage.keyFrame = frameKey;
    stage.keyFresh = (stage.keyFresh ?? 0) + 1;
  }
  return found && { ...found, fresh: true };
}

function draw() {
  if (!stage.open) return;
  requestAnimationFrame(draw);
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== W || canvas.height !== H) Object.assign(canvas, { width: W, height: H });
  const pal = stage.scene?.palette ?? [stage.fixtures[0]?.color ?? '#3977FF'];
  const pulse = 0.6 + 0.4 * (1 - (stage.beats % 1)) ** 3;
  // backdrop: two washes in the palette, breathing with the beat and the energy
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#05060A';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  pal.slice(0, 2).forEach((c, i) => {
    const grad = g.createRadialGradient(W * (0.25 + 0.5 * i), H * 0.35, 0, W * (0.25 + 0.5 * i), H * 0.35, W * 0.55);
    const a = Math.round(255 * (0.08 + 0.22 * stage.energy) * pulse).toString(16).padStart(2, '0');
    grad.addColorStop(0, `${c}${a}`); grad.addColorStop(1, `${c}00`);
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
  });
  // particles drift up faster with energy; colours from the palette
  for (const p of particles) {
    p.y -= (0.0006 + 0.004 * stage.energy) * p.v;
    if (p.y < 0) { p.y = 1; p.x = Math.random(); }
    g.fillStyle = `${pal[Math.floor(p.c * pal.length)]}${Math.round(60 + 140 * stage.energy).toString(16).padStart(2, '0')}`;
    g.fillRect(p.x * W, p.y * H * 0.7, 2 * dpr, 2 * dpr);
  }
  // floor: a trapezoid; the performer stays on one spot centre stage, pelvis fixed (the limbs and the height move)
  const fy0 = H * 0.58, fy1 = H * 0.98, inset = W * 0.18;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#0E1018';
  g.beginPath(); g.moveTo(inset, fy0); g.lineTo(W - inset, fy0); g.lineTo(W, fy1); g.lineTo(0, fy1); g.closePath(); g.fill();
  const sx = W / 2, sy = fy0 + (fy1 - fy0) * 0.62;
  g.globalCompositeOperation = 'lighter';
  // beams: from 6 heads on the truss down to the performer, width from the arm spread, colour and level per fixture
  stage.fixtures.forEach((fx, i) => {
    const hx = W * (0.2 + (0.6 * i) / (stage.fixtures.length - 1)), hy = H * 0.07;
    const w = (36 + 50 * (fx.own ?? 0) + 70 * stage.spot.spread) * dpr;   // wider beams when the arms open
    const a = Math.round(255 * Math.min(0.9, 0.18 + 0.72 * fx.level)).toString(16).padStart(2, '0');
    const grad = g.createLinearGradient(hx, hy, sx, sy);
    grad.addColorStop(0, `${fx.color}${a}`); grad.addColorStop(1, `${fx.color}10`);
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(hx - 6 * dpr, hy); g.lineTo(hx + 6 * dpr, hy); g.lineTo(sx + w, sy); g.lineTo(sx - w, sy); g.closePath(); g.fill();
    g.fillStyle = fx.color; g.globalAlpha = 0.45 + 0.55 * fx.level;
    g.beginPath(); g.arc(hx, hy, 9 * dpr, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  });
  const spot = g.createRadialGradient(sx, sy, 0, sx, sy, 140 * dpr);
  spot.addColorStop(0, `#FFFFFF${Math.round(120 * stage.spot.level).toString(16).padStart(2, '0')}`); spot.addColorStop(1, '#FFFFFF00');
  g.fillStyle = spot; g.beginPath(); g.ellipse(sx, sy, 150 * dpr, 40 * dpr, 0, 0, Math.PI * 2); g.fill();
  // the performer: the keyed 3D body, feet on the spot, tinted and rim-lit by the brightest light
  const box = keyedBody();
  if (box) {
    const av = box;
    const prevH = stage.avH ?? (box.vy1 - box.vy0);
    stage.avH = prevH + 0.2 * ((box.vy1 - box.vy0) - prevH);   // smooth the size, not the position
    const lead = stage.fixtures.reduce((m, f) => (f.level > m.level ? f : m), stage.fixtures[0]);
    if (av.fresh) {                                  // tint a new cut-out once; a kept one is already tinted
      kg.globalCompositeOperation = 'source-atop';
      kg.fillStyle = `${lead.color}55`;
      kg.fillRect(0, 0, key.width, key.height);
      kg.globalCompositeOperation = 'source-over';
    }
    const h = H * 0.36 * ((av.vy1 - av.vy0) / Math.max(1, stage.avH)), w = (h * (av.x1 - av.x0)) / Math.max(1, av.y1 - av.y0);
    const ax = sx - (av.hip - av.x0) * (w / Math.max(1, av.x1 - av.x0)), ay = sy - h;
    // Fast GPU radial aura behind performer instead of slow CPU canvas filter + shadowBlur convolution
    g.globalCompositeOperation = 'lighter';
    const aura = g.createRadialGradient(sx, ay + h * 0.5, 0, sx, ay + h * 0.5, Math.max(w, h) * 0.65);
    const auraAlpha = Math.round(55 + 95 * lead.level).toString(16).padStart(2, '0');
    aura.addColorStop(0, `${lead.color}${auraAlpha}`);
    aura.addColorStop(1, `${lead.color}00`);
    g.fillStyle = aura;
    g.fillRect(sx - h, ay - h * 0.2, h * 2, h * 1.4);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(key, av.x0, av.y0, av.x1 - av.x0, av.y1 - av.y0, ax, ay, w, h);
  }
  // the head camera, picture in picture
  g.globalCompositeOperation = 'source-over';
  const pip = (v, x, y, w, label) => {
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    const h = (w * v.videoHeight) / v.videoWidth;
    g.drawImage(v, x, y, w, h);
    g.strokeStyle = '#FFFFFF55'; g.lineWidth = 1 * dpr; g.strokeRect(x, y, w, h);
    g.fillStyle = '#FFFFFFCC'; g.font = `${12 * dpr}px Geist, sans-serif`; g.fillText(label, x + 8 * dpr, y + h - 8 * dpr);
  };
  pip(videoOf('pov'), 20 * dpr, H - 20 * dpr - W * 0.27 * 9 / 16, W * 0.27, 'POV');
}

// The show is the Stage tab's main view (over the POV, which it shows as an inset).
const show = $('show');
document.querySelector('#media .media-stage')?.append(show);
show.classList.add('is-inline');
export function openShow(on) {
  const allowed = Boolean(on) && session.active !== false && !session.tooShort;
  const was = stage.open;
  stage.open = allowed;
  show.hidden = !allowed;
  if (!allowed) hq.pause();
  if (allowed) { renderScene(); renderCues(); renderOut(); if (!was) requestAnimationFrame(draw); }
}
document.addEventListener('lifelens:tab', (e) => openShow(e.detail.tab === 'stage'));
document.addEventListener('lifelens:activity', () => {
  const onStage = document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab === 'stage';
  openShow(onStage);
});

export function setFx() {
  stage.fx = false;
}

export function resetStage() {
  Object.assign(stage, { scene: null, cues: [], flashUntil: 0, last: {}, beats: 0, askedAt: 0, lightsOut: null, plan: null });
  renderScene(); renderCues();
}
