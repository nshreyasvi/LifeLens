// LifeLens front-end: Day tab (daily routine view)
// Reads the day report made by pipeline/insights.py (copied to public/day/)
// and shows time per posture, a second-by-second timeline and suggestions.
// It works on its own and does not change the Activity or Stage tabs.

const INSIGHTS_URL = 'day/insights.json';
const ACTIVITY_URL = 'day/activity.csv';

const POSTURES = ['walking', 'standing', 'sitting', 'crouching', 'bending', 'arms raised'];
const POSTURE_COLORS = {
  walking: '#31A24C',
  standing: '#8A8D91',
  sitting: '#0866FF',
  crouching: '#F7B928',
  bending: '#A259FF',
  'arms raised': '#FF7A45',
};
const CLIP_NAMES = { office: 'Office', outdoor: 'Outdoor', robothome: 'Home' };

const $ = (id) => document.getElementById(id);
const clipName = (key) => CLIP_NAMES[key] ?? key;
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function formatMinutes(min) {
  if (!Number.isFinite(min)) return '—';
  if (min < 1) return `${Math.round(min * 60)} s`;
  return `${min.toFixed(1)} min`;
}

function formatClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Small CSV reader: handles quoted fields with commas and "" escapes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
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

function stackedBar(share, label) {
  const bar = document.createElement('div');
  bar.className = 'day-bar';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', label);
  for (const p of POSTURES) {
    const v = share?.[p] ?? 0;
    if (v <= 0) continue;
    const seg = document.createElement('span');
    seg.style.width = `${v * 100}%`;
    seg.style.background = POSTURE_COLORS[p];
    seg.title = `${capitalize(p)}: ${Math.round(v * 100)}%`;
    bar.appendChild(seg);
  }
  return bar;
}

function shareLabel(share) {
  return POSTURES.filter((p) => (share?.[p] ?? 0) >= 0.01)
    .map((p) => `${p} ${Math.round(share[p] * 100)}%`).join(', ');
}

function renderStats(total) {
  const stats = [
    ['Recorded', formatMinutes(total.duration_min)],
    ['Walked', `${Math.round(total.walking_distance_m)} m`],
    ['Sit-downs', String(total.sit_stand_transitions)],
    ['Longest sit', formatMinutes(total.longest_sitting_min)],
  ];
  const box = $('day-stats');
  box.innerHTML = '';
  for (const [name, value] of stats) {
    const tile = document.createElement('div');
    tile.className = 'day-stat';
    const v = document.createElement('span');
    v.className = 'day-stat-value';
    v.textContent = value;
    const n = document.createElement('span');
    n.className = 'day-stat-name';
    n.textContent = name;
    tile.append(v, n);
    box.appendChild(tile);
  }
}

function renderPostures(report) {
  const box = $('day-postures');
  box.innerHTML = '';

  const all = document.createElement('div');
  all.className = 'day-row day-row-total';
  const allName = document.createElement('span');
  allName.className = 'day-row-name';
  allName.textContent = 'Whole day';
  all.append(allName, stackedBar(report.total.share, `Whole day: ${shareLabel(report.total.share)}`));
  box.appendChild(all);

  for (const [key, clip] of Object.entries(report.clips)) {
    const row = document.createElement('div');
    row.className = 'day-row';
    const name = document.createElement('span');
    name.className = 'day-row-name';
    name.textContent = `${clipName(key)} · ${formatMinutes(clip.duration_min)}`;
    row.append(name, stackedBar(clip.share, `${clipName(key)}: ${shareLabel(clip.share)}`));
    box.appendChild(row);
  }

  const legend = $('day-legend');
  legend.innerHTML = '';
  for (const p of POSTURES) {
    const min = report.total.minutes?.[p] ?? 0;
    if (min <= 0) continue;
    const item = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'day-dot';
    dot.style.background = POSTURE_COLORS[p];
    item.append(dot, `${capitalize(p)} ${formatMinutes(min)}`);
    legend.appendChild(item);
  }
}

function renderTimeline(rows) {
  const box = $('day-strips');
  const caption = $('day-caption');
  box.innerHTML = '';
  const byClip = new Map();
  for (const r of rows) {
    if (!byClip.has(r.clip)) byClip.set(r.clip, []);
    byClip.get(r.clip).push(r);
  }

  const show = (r) => {
    caption.textContent = `${clipName(r.clip)} ${formatClock(Number(r.second))} · ${capitalize(r.label)}${r.narration ? ` · ${r.narration}` : ''}`;
  };

  for (const [clip, list] of byClip) {
    const row = document.createElement('div');
    row.className = 'day-row';
    const name = document.createElement('span');
    name.className = 'day-row-name';
    name.textContent = clipName(clip);
    const strip = document.createElement('div');
    strip.className = 'day-strip';
    for (const r of list) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'day-cell';
      cell.style.background = POSTURE_COLORS[r.label] ?? 'var(--surface-solid)';
      cell.setAttribute('aria-label', `${clipName(clip)} ${formatClock(Number(r.second))}, ${r.label}`);
      cell.addEventListener('mouseenter', () => show(r));
      cell.addEventListener('focus', () => show(r));
      cell.addEventListener('click', () => show(r));
      strip.appendChild(cell);
    }
    row.append(name, strip);
    box.appendChild(row);
  }
}

function renderSummary(report) {
  const box = $('day-summary');
  box.innerHTML = '';
  const parts = String(report.summary || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  // The second paragraph holds the suggestions; fall back to whatever is there.
  const text = parts[1] ?? parts[0];
  if (!text) {
    box.textContent = 'No summary in this report.';
    return;
  }
  const p = document.createElement('p');
  p.textContent = text;
  box.appendChild(p);
  const model = report.model ? report.model.split('/').pop() : 'a language model';
  $('day-summary-note').textContent = `Written by ${model} from the day's posture log.`;
}

// Hide Play / Pause / Restart while the Day tab is open: they drive the
// Activity and Stage demos, not this view.
function watchTab() {
  const view = $('view-day');
  const sync = () => document.body.classList.toggle('on-day', !view.hidden);
  new MutationObserver(sync).observe(view, { attributes: true, attributeFilter: ['hidden'] });
  sync();
}

async function load() {
  watchTab();
  try {
    const [reportRes, csvRes] = await Promise.all([
      fetch(INSIGHTS_URL, { cache: 'no-store' }),
      fetch(ACTIVITY_URL, { cache: 'no-store' }),
    ]);
    if (!reportRes.ok || !csvRes.ok) throw new Error('Day report files are missing.');
    const report = await reportRes.json();
    const rows = parseCsv(await csvRes.text());
    renderStats(report.total);
    renderPostures(report);
    renderTimeline(rows);
    renderSummary(report);
    $('day-status').textContent = `${Object.keys(report.clips).length} clips`;
  } catch (err) {
    console.error(err);
    $('day-status').textContent = 'Not loaded';
    $('day-caption').textContent = 'Could not load the day report (public/day/).';
  }
}

load();
