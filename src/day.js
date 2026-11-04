// LifeLens front-end: Activity, Routine & Past Routines workspace inside the Routine view.
// Uses the main POV + 3D body media player (extras.js) directly—no duplicate video elements—and showcases
// the active session's posture timeline, timestamped action log, past routine comparisons, and Meta Muse Spark feedback.

import { media } from './extras.js';
import { fetchRecordings, openRecording, session } from './session.js';

const POSTURES = ['walking', 'standing', 'sitting', 'crouching', 'bending', 'arms raised'];
const POSTURE_COLORS = {
  walking: 'var(--p-walking)', standing: 'var(--p-standing)', sitting: 'var(--p-sitting)',
  crouching: 'var(--p-crouching)', bending: 'var(--p-bending)', 'arms raised': 'var(--p-arms)',
};

const $ = (id) => document.getElementById(id);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const el = (tag, className, text) => Object.assign(document.createElement(tag), className ? { className } : {},
  text === undefined ? {} : { textContent: text });
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const minutes = (m) => (!Number.isFinite(m) ? '-' : m < 1 ? `${Math.round(m * 60)} s` : `${m.toFixed(1)} min`);
const tidy = (t) => { const s = String(t || '').replace(/^the (camera )?(wearer|person)\s+(is\s+)?/i, '').trim(); return s ? capitalize(s) : ''; };
const brief = (t, max = 108) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const firstSentence = s.split(/(?<=[.!?])\s+/)[0];
  if (firstSentence && firstSentence.length <= max + 20) return firstSentence;
  return `${s.slice(0, max - 1).replace(/[,;:\s]+$/, '')}…`;
};
const getJson = async (url) => (url ? (await fetch(url, { cache: 'no-store' })).json() : null);
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const ICONS = {
  time: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18', walk: 'M13 4a1.5 1.5 0 1 0 0 .1M10 21l2-6l3 3v3M9 12l3-4l3 3l3 1M12 8l-3 1l-2 3',
  active: 'M3 12h4l3-7l4 14l3-7h4', sit: 'M6 3v9h10v9M6 12v9M16 12V7', sun: 'M12 4v2M12 18v2M4 12h2M18 12h2M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8',
};
function iconTile(icon, value, label) {
  const tile = el('div', 'day-stat');
  const i = svgEl('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', class: 'day-stat-icon' });
  i.appendChild(svgEl('path', { d: ICONS[icon], fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  tile.append(i, el('span', 'day-stat-value', value), el('span', 'day-stat-name', label));
  return tile;
}
// "1:05" or "1:05-1:20" at the start of Muse's text -> seconds
const secondsOf = (m, s) => Number(m) * 60 + Number(s);
function spanOf(text) {
  const m = String(text).match(/^\s*(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})\s*:?\s*(.*)$/);
  return m ? { start: secondsOf(m[1], m[2]), end: secondsOf(m[3], m[4]), text: m[5] } : null;
}
const firstTime = (text) => { const m = String(text).match(/(\d+):(\d{2})/); return m ? secondsOf(m[1], m[2]) : null; };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const majorityOf = (labels) => {
  const counts = {};
  for (const l of labels) counts[l] = (counts[l] ?? 0) + 1;
  return Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a), labels[0] ?? 'unknown');
};
const shareOf = (labels) => {
  const known = labels.filter((l) => POSTURES.includes(l));
  return Object.fromEntries(POSTURES.map((p) => [p, known.length ? known.filter((l) => l === p).length / known.length : 0]));
};

function stackedBar(share) {
  const bar = el('div', 'day-bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', POSTURES.filter((p) => share[p] >= 0.01).map((p) => `${p} ${Math.round(share[p] * 100)}%`).join(', '));
  for (const p of POSTURES) {
    if (!(share[p] > 0)) continue;
    const seg = el('span');
    seg.style.width = `${share[p] * 100}%`;
    seg.style.background = POSTURE_COLORS[p];
    seg.title = `${capitalize(p)}: ${Math.round(share[p] * 100)}%`;
    bar.appendChild(seg);
  }
  return bar;
}

