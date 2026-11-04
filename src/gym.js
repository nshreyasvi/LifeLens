// LifeLens Gym tab: Gymify a processed recording (pipeline/gymify.py via /api/gymify) and show its gym.json.
// Measured from the 3D body (no model): reps, sets and rests, range of motion, down/up tempo, left-right difference.
// Meta Muse Spark: the exercise (from 3D body and POV frames, unless picked), form feedback from frames of the
// first, middle and last rep with the numbers, and the music to train to.

import { media } from './extras.js';
import { session } from './session.js';
import { bodyKey, keyedBody } from './stage.js';
import { profile } from './start.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });
const svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// left-right difference at the bottom of a rep: under 6 degrees even, under 12 uneven, else lopsided
const asymColor = (d) => (d < 6 ? 'var(--p-walking)' : d < 12 ? 'var(--p-arms)' : 'var(--p-bending)');
const ICON = {
  reps: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4', sets: 'M4 6h16M4 12h16M4 18h10', range: 'M5 19L19 5M5 19h8M5 19v-8',
  tempo: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18', sym: 'M12 3v18M5 8l-3 4l3 4M19 8l3 4l-3 4', pace: 'M4 18l5-6l4 3l7-9',
};

function tile(icon, value, label) {
  const t = el('div', 'gym-tile');
  const i = svg('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', class: 'gym-icon' });
  i.appendChild(svg('path', { d: ICON[icon], fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  t.append(i, el('strong', '', value), el('span', '', label));
  return t;
}

// One bar per rep along the recording: height = range of motion, colour = left-right difference; under it the rep's
// seconds down (dark) and up (light). Sets and the rests between them are labelled. Click a rep: the video goes there.
function repChart(g, seconds) {
  const W = 600, H = 190, top = 26, base = 140, maxRom = Math.max(...g.reps.map((r) => r.rom_deg), 30);
  const x = (t) => 8 + ((W - 16) * t) / seconds;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gym-chart', role: 'img',
    'aria-label': `${g.reps.length} reps: range of motion ${g.summary.rom_min_deg} to ${g.summary.rom_max_deg} degrees` });
  s.appendChild(svg('line', { x1: 8, x2: W - 8, y1: base, y2: base, stroke: 'var(--border-strong)' }));
  g.sets.forEach((st, k) => {
    s.appendChild(svg('rect', { x: x(st.start_s) - 3, y: top - 16, width: Math.max(8, x(st.end_s) - x(st.start_s) + 6), height: base - top + 20,
      rx: 8, fill: 'var(--accent-soft)' }));
    const label = svg('text', { x: x(st.start_s), y: top - 4, class: 'gym-chart-label' });
    label.textContent = `Set ${k + 1} · ${st.reps} reps`;
    s.appendChild(label);
    if (st.rest_after_s) {
      const r = svg('text', { x: (x(st.end_s) + x(g.sets[k + 1].start_s)) / 2, y: base - 8, 'text-anchor': 'middle', class: 'gym-chart-rest' });
      r.textContent = `rest ${Math.round(st.rest_after_s)} s`;
      s.appendChild(r);
    }
  });
  g.reps.forEach((r, k) => {
    const x0 = x(r.start_s), w = Math.max(3, x(r.end_s) - x0 - 2), h = ((base - top) * r.rom_deg) / maxRom;
    const bar = svg('rect', { x: x0, y: base - h, width: w, height: h, rx: 3, fill: asymColor(r.asym_deg), class: 'gym-bar', tabindex: 0 });
    const tip = svg('title', {});
    tip.textContent = `Rep ${k + 1} at ${clock(r.bottom_s)}: ${Math.round(r.rom_deg)}° range, ${r.down_s} s down, ${r.up_s} s up, ${r.asym_deg}° left-right`;
    bar.appendChild(tip);
    const go = () => { media.seek(r.bottom_s); media.play(); };
    bar.addEventListener('click', go);
    bar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    const split = w * (r.down_s / Math.max(0.01, r.down_s + r.up_s));
    s.append(bar, svg('rect', { x: x0, y: base + 8, width: split, height: 8, fill: 'var(--text)', opacity: 0.7 }),
      svg('rect', { x: x0 + split, y: base + 8, width: w - split, height: 8, fill: 'var(--text)', opacity: 0.25 }));
  });
  const legend = svg('text', { x: 8, y: H - 8, class: 'gym-chart-label' });
  legend.textContent = 'Bar height: range of motion · colour: left-right difference · strip: down (dark) / up (light)';
  s.appendChild(legend);
  return s;
}

