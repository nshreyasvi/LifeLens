// LifeLens Gym tab: Gymify a processed recording (pipeline/gymify.py via /api/gymify) and show its gym.json.
// Measured from the 3D body (no model): reps, sets and rests, range of motion, down/up tempo, left-right difference.
// Meta Muse Spark: the exercise (from 3D body and POV frames, unless picked), form coaching from frames of the
// first, middle and last rep with the numbers, and the music to train to.

import { media } from './extras.js';
import { session } from './session.js';
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
  const box = $('gym-result');
  if (!g) {
    box.replaceChildren(el('p', 'gym-empty', 'Gymify names the exercise from the 3D body (Muse Spark), then measures every rep: range of motion, tempo and left-right difference, sets and rests. Muse coaches the form from frames of the reps.'));
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
      ? 'This recording shows no repeated exercise, so no reps are counted. If Muse got it wrong, pick the exercise and run Gymify again.'
      : 'No clear reps on the main joint: the movement is too small or too irregular to count.'));
    return;
  }
  const sm = g.summary;
  const tiles = el('div', 'gym-tiles');
  tiles.append(tile('reps', String(sm.reps), 'reps'), tile('sets', String(sm.sets), sm.sets === 1 ? 'set' : 'sets'),
    tile('range', `${Math.round(sm.rom_mean_deg)}°`, `${g.joint} range`), tile('tempo', `${sm.down_mean_s}/${sm.up_mean_s} s`, 'down / up'),
    tile('sym', `${sm.asym_mean_deg}°`, 'left-right'), tile('pace', String(sm.reps_per_min), 'reps / min'));
  const seconds = session.pose ? session.pose.n / 30 : Math.max(...g.reps.map((r) => r.end_s)) + 1;
  const parts = [head, tiles, repChart(g, seconds)];
  const fade = sm.rom_change_pct;
  if (Math.abs(fade) >= 5) parts.push(el('p', 'gym-note', `Range of motion ${fade < 0 ? 'dropped' : 'grew'} ${Math.abs(fade)}% from the first to the last third of the reps${fade < 0 ? ', a sign of fatigue' : ''}.`));
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
  box.replaceChildren(...parts);
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
    body: JSON.stringify({ run: session.rec.base, exercise: $('gym-exercise').value, ...profile() }) });
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
document.addEventListener('lifelens:session', () => { if (session.rec) load(); else render(null); });