function drawRuns(box, labels) {
  box.replaceChildren();
  for (let i = 0; i < labels.length;) {
    let k = i;
    while (k < labels.length && labels[k] === labels[i]) k += 1;
    const run = el('span', 'day-run');
    run.style.width = `${((k - i) / labels.length) * 100}%`;
    run.style.background = POSTURE_COLORS[labels[i]] ?? 'var(--surface-solid)';
    box.appendChild(run);
    i = k;
  }
}

// ---------- Active Recording Routine ----------

const video = media.body;
const view = { rows: [], captions: [], labels: [],
  entries: [], items: [], current: -1, marker: null };

function entriesFromMuse() {
  if (view.captions.length) {
    return view.captions
      .filter((c) => c.text && !c.text.startsWith('['))
      .map((c) => ({ start: c.start_s, end: Math.ceil(c.end_s), text: tidy(c.text) }));
  }
  const out = [];
  for (const r of view.rows) {
    const s = Number(r.second);
    const last = out[out.length - 1];
    if (last && (!r.narration || r.narration === last.raw)) last.end = s + 1;
    else out.push({ start: s, end: s + 1, raw: r.narration, text: tidy(r.narration) });
  }
  return out.filter((e) => e.text);
}

function describe(s) {
  const e = view.entries.find((x) => s >= x.start && s < x.end);
  return `${clock(s)} · ${capitalize(view.labels[s] ?? 'unknown')}${e ? ` · ${e.text}` : ''}`;
}

function drawStrip() {
  const strip = $('routine-strip');
  drawRuns(strip, view.labels);
  view.marker = el('span', 'day-marker');
  strip.appendChild(view.marker);
  strip.tabIndex = 0;
  strip.setAttribute('role', 'slider');
  strip.setAttribute('aria-label', 'Posture each second, from Meta Muse Spark');
  strip.setAttribute('aria-valuemin', '0');
  strip.setAttribute('aria-valuemax', String(view.labels.length - 1));
}

// The log as a film strip: one POV thumbnail per caption (5 s), with its time and posture colour. The caption of the
// selected moment is the one line of text (routine-caption). Thumbnails are drawn from the POV by a hidden video.
const thumbs = { video: Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto' }), run: 0 };
async function drawThumbs(entries, imgs) {
  const run = ++thumbs.run;
  const v = thumbs.video;
  const src = session.rec?.pov || session.rec?.body;
  if (!src) return;
  if (v.dataset.src !== src) { v.dataset.src = src; v.src = src; }
  if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
  const c = Object.assign(document.createElement('canvas'), { width: 192, height: 108 });
  for (let k = 0; k < entries.length; k++) {
    if (run !== thumbs.run) return;
    v.currentTime = Math.min(v.duration - 0.1, (entries[k].start + entries[k].end) / 2);
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    imgs[k].src = c.toDataURL('image/jpeg', 0.75);
  }
}

function drawLog() {
  view.entries = entriesFromMuse();
  const imgs = [];
  view.items = view.entries.map((e) => {
    const li = el('li', 'film-item');
    const btn = el('button', 'film-btn');
    btn.type = 'button';
    const label = majorityOf(view.labels.slice(e.start, e.end));
    const img = el('img', 'film-img');
    img.alt = e.text;
    imgs.push(img);
    const meta = el('span', 'film-meta');
    const dot = el('span', 'day-dot');
    dot.style.background = POSTURE_COLORS[label] ?? 'var(--faint)';
    meta.append(dot, el('time', '', clock(e.start)));
    btn.title = `${clock(e.start)} · ${capitalize(label)} · ${e.text}`;
    btn.append(img, meta);
    btn.addEventListener('click', () => { media.seek(e.start + 0.05); media.play(); });
    li.appendChild(btn);
    return li;
  });
  $('routine-log').replaceChildren(...view.items);
  view.current = -1;
  drawThumbs(view.entries, imgs).catch(() => {});
}

// Muse's feedback on the timeline: what they did as labelled spans, its changes as numbered pins at the time they cite.
function drawTrack(r) {
  const track = $('routine-track');
  const n = view.labels.length || 1;
  const pct = (t) => `${Math.min(100, Math.max(0, (100 * t) / n))}%`;
  const parts = [];
  for (const item of r?.what_they_did ?? []) {
    const sp = spanOf(item);
    if (!sp) continue;
    const text = sp.text.replace(/\s*\([^)]*\)\s*$/, '');
    const b = el('button', 'track-span', text.split(/\s+/).slice(0, 4).join(' '));
    b.type = 'button';
    b.style.left = pct(sp.start);
    b.style.width = `calc(${pct(Math.max(1, sp.end - sp.start))} - 2px)`;
    b.title = `${clock(sp.start)}-${clock(sp.end)} · ${text}`;
    b.addEventListener('click', () => { media.seek(sp.start + 0.05); $('routine-caption').textContent = b.title; });
    parts.push(b);
  }
  (r?.improvements ?? []).forEach((c, k) => {
    const t = firstTime(c.why) ?? firstTime(c.how);
    if (t === null) return;
    const pin = el('button', 'track-pin', String(k + 1));
    pin.type = 'button';
    pin.style.left = pct(t);
    pin.title = `${k + 1}. ${c.change}: ${c.how ?? ''}`;
    pin.addEventListener('click', () => { media.seek(t + 0.05); $('routine-caption').textContent = pin.title; });
    parts.push(pin);
  });
  track.replaceChildren(...parts);
  track.closest('.strip-row').hidden = !parts.length;
}