function render(g) {
  view.g = g;
  const box = $('gym-result');
  if (!g) {
    box.replaceChildren(el('p', 'gym-empty', 'Gymify names the exercise from the 3D body (Muse Spark), then measures every rep: range of motion, tempo and left-right difference, sets and rests. Muse gives form feedback from frames of the reps.'));
    $('gym-status').textContent = 'Not run yet';
    return;
  }
  const ex = g.exercise;
  $('gym-status').textContent = ex.exercise === 'none' ? 'No exercise found' : `${g.summary.reps ?? 0} reps`;
  const head = el('div', 'gym-ex');
  head.append(el('strong', '', ex.exercise === 'none' ? 'No exercise' : cap(ex.exercise)),
    el('span', 'gym-ex-src', ex.source === 'you' ? 'picked by you' : `Muse Spark${ex.confidence != null ? ` · ${Math.round(100 * ex.confidence)}% sure` : ''}`));
  if (ex.reason) head.appendChild(el('p', 'gym-ex-why', ex.reason));
  if (!g.reps.length) {
    box.replaceChildren(head, el('p', 'gym-empty', ex.exercise === 'none'
      ? 'Muse Spark saw no repeated exercise in this recording, so no reps are counted.'
      : 'No clear reps on the main joint: the movement is too small or too irregular to count.'));
    return;
  }
  const sm = g.summary;
  const tiles = el('div', 'gym-tiles');
  tiles.append(tile('reps', String(sm.reps), 'reps'), tile('sets', String(sm.sets), sm.sets === 1 ? 'set' : 'sets'),
    tile('range', `${Math.round(sm.rom_mean_deg)}°`, `${g.joint} range`), tile('tempo', `${sm.down_mean_s}/${sm.up_mean_s} s`, 'down / up'),
    tile('sym', `${sm.asym_mean_deg}°`, 'left-right'), tile('pace', String(sm.reps_per_min), 'reps / min'));
  const seconds = session.pose ? session.pose.n / 30 : Math.max(...g.reps.map((r) => r.end_s)) + 1;
  const numbers = el('div', 'gym-col');
  numbers.append(tiles, repChart(g, seconds), repTable(g));
  const fade = sm.rom_change_pct;
  if (Math.abs(fade) >= 5) numbers.append(el('p', 'gym-note', `Range of motion ${fade < 0 ? 'dropped' : 'grew'} ${Math.abs(fade)}% from the first to the last third of the reps${fade < 0 ? ', a sign of fatigue' : ''}.`));
  const parts = [];
  const r = g.review;
  if (r) {
    parts.push(el('p', 'gym-summary', r.summary));
    const list = el('ol', 'gym-changes');
    list.append(...(r.improvements ?? []).map((c) => {
      const li = el('li');
      li.append(el('strong', '', c.change), el('span', 'gym-why', c.why ?? ''), el('span', 'gym-how', c.how ?? ''));
      return li;
    }));
    parts.push(list);
    if (r.went_well?.length) {
      const good = el('ul', 'gym-good');
      good.append(...r.went_well.map((t) => el('li', '', t)));
      parts.push(good);
    }
    const more = el('details', 'gym-more');
    more.append(el('summary', '', `What Muse saw in the frames (${(r.form ?? []).length})`), ...(r.form ?? []).map((t) => el('p', '', t)),
      ...(r.caveats ?? []).map((t) => el('p', 'gym-caveat', t)));
    parts.push(more);
    if (r.music) {
      const m = r.music;
      const music = el('div', 'gym-music');
      const chips = el('div', 'gym-chips');
      chips.append(...[[m.search, 'style'], [`${Math.round(m.tempo)} BPM`, 'tempo'], [`${Math.round(100 * m.energy)}%`, 'energy'],
        [`${Math.round(100 * m.valence)}%`, 'mood'], [`${Math.round(100 * (m.instrumentalness ?? 0))}%`, 'instrumental']].map(([v, k]) => {
        const c = el('span', 'gym-chip');
        c.append(el('strong', '', v), ` ${k}`);
        return c;
      }));
      const play = el('button', 'btn btn-small-text btn-primary', 'Play gym music');
      play.type = 'button';
      play.addEventListener('click', () => document.dispatchEvent(new CustomEvent('lifelens:music-profile', { detail: m })));
      music.append(el('span', 'gym-label', 'Music to train to (Muse Spark)'), chips, el('p', 'gym-why', m.reason ?? ''), play);
      parts.push(music);
    }
  }
  const feedback = el('div', 'gym-col gym-feedback');
  feedback.append(el('h3', 'gym-col-title', 'Form feedback from Meta Muse Spark'), ...parts);
  const cols = el('div', 'gym-cols');
  cols.append(numbers, feedback);
  box.replaceChildren(head, cols);
}

