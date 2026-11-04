// LifeLens front-end: Routine tab, for the open recording.
// From its day report (pipeline/insights.py), posture sources (bench/posture_sources.py), Muse's captions
// (pipeline/describe_muse.py) and Muse's review (director/routine_tips.py): what the wearer did, played with its POV
// and 3D body; posture by rules, Muse, Qwen or their vote; the review; and the other recordings as history.

import { mediaSet } from './media.js';
import { fetchRecordings, openRecording, session } from './session.js';

const POSTURES = ['walking', 'standing', 'sitting', 'crouching', 'bending', 'arms raised'];
// Same hue per posture as the pipeline's activity.png (README), in this page's palette.
// Per-theme colors in styles.css (--p-*), checked for color-blind separation (docs/brand/palette.json).
const POSTURE_COLORS = {
  walking: 'var(--p-walking)', standing: 'var(--p-standing)', sitting: 'var(--p-sitting)',
  crouching: 'var(--p-crouching)', bending: 'var(--p-bending)', 'arms raised': 'var(--p-arms)',
};
const CAPTIONS_KEY = 'lifelens-captions';
const savedCaptions = () => { try { return localStorage.getItem(CAPTIONS_KEY) === 'muse' ? 'muse' : 'qwen'; } catch { return 'qwen'; } };
const SOURCES = {
  rules: { name: 'Rules', how: 'Fixed thresholds on the 3D body\'s speed, hip height, knee angle and trunk lean, every second.' },
  muse: { name: 'Muse Spark', how: 'Meta Muse Spark reads each 5 s window\'s body numbers and description and names the posture.' },
  qwen: { name: 'Qwen3-VL', how: 'Qwen3-VL-2B watches each 5 s of head-camera video and names the posture.' },
  combined: { name: 'Combined', how: 'Each second, the posture at least two of the three name; when all three differ, the rules\'.' },
};

const $ = (id) => document.getElementById(id);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const el = (tag, className, text) => Object.assign(document.createElement(tag), className ? { className } : {},
  text === undefined ? {} : { textContent: text });
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const minutes = (m) => (!Number.isFinite(m) ? '-' : m < 1 ? `${Math.round(m * 60)} s` : `${m.toFixed(1)} min`);
const tidy = (t) => { const s = t.replace(/^the (camera )?(wearer|person)\s+(is\s+)?/i, '').trim(); return s ? capitalize(s) : ''; };
const getJson = async (url) => (url ? (await fetch(url, { cache: 'no-store' })).json() : null);

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

// ---------- This recording ----------

const media = mediaSet($('routine-media'));
const video = media.body;
const view = { rows: [], postures: null, captions: { qwen: [], muse: [] }, source: 'rules', cap: savedCaptions(), labels: [],
  entries: [], items: [], current: -1, marker: null };