// Walking speed each second (mean of the 3D body's pelvis speed), as a line under the posture strip.
function drawSpeed() {
  const p = session.pose;
  const box = $('routine-speed');
  if (!p) { box.replaceChildren(); return; }
  const secs = Math.floor(p.n / 30), v = [];
  for (let s = 0; s < secs; s++) { let m = 0; for (let i = s * 30; i < s * 30 + 30; i++) m += p.speed_m_s[i]; v.push(m / 30); }
  const top = Math.max(1.2, ...v);
  const pts = v.map((y, s) => `${(600 * (s + 0.5)) / secs},${38 - (34 * y) / top}`).join(' ');
  box.replaceChildren(svgEl('polyline', { points: pts, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }),
    Object.assign(svgEl('title'), { textContent: `Walking speed, 0 to ${top.toFixed(1)} m/s` }));
}

function update() {
  if (!view.labels.length || !view.marker) return;
  const s = Math.min(Math.max(Math.floor(video.currentTime || 0), 0), view.labels.length - 1);
  view.marker.style.left = `${((s + 0.5) / view.labels.length) * 100}%`;
  const strip = $('routine-strip');
  strip.setAttribute('aria-valuenow', String(s));
  strip.setAttribute('aria-valuetext', describe(s));
  $('routine-clock').textContent = `${clock(s)} / ${clock(view.labels.length)}`;
  $('routine-caption').textContent = describe(s);
  showNow(s);
  const i = view.entries.findIndex((e) => s >= e.start && s < e.end);
  if (i === view.current) return;
  view.items[view.current]?.classList.remove('is-current');
  view.current = i;
  const item = view.items[i];
  if (!item) return;
  item.classList.add('is-current');
  const log = $('routine-log');
  if (!log.closest('[hidden]')) log.scrollTo({ left: item.offsetLeft - log.clientWidth / 2 + item.offsetWidth / 2, behavior: 'smooth' });
}