// One row per rep: depth as a bar against the deepest rep, seconds down and up, and the left-right difference.
function repTable(g) {
  const deepest = Math.max(...g.reps.map((r) => r.rom_deg), 1);
  const t = el('table', 'gym-reps');
  const head = el('tr');
  head.append(...['Rep', `${cap(g.joint)} range`, 'Down', 'Up', 'Left-right'].map((h) => el('th', '', h)));
  t.appendChild(el('thead')).appendChild(head);
  const body = t.appendChild(el('tbody'));
  g.reps.forEach((r, k) => {
    const row = el('tr');
    const depth = el('td');
    const wrap = el('div', 'gym-depth');
    const track = el('span', 'gym-depth-track');
    const bar = el('span', 'gym-depth-bar');
    bar.style.width = `${(100 * r.rom_deg) / deepest}%`;
    track.appendChild(bar);
    wrap.append(track, el('span', '', `${Math.round(r.rom_deg)}°`));
    depth.appendChild(wrap);
    const lr = el('td', 'gym-lr');
    const dot = el('span', 'gym-lr-dot');
    dot.style.background = asymColor(r.asym_deg);
    lr.append(dot, `${r.asym_deg}°`);
    row.append(el('td', '', String(k + 1)), depth, el('td', '', `${r.down_s} s`), el('td', '', `${r.up_s} s`), lr);
    row.tabIndex = 0;
    row.addEventListener('click', () => { media.seek(r.bottom_s); media.play(); });
    body.appendChild(row);
  });
  return t;
}