function entriesFrom(kind) {
  if (kind === 'muse' && view.captions.muse.length) {
    return view.captions.muse.filter((c) => !c.text.startsWith('[')).map((c) => ({ start: c.start_s, end: Math.ceil(c.end_s), text: tidy(c.text) }));
  }
  const out = [];
  for (const r of view.rows) { // consecutive seconds with the same Qwen narration make one line
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
  strip.setAttribute('aria-label', `Posture each second, from ${SOURCES[view.source].name}`);
  strip.setAttribute('aria-valuemin', '0');
  strip.setAttribute('aria-valuemax', String(view.labels.length - 1));
  $('strip-source-name').textContent = SOURCES[view.source].name;
  const mocap = view.postures?.labels?.mocap;
  $('routine-ref').closest('.strip-row').hidden = !mocap;
  if (mocap) drawRuns($('routine-ref'), mocap);
}

function drawLog() {
  view.entries = entriesFrom(view.cap);
  view.items = view.entries.map((e) => {
    const li = el('li', 'log-item');
    const btn = el('button', 'log-btn');
    btn.type = 'button';
    const label = majorityOf(view.labels.slice(e.start, e.end));
    const dot = el('span', 'day-dot');
    dot.style.background = POSTURE_COLORS[label] ?? 'var(--faint)';
    const posture = el('span', 'log-posture');
    posture.append(dot, capitalize(label));
    btn.append(el('time', 'log-time', clock(e.start)), el('span', 'log-text', e.text), posture);
    btn.addEventListener('click', () => { media.seek(e.start + 0.05); media.play(); });
    li.appendChild(btn);
    return li;
  });
  $('routine-log').replaceChildren(...view.items);
  view.current = -1;
}

function update() {
  if (!view.labels.length) return;
  const s = Math.min(Math.max(Math.floor(video.currentTime || 0), 0), view.labels.length - 1);
  view.marker.style.left = `${((s + 0.5) / view.labels.length) * 100}%`;
  const strip = $('routine-strip');
  strip.setAttribute('aria-valuenow', String(s));
  strip.setAttribute('aria-valuetext', describe(s));
  $('routine-clock').textContent = `${clock(s)} / ${clock(view.labels.length)}`;
  $('routine-caption').textContent = describe(s);
  const i = view.entries.findIndex((e) => s >= e.start && s < e.end);
  if (i === view.current) return;
  view.items[view.current]?.classList.remove('is-current');
  view.current = i;
  const item = view.items[i];
  if (!item) return;
  item.classList.add('is-current');
  const log = $('routine-log');
  if (!log.closest('[hidden]')) log.scrollTo({ top: item.offsetTop - log.clientHeight / 2 + item.offsetHeight / 2, behavior: 'smooth' });
}

function redraw() {
  view.labels = view.postures?.labels?.[view.source] ?? view.rows.map((r) => r.label);
  drawStrip();
  drawLog();
  update();
  renderPostures();
}

function pickSource(source) {
  view.source = source;
  for (const b of $('posture-switch').children) b.setAttribute('aria-pressed', String(b.dataset.source === source));
  const a = view.postures?.agreement;
  $('posture-how').textContent = SOURCES[source].how + (a ? ` Agrees with the motion capture ${Math.round(a[source] * 100)}% of the time; `
    + `saying "standing" every second scores ${Math.round(a.always_standing * 100)}%. The motion capture is labelled with the rules' `
    + 'thresholds, so it favors the rules.' : '');
  redraw();
}

// The header switch: which model's captions the Routine shows and the director reads (main.js), remembered here.
function pickCaptions(cap, save = true) {
  if (save) { view.cap = cap; try { localStorage.setItem(CAPTIONS_KEY, cap); } catch { /* private window */ } }
  const shown = cap === 'muse' && view.captions.muse.length ? 'muse' : 'qwen';
  for (const b of $('caption-switch').children) b.setAttribute('aria-pressed', String(b.dataset.captions === view.cap));
  $('did-captions').textContent = shown === 'muse' ? 'Muse Spark captions' : 'Qwen3-VL captions';
  drawLog();
  update();
}

function renderStats(total) {
  const stats = [['Recorded', minutes(total.duration_min)], ['Walked', `${Math.round(total.walking_distance_m)} m`],
    ['Sit-downs', String(total.sit_stand_transitions)], ['Longest sit', minutes(total.longest_sitting_min)]];
  $('day-stats').replaceChildren(...stats.map(([name, value]) => {
    const tile = el('div', 'day-stat');
    tile.append(el('span', 'day-stat-value', value), el('span', 'day-stat-name', name));
    return tile;
  }));
}

function renderPostures() {
  const share = shareOf(view.labels);
  const row = el('div', 'day-row day-row-total');
  row.append(el('span', 'day-row-name', SOURCES[view.source].name), stackedBar(share));
  $('day-postures').replaceChildren(row);
  $('day-legend').replaceChildren(...POSTURES.filter((p) => share[p] > 0).map((p) => {
    const item = el('li');
    const dot = el('span', 'day-dot');
    dot.style.background = POSTURE_COLORS[p];
    item.append(dot, `${capitalize(p)} ${Math.round(share[p] * 100)}%`);
    return item;
  }));
}

// Muse's review: summary, what they did, posture, history, changes (with why and how), what went well, caveats.
function renderReview(report) {
  const box = $('review');
  const r = report.report;
  if (!r) {
    box.replaceChildren(el('p', 'day-note', 'No review yet: run python -m director.routine_tips on this recording.'));
    return;
  }
  const list = (title, items) => {
    const sec = el('section', 'review-part');
    sec.append(el('h3', '', title));
    const ul = el('ul');
    ul.append(...items.map((t) => el('li', '', t)));
    sec.appendChild(ul);
    return sec;
  };
  const changes = el('section', 'review-part review-changes');
  changes.append(el('h3', '', 'What to change'));
  const ol = el('ol', 'changes');
  ol.append(...r.improvements.map((c) => {
    const li = el('li');
    li.append(el('strong', '', c.change), el('span', 'change-why', c.why ?? ''), el('span', 'change-how', c.how ?? ''));
    return li;
  }));
  changes.appendChild(ol);
  const read = el('details', 'review-prompt');
  read.append(el('summary', '', 'What Muse read'), el('pre', '', r.prompt ?? 'Not saved with this review.'));
  box.replaceChildren(el('p', 'review-summary', r.summary), changes,
    list('What they did', r.what_they_did ?? []), list('Posture and movement', r.posture_and_movement ?? []),
    list('Compared with history', r.compared_with_history ?? []), list('What went well', r.went_well ?? []),
    list('What the data can\'t tell', r.caveats ?? []), read);
  $('review-source').textContent = `${r.provider}, vs ${r.history?.length ?? 0} recordings`;
}

// ---------- History: the other processed recordings ----------

async function renderHistory(current) {
  const table = $('days-table');
  const { processed } = await fetchRecordings();
  const others = processed.filter((r) => r.name !== current.name);
  const loaded = await Promise.all(others.map(async (r) => ({ r, ins: await getJson(r.files['insights.json']),
    post: await getJson(r.files['postures.json']).catch(() => null) })));
  const head = el('thead');
  const hr = el('tr');
  hr.append(...['Recording', 'Posture', 'Recorded', 'Walked', 'Muse / Qwen', ''].map((t) => Object.assign(el('th', '', t), { scope: 'col' })));
  head.appendChild(hr);
  const body = el('tbody');
  for (const { r, ins, post } of loaded) {
    const tr = el('tr');
    const bar = el('td');
    bar.appendChild(stackedBar(shareOf(post?.labels?.rules ?? [])));
    const a = post?.agreement;
    const open = el('button', 'btn btn-small-text', 'Open');
    open.type = 'button';
    open.addEventListener('click', () => openRecording(r));
    const td = el('td');
    td.appendChild(open);
    tr.append(Object.assign(el('th', '', r.name), { scope: 'row' }), bar, el('td', 'num', minutes(ins.total.duration_min)),
      el('td', 'num', `${Math.round(ins.total.walking_distance_m)} m`),
      el('td', 'num', a ? `${Math.round(a.muse * 100)}% / ${Math.round(a.qwen * 100)}%` : '-'), td);
    body.appendChild(tr);
  }
  table.replaceChildren(head, body);
}

async function load(rec) {
  $('day-status').textContent = 'Loading';
  const [report, csv, postures, muse] = await Promise.all([getJson(rec.files['insights.json']),
    fetch(rec.files['activity.csv']).then((r) => r.text()), getJson(rec.files['postures.json']),
    getJson(rec.files['narration_muse.json'])]);
  Object.assign(view, { rows: parseCsv(csv), postures, captions: { muse: muse ?? [] } });
  $('posture-switch').closest('.posture-pick').hidden = !postures;
  media.setSources({ pov: rec.pov, body: rec.body });
  renderStats(report.total);
  renderReview(report);
  pickCaptions(view.cap, false);
  pickSource('rules');
  $('day-status').textContent = `${rec.name} · ${clock(view.rows.length)}`;
  renderHistory(rec).catch(() => {});
}

for (const b of $('posture-switch').children) b.addEventListener('click', () => pickSource(b.dataset.source));
for (const b of $('caption-switch').children) b.addEventListener('click', () => pickCaptions(b.dataset.captions));
const playBtn = $('routine-play');
const syncPlay = () => {
  const playing = !video.paused && !video.ended;
  playBtn.dataset.state = playing ? 'pause' : 'play';
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
};
playBtn.addEventListener('click', () => (video.paused || video.ended ? media.play() : media.pause()));
for (const ev of ['play', 'pause', 'ended']) video.addEventListener(ev, syncPlay);
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
document.addEventListener('lifelens:tab', (e) => { if (e.detail.tab !== 'day') media.pause(); });
document.addEventListener('lifelens:leave', () => media.pause());
document.addEventListener('lifelens:session', () => {
  document.body.classList.toggle('no-recording', !session.rec);
  if (session.rec) load(session.rec).catch((err) => { $('day-status').textContent = `Not loaded: ${err.message}`; });
});
// Routine has nothing to drive Play: hide Play and Restart while it is open.
const dayView = $('view-day');
new MutationObserver(() => document.body.classList.toggle('on-day', !dayView.hidden)).observe(dayView, { attributes: true, attributeFilter: ['hidden'] });