// What Muse Spark saw in the 5 s window under the playhead: the 3D body and head-camera frames it labelled
// (frames/body_<start>.jpg, pov_<start>.jpg), the posture it named and its caption.
function showNow(s) {
  const start = Math.floor(s / 5) * 5;
  if (start === view.nowAt) return;
  view.nowAt = start;
  const base = session.rec?.base;
  const cap = view.captions.find((c) => s >= c.start_s && s < c.end_s);
  $('now-window').textContent = `${clock(start)}-${clock(Math.min(start + 5, view.labels.length))}`;
  $('now-posture').textContent = view.labels[s] && view.labels[s] !== 'unknown' ? capitalize(view.labels[s]) : 'No label';
  $('now-caption').textContent = cap && !cap.text.startsWith('[') ? tidy(cap.text) : 'No caption for this moment.';
  for (const [id, name, alt] of [['now-body', 'body', 'The 3D body frame Muse Spark looked at'],
    ['now-pov', 'pov', 'The head-camera frame Muse Spark looked at']]) {
    const img = $(id) ?? $(`${id}-fig`).insertAdjacentElement('afterbegin', Object.assign(document.createElement('img'), { id, alt, hidden: true }));
    img.onerror = () => { img.hidden = true; };
    img.onload = () => { img.hidden = false; };
    img.src = base ? `/${base}/frames/${name}_${String(start).padStart(4, '0')}.jpg` : '';
  }
}

function redraw() {
  view.nowAt = -1;
  view.labels = view.rows.map((r) => r.label);      // Meta Muse Spark's posture per second (pipeline/insights.py)
  drawStrip();
  drawLog();
  update();
  renderPostures();
}

function renderStats(total) {
  const active = Math.round(((total.share?.walking ?? 0) + (total.share?.['arms raised'] ?? 0)) * 100);
  $('day-stats').replaceChildren(iconTile('time', minutes(total.duration_min), 'recorded'),
    iconTile('walk', `${Math.round(total.walking_distance_m)} m`, 'walked'),
    iconTile('active', `${active}%`, 'walking or arms up'),
    iconTile('sit', String(total.sit_stand_transitions), `sit-downs · longest ${minutes(total.longest_sitting_min)}`));
}

// Time per posture as a donut; the biggest share in the middle.
function renderPostures() {
  const share = shareOf(view.labels);
  const R = 42, C = 2 * Math.PI * R;
  const donut = svgEl('svg', { viewBox: '0 0 120 120', class: 'day-donut', role: 'img',
    'aria-label': POSTURES.filter((p) => share[p] > 0).map((p) => `${p} ${Math.round(share[p] * 100)}%`).join(', ') });
  let at = 0;
  for (const p of POSTURES) {
    if (!(share[p] > 0)) continue;
    donut.appendChild(svgEl('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: POSTURE_COLORS[p], 'stroke-width': 18,
      'stroke-dasharray': `${share[p] * C} ${C}`, 'stroke-dashoffset': -at * C, transform: 'rotate(-90 60 60)' }));
    at += share[p];
  }
  const top = POSTURES.reduce((a, b) => (share[b] > share[a] ? b : a), POSTURES[0]);
  const big = svgEl('text', { x: 60, y: 60, 'text-anchor': 'middle', class: 'day-donut-big' });
  big.textContent = `${Math.round(share[top] * 100)}%`;
  const small = svgEl('text', { x: 60, y: 76, 'text-anchor': 'middle', class: 'day-donut-small' });
  small.textContent = top;
  donut.append(big, small);
  $('day-postures').replaceChildren(donut);
  $('day-legend').replaceChildren(...POSTURES.filter((p) => share[p] > 0).map((p) => {
    const item = el('li');
    const dot = el('span', 'day-dot');
    dot.style.background = POSTURE_COLORS[p];
    item.append(dot, `${capitalize(p)} ${Math.round(share[p] * 100)}%`);
    return item;
  }));
}