async function load() {
  const url = session.rec?.files?.['gym.json'];
  render(url ? await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`).then((x) => x.json()).catch(() => null) : null);
}

async function gymify() {
  const btn = $('gym-btn');
  btn.disabled = true;
  $('gym-status').textContent = 'Running…';
  const res = await fetch('/api/gymify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ run: session.rec.base, ...profile() }) });      // Muse Spark recognises the exercise
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { $('gym-status').textContent = body.error || `Error ${res.status}`; btn.disabled = false; return; }
  const poll = setInterval(async () => {
    const s = await fetch('/api/gymify/status', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({}));
    if (!s.done && !s.error) { $('gym-status').textContent = 'Muse Spark is looking at the 3D body…'; return; }
    clearInterval(poll);
    btn.disabled = false;
    if (s.error) { $('gym-status').textContent = `Gymify failed: ${s.error}`; return; }
    const { fetchRecordings } = await import('./session.js');
    const rec = (await fetchRecordings()).processed.find((r) => r.base === session.rec.base);
    if (rec) session.rec.files = rec.files;          // gym.json is listed now
    load();
  }, 2000);
}

$('gym-btn').addEventListener('click', gymify);

// The Gym viewer (main view while the Gym tab is open): the 3D body, cut out of its render, on a gym stage (a wall of
// mirrors, a rubber floor, a lifting platform), the head camera small, the working joint's angle on a gauge, and the
// reps as they happen: which rep, going down or up, its range, and a dot per rep.
function gymStage(W, H, dpr) {
  const horizon = H * 0.6;
  const wall = gg.createLinearGradient(0, 0, 0, horizon);
  wall.addColorStop(0, '#16181D'); wall.addColorStop(1, '#22252C');
  gg.fillStyle = wall; gg.fillRect(0, 0, W, horizon);
  for (let i = 0; i < 4; i++) {                      // mirror panels, each with a faint diagonal sheen
    const x = W * (0.08 + 0.22 * i), w = W * 0.19, y = H * 0.1, h = horizon - y - H * 0.03;
    gg.fillStyle = '#2A2E37'; gg.fillRect(x, y, w, h);
    const sheen = gg.createLinearGradient(x, y, x + w, y + h);
    sheen.addColorStop(0, '#FFFFFF10'); sheen.addColorStop(0.5, '#FFFFFF03'); sheen.addColorStop(1, '#FFFFFF0A');
    gg.fillStyle = sheen; gg.fillRect(x, y, w, h);
    gg.strokeStyle = '#3A3F4A'; gg.lineWidth = 2 * dpr; gg.strokeRect(x, y, w, h);
  }
  for (const x of [0.25, 0.5, 0.75]) {                // warm overhead light pools on the wall
    const glow = gg.createRadialGradient(W * x, 0, 0, W * x, 0, H * 0.45);
    glow.addColorStop(0, '#FFE9C433'); glow.addColorStop(1, '#FFE9C400');
    gg.fillStyle = glow; gg.fillRect(0, 0, W, horizon);
  }
  gg.fillStyle = '#121316'; gg.fillRect(0, horizon, W, H - horizon);   // rubber floor, tiles in perspective
  gg.strokeStyle = '#1E2026'; gg.lineWidth = 1.5 * dpr;
  for (let i = -6; i <= 6; i++) { gg.beginPath(); gg.moveTo(W / 2 + i * W * 0.06, horizon); gg.lineTo(W / 2 + i * W * 0.32, H); gg.stroke(); }
  for (let k = 1; k <= 5; k++) { const y = horizon + (H - horizon) * (k / 5) ** 1.6; gg.beginPath(); gg.moveTo(0, y); gg.lineTo(W, y); gg.stroke(); }
  const py0 = H * 0.78, py1 = H * 0.92;              // the lifting platform
  const wood = gg.createLinearGradient(0, py0, 0, py1);
  wood.addColorStop(0, '#7A5A3C'); wood.addColorStop(1, '#5A4029');
  gg.fillStyle = wood;
  gg.beginPath(); gg.moveTo(W * 0.32, py0); gg.lineTo(W * 0.68, py0); gg.lineTo(W * 0.74, py1); gg.lineTo(W * 0.26, py1); gg.closePath(); gg.fill();
  gg.fillStyle = '#2B2D33';
  gg.fillRect(W * 0.26, py1, W * 0.48, 6 * dpr);
  return { feetY: H * 0.86 };
}

// The working joint's angle now, against the deepest rep: a half-circle gauge with a needle and a target tick.
function gauge(x, y, rad, angle, deepest, dpr) {
  const a = (deg) => Math.PI + (Math.min(160, Math.max(0, deg)) / 160) * Math.PI;
  gg.lineCap = 'round';
  gg.lineWidth = 10 * dpr; gg.strokeStyle = '#FFFFFF22';
  gg.beginPath(); gg.arc(x, y, rad, Math.PI, 2 * Math.PI); gg.stroke();
  gg.strokeStyle = '#3FB27F';
  gg.beginPath(); gg.arc(x, y, rad, Math.PI, a(angle)); gg.stroke();
  gg.lineWidth = 3 * dpr; gg.strokeStyle = '#FFFFFF';
  gg.beginPath(); gg.moveTo(x + Math.cos(a(deepest)) * (rad - 12 * dpr), y + Math.sin(a(deepest)) * (rad - 12 * dpr));
  gg.lineTo(x + Math.cos(a(deepest)) * (rad + 12 * dpr), y + Math.sin(a(deepest)) * (rad + 12 * dpr)); gg.stroke();
  gg.fillStyle = '#FFFFFF'; gg.textAlign = 'center';
  gg.font = `650 ${22 * dpr}px Geist, sans-serif`; gg.fillText(`${Math.round(angle)}°`, x, y - 4 * dpr);
  gg.font = `${12 * dpr}px Geist, sans-serif`; gg.fillStyle = '#FFFFFFB3';
  gg.fillText(`deepest rep ${Math.round(deepest)}°`, x, y + 18 * dpr);
  gg.textAlign = 'left'; gg.lineCap = 'butt';
}
const view = { g: null, open: false };
const canvas = $('gym-view');
const gg = canvas.getContext('2d');
function drawGym() {
  if (!view.open) return;
  requestAnimationFrame(drawGym);
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== W || canvas.height !== H) Object.assign(canvas, { width: W, height: H });
  const { feetY } = gymStage(W, H, dpr);
  const box = keyedBody();
  if (box) {                                         // the athlete: pelvis on the platform's centre line
    const h = H * 0.6, w = (h * (box.x1 - box.x0)) / Math.max(1, box.y1 - box.y0);
    const x = W / 2 - (box.hip - box.x0) * (w / Math.max(1, box.x1 - box.x0));
    const shadow = gg.createRadialGradient(W / 2, feetY, 0, W / 2, feetY, w * 0.7);
    shadow.addColorStop(0, '#00000099'); shadow.addColorStop(1, '#00000000');
    gg.fillStyle = shadow; gg.beginPath(); gg.ellipse(W / 2, feetY, w * 0.7, 14 * dpr, 0, 0, Math.PI * 2); gg.fill();
    gg.drawImage(bodyKey, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, x, feetY - h, w, h);
  }
  const body = media.body;
  const pov = document.querySelector('#media [data-pane="pov"] video');
  if (pov?.readyState >= 2 && pov.videoWidth) {
    const w = W * 0.28, h = (w * pov.videoHeight) / pov.videoWidth, x = W - w - 16 * dpr, y = H - h - 16 * dpr;
    gg.drawImage(pov, x, y, w, h);
    gg.strokeStyle = '#FFFFFF88'; gg.lineWidth = 2 * dpr; gg.strokeRect(x, y, w, h);
    gg.fillStyle = '#FFFFFFDD'; gg.font = `600 ${12 * dpr}px Geist, sans-serif`; gg.fillText('Head camera', x + 8 * dpr, y + 18 * dpr);
  }
  const g = view.g, t = body?.currentTime ?? 0, pad = 18 * dpr;
  gg.fillStyle = '#0B0D12CC';
  gg.fillRect(pad - 8 * dpr, pad - 8 * dpr, 330 * dpr, (g?.reps?.length ? 92 : 44) * dpr);
  gg.fillStyle = '#FFFFFF';
  gg.font = `650 ${18 * dpr}px Geist, sans-serif`;
  if (!g) { gg.fillText('Run Gymify to count the reps', pad, pad + 20 * dpr); return; }
  const reps = g.reps ?? [];
  if (!reps.length) { gg.fillText(g.exercise.exercise === 'none' ? 'No exercise in this recording' : 'No clear reps', pad, pad + 20 * dpr); return; }
  const p = session.pose, i = Math.min((p?.n ?? 1) - 1, Math.round(t * 30)), col = { knee: 'knee', hip: 'hip', elbow: 'elbow' }[g.joint];
  if (p && col) {                                    // flexion of the working joint, both sides averaged
    gauge(W - 120 * dpr, 110 * dpr, 70 * dpr, (p[`${col}_l`][i] + p[`${col}_r`][i]) / 2, Math.max(...reps.map((r) => r.rom_deg)), dpr);
  }
  const cur = reps.findIndex((r) => t >= r.start_s && t <= r.end_s);
  const done = reps.filter((r) => r.end_s < t).length;
  const r = reps[cur];
  gg.fillText(`${cap(g.exercise.exercise)} · rep ${cur >= 0 ? cur + 1 : done} of ${reps.length}`, pad, pad + 20 * dpr);
  gg.font = `${14 * dpr}px Geist, sans-serif`;
  gg.fillStyle = '#FFFFFFCC';
  gg.fillText(r ? `${t < r.bottom_s ? 'Going down' : 'Coming up'} · ${Math.round(r.rom_deg)}° ${g.joint} range · ${r.asym_deg}° left-right`
    : done === reps.length ? 'All reps done' : 'Between reps', pad, pad + 44 * dpr);
  reps.forEach((rep, k) => {                 // a dot per rep: filled when done, ringed while it happens
    const x = pad + 6 * dpr + k * 18 * dpr, y = pad + 68 * dpr;
    gg.beginPath(); gg.arc(x, y, 6 * dpr, 0, Math.PI * 2);
    gg.fillStyle = k < done ? (rep.asym_deg < 6 ? '#3FB27F' : rep.asym_deg < 12 ? '#F0A33A' : '#E5534B') : '#FFFFFF33';   // even, uneven, lopsided
    gg.fill();
    if (k === cur) { gg.strokeStyle = '#FFFFFF'; gg.lineWidth = 2 * dpr; gg.stroke(); }
  });
}
document.addEventListener('lifelens:tab', (e) => {
  view.open = e.detail.tab === 'gym';
  canvas.hidden = !view.open;
  if (view.open) requestAnimationFrame(drawGym);
});
canvas.addEventListener('click', () => $('play-btn').click());
document.addEventListener('lifelens:session', () => { if (session.rec) load(); else render(null); });