function renderReview(report) {
  const box = $('review');
  const r = report.report;
  if (!r) {
    box.replaceChildren(el('p', 'day-note', 'No review yet: run python -m director.routine_tips on this recording.'));
    drawTrack(null);
    return;
  }
  const chipList = (title, items, extraClass = '') => {
    const sec = el('section', `review-part ${extraClass}`.trim());
    sec.append(el('h3', '', title));
    const ul = el('ul', 'review-chips');
    ul.append(...items.slice(0, 3).map((t) => {
      const li = el('li', 'review-chip-item');
      li.append(el('span', 'review-bullet'), el('span', '', brief(t, 96)));
      return li;
    }));
    sec.appendChild(ul);
    return sec;
  };

  const headline = el('div', 'review-headline-box');
  headline.append(
    el('span', 'review-kicker', 'Session Takeaway'),
    el('p', 'review-summary', brief(r.summary, 180)),
  );

  const changes = el('section', 'review-part review-changes');
  changes.append(el('h3', '', 'Recommended habit adjustments'));
  const ol = el('ol', 'changes');
  ol.append(...(r.improvements ?? []).slice(0, 3).map((c, idx) => {
    const li = el('li');
    const t = firstTime(c.why) ?? firstTime(c.how);
    li.append(
      el('span', 'change-step-tag', `${idx + 1}${t !== null ? ` · ${clock(t)} on the timeline` : ''}`),
      el('strong', '', brief(c.change, 78)),
      el('span', 'change-why', brief(c.why ?? '', 90)),
      el('span', 'change-how', brief(c.how ?? '', 95)),
    );
    return li;
  }));
  changes.appendChild(ol);

  // what they did is on the timeline; "vs past" is a chart (renderHistory fills it) with Muse's first comparison
  const subgrid = el('div', 'review-subgrid');
  const vs = el('section', 'review-part review-history-callout');
  vs.append(el('h3', '', 'Vs. past routines'), Object.assign(el('div', 'vs-chart'), { id: 'vs-chart' }));
  if (r.compared_with_history?.length) vs.appendChild(el('p', 'vs-note', brief(r.compared_with_history[0], 150)));
  subgrid.appendChild(vs);
  if (r.went_well?.length) subgrid.appendChild(chipList('Went well', r.went_well));
  if (r.posture_and_movement?.length) {
    const more = el('details', 'review-more');
    more.append(el('summary', '', 'More from Muse Spark'), ...r.posture_and_movement.map((t) => el('p', '', t)));
    subgrid.appendChild(more);
  }

  const read = el('details', 'review-prompt');
  read.append(el('summary', '', 'View Meta Muse Spark prompt payload'), el('pre', '', r.prompt ?? 'Not saved with this review.'));
  box.replaceChildren(headline, changes, subgrid, read);
  drawTrack(r);
  $('review-source').textContent = `Meta Muse Spark · vs ${r.history?.length ?? 0} past`;
}

// ---------- Past Routines & Cross-Session Comparison ----------

// Past routines as one chart: a bar per session, its length the duration, split by posture; distance and sit-downs
// beside it; Open loads it. Also the "vs past" chart in the review: this session's minutes and metres against the rest.
async function renderHistory(current) {
  const { processed } = await fetchRecordings();
  const loaded = await Promise.all(processed.map(async (r) => ({
    r, ins: await getJson(r.files['insights.json']), post: await getJson(r.files['postures.json']).catch(() => null),
  })));
  $('past-count').textContent = `${loaded.length} session${loaded.length === 1 ? '' : 's'}`;
  const sum = (f) => loaded.reduce((a, x) => a + (f(x.ins?.total ?? {}) ?? 0), 0);
  $('past-summary').replaceChildren(iconTile('time', minutes(sum((t) => t.duration_min)), 'in all'),
    iconTile('walk', `${Math.round(sum((t) => t.walking_distance_m))} m`, 'walked'),
    iconTile('sit', String(sum((t) => t.sit_stand_transitions)), 'sit-downs'));
  const longest = Math.max(...loaded.map((x) => x.ins?.total?.duration_min ?? 0), 0.01);
  $('past-cards').replaceChildren(...loaded.map(({ r, ins, post }) => {
    const t = ins.total;
    const isCurrent = r.name === current?.name;
    const row = el('div', `past-row${isCurrent ? ' is-current-routine' : ''}`);
    const name = el('button', 'past-row-name', r.name);
    name.type = 'button';
    name.disabled = isCurrent;
    name.title = isCurrent ? 'Open now' : `Open ${r.name}`;
    name.addEventListener('click', async () => { await openRecording(r); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    const wrap = el('div', 'past-row-bar');
    const bar = stackedBar(shareOf(post?.labels?.rules ?? []));
    bar.style.width = `${(100 * t.duration_min) / longest}%`;
    wrap.appendChild(bar);
    row.append(name, wrap, el('span', 'past-row-num', `${minutes(t.duration_min)} · ${Math.round(t.walking_distance_m)} m · ${t.sit_stand_transitions} sit`));
    return row;
  }));
  const vs = $('vs-chart');
  if (!vs) return;
  const metrics = [['walked (m)', (t) => t.walking_distance_m, 'm'], ['walking (min)', (t) => t.minutes?.walking ?? 0, 'min'],
    ['standing (min)', (t) => t.minutes?.standing ?? 0, 'min'], ['sitting (min)', (t) => t.minutes?.sitting ?? 0, 'min']];
  vs.replaceChildren(...metrics.map(([label, f, unit]) => {
    const top = Math.max(...loaded.map((x) => f(x.ins.total)), 0.01);
    const row = el('div', 'vs-row');
    row.appendChild(el('span', 'vs-label', label));
    const bars = el('div', 'vs-bars');
    for (const { r, ins } of loaded) {
      const v = f(ins.total);
      const b = el('span', `vs-bar${r.name === current?.name ? ' is-current' : ''}`);
      b.style.width = `${(100 * v) / top}%`;
      b.title = `${r.name}: ${unit === 'm' ? Math.round(v) : v.toFixed(2)} ${unit}`;
      b.textContent = `${r.name} ${unit === 'm' ? Math.round(v) : v.toFixed(1)}`;
      bars.appendChild(b);
    }
    row.appendChild(bars);
    return row;
  }));
}

async function load(rec) {
  $('day-status').textContent = 'Loading';
  const [report, csv, muse] = await Promise.all([
    getJson(rec.files['insights.json']),
    fetch(rec.files['activity.csv'], { cache: 'no-store' }).then((r) => r.text()),
    getJson(rec.files['narration_muse.json']),
  ]);
  Object.assign(view, { rows: parseCsv(csv), captions: muse ?? [] });
  renderStats(report.total);
  redraw();
  renderReview(report);
  drawSpeed();
  $('day-status').textContent = [rec.name, clock(view.rows.length), rec.camera?.label].filter(Boolean).join(' · ');
  await renderHistory(rec);
}

video.addEventListener('timeupdate', update);
video.addEventListener('seeked', update);

const strip = $('routine-strip');
const secondAt = (e) => {
  const rect = strip.getBoundingClientRect();
  return Math.min(Math.max(Math.floor(((e.clientX - rect.left) / rect.width) * view.labels.length), 0), view.labels.length - 1);
};
strip.addEventListener('pointerdown', (e) => media.seek(secondAt(e) + 0.05));
strip.addEventListener('pointermove', (e) => { if (e.buttons) media.seek(secondAt(e) + 0.05); else $('routine-caption').textContent = describe(secondAt(e)); });
strip.addEventListener('pointerleave', update);
strip.addEventListener('keydown', (e) => {
  const s = Math.floor(video.currentTime || 0);
  const to = { ArrowRight: s + 1, ArrowUp: s + 1, ArrowLeft: s - 1, ArrowDown: s - 1, PageUp: s + 10, PageDown: s - 10,
    Home: 0, End: view.labels.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  media.seek(Math.min(Math.max(to, 0), view.labels.length - 1) + 0.05);
});

document.addEventListener('lifelens:session', () => {
  const hasRec = Boolean(session.rec);
  document.body.classList.toggle('no-recording', !hasRec);
  for (const id of ['routine-current-summary', 'routine-current-timeline', 'routine-current-review']) {
    const sec = $(id);
    if (sec) sec.hidden = !hasRec;
  }
  if (hasRec) {
    load(session.rec).catch((err) => { $('day-status').textContent = `Not loaded: ${err.message}`; });
  } else if (session.live) {
    renderHistory(null).catch(() => {});
  }
});
