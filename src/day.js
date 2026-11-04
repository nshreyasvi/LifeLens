// LifeLens front-end: Activity, Routine & Past Routines workspace inside the Routine view.
// Uses the main POV + 3D body media player (extras.js) directly—no duplicate video elements—and showcases
// the active session's posture timeline, timestamped action log, past routine comparisons, and Meta Muse Spark coaching.

import { media } from './extras.js';
import { fetchRecordings, openRecording, session } from './session.js';

const POSTURES = ['walking', 'standing', 'sitting', 'crouching', 'bending', 'arms raised'];
const POSTURE_COLORS = {
  walking: 'var(--p-walking)', standing: 'var(--p-standing)', sitting: 'var(--p-sitting)',
  crouching: 'var(--p-crouching)', bending: 'var(--p-bending)', 'arms raised': 'var(--p-arms)',
};
const SOURCES = {
  rules: { name: '3D Rules', how: '3D kinematics thresholds (speed, hip height, knee flexion & trunk lean) per second.' },
  muse: { name: 'Muse Spark', how: 'Meta Muse Spark classifies each 5 s window from 3D kinematics + egocentric scene.' },
  combined: { name: 'Combined', how: 'Consensus of 3D biomechanical rules and Meta Muse Spark posture classification.' },
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
const view = { rows: [], postures: null, captions: [], source: 'rules', labels: [],
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
  strip.setAttribute('aria-label', `Posture each second, from ${SOURCES[view.source].name}`);
  strip.setAttribute('aria-valuemin', '0');
  strip.setAttribute('aria-valuemax', String(view.labels.length - 1));
  $('strip-source-name').textContent = SOURCES[view.source].name;
  const mocap = view.postures?.labels?.mocap;
  $('routine-ref').closest('.strip-row').hidden = !mocap;
  if (mocap) drawRuns($('routine-ref'), mocap);
}

function drawLog() {
  view.entries = entriesFromMuse();
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
    btn.addEventListener('click', () => {
      media.seek(e.start + 0.05);
      media.play();
    });
    li.appendChild(btn);
    return li;
  });
  $('routine-log').replaceChildren(...view.items);
  view.current = -1;
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
  view.source = SOURCES[source] ? source : 'rules';
  for (const b of $('posture-switch').children) b.setAttribute('aria-pressed', String(b.dataset.source === view.source));
  const a = view.postures?.agreement;
  const match = a && Number.isFinite(a[view.source]) ? ` · ${Math.round(a[view.source] * 100)}% mocap match` : '';
  $('posture-how').textContent = `${SOURCES[view.source].how}${match}`;
  redraw();
}

function renderStats(total) {
  const walkShare = Math.round(((total.share?.walking ?? 0) + (total.share?.['arms raised'] ?? 0)) * 100);
  const stats = [
    ['Duration', minutes(total.duration_min)],
    ['Distance', `${Math.round(total.walking_distance_m)} m`],
    ['Active ratio', `${walkShare}%`],
    ['Sit transitions', `${total.sit_stand_transitions} · max ${minutes(total.longest_sitting_min)}`],
  ];
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

function renderReview(report) {
  const box = $('review');
  const r = report.report;
  if (!r) {
    box.replaceChildren(el('p', 'day-note', 'No review yet: run python -m director.routine_tips on this recording.'));
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
    li.append(
      el('span', 'change-step-tag', `Action ${idx + 1}`),
      el('strong', '', brief(c.change, 78)),
      el('span', 'change-why', brief(c.why ?? '', 90)),
      el('span', 'change-how', brief(c.how ?? '', 95)),
    );
    return li;
  }));
  changes.appendChild(ol);

  const subgrid = el('div', 'review-subgrid');
  if (r.compared_with_history?.length) subgrid.appendChild(chipList('Vs. past routines', r.compared_with_history, 'review-history-callout'));
  if (r.what_they_did?.length) subgrid.appendChild(chipList('Observed activities', r.what_they_did));
  if (r.posture_and_movement?.length) subgrid.appendChild(chipList('Biomechanical notes', r.posture_and_movement));
  if (r.went_well?.length) subgrid.appendChild(chipList('Positive habits', r.went_well));

  const read = el('details', 'review-prompt');
  read.append(el('summary', '', 'View Meta Muse Spark prompt payload'), el('pre', '', r.prompt ?? 'Not saved with this review.'));
  box.replaceChildren(headline, changes, subgrid, read);
  $('review-source').textContent = `Meta Muse Spark · vs ${r.history?.length ?? 0} past`;
}

// ---------- Past Routines & Cross-Session Comparison ----------

async function renderHistory(current) {
  const { processed } = await fetchRecordings();
  const loaded = await Promise.all(processed.map(async (r) => ({
    r,
    ins: await getJson(r.files['insights.json']),
    post: await getJson(r.files['postures.json']).catch(() => null),
  })));

  $('past-count').textContent = `${loaded.length} session${loaded.length === 1 ? '' : 's'}`;

  const totalMin = loaded.reduce((s, x) => s + (x.ins?.total?.duration_min ?? 0), 0);
  const totalWalkM = loaded.reduce((s, x) => s + (x.ins?.total?.walking_distance_m ?? 0), 0);
  const totalSits = loaded.reduce((s, x) => s + (x.ins?.total?.sit_stand_transitions ?? 0), 0);
  const avgWalkShare = loaded.length
    ? Math.round((loaded.reduce((s, x) => s + (x.ins?.total?.share?.walking ?? 0), 0) / loaded.length) * 100)
    : 0;

  const summaryItems = [
    ['Total time', minutes(totalMin)],
    ['Total distance', `${Math.round(totalWalkM)} m`],
    ['Avg walking', `${avgWalkShare}%`],
    ['Sit transitions', String(totalSits)],
  ];
  $('past-summary').replaceChildren(...summaryItems.map(([label, val]) => {
    const item = el('div', 'past-sum-item');
    item.append(el('span', 'past-sum-val', val), el('span', 'past-sum-label', label));
    return item;
  }));

  const sorted = [...loaded].sort((a, b) => {
    if (a.r.name === current?.name) return 1;
    if (b.r.name === current?.name) return -1;
    return a.r.name.localeCompare(b.r.name);
  });
  const curIns = loaded.find((x) => x.r.name === current?.name)?.ins?.total;

  $('past-cards').replaceChildren(...sorted.map(({ r, ins, post }) => {
    const isCurrent = r.name === current?.name;
    const t = ins.total;
    const share = shareOf(post?.labels?.rules ?? []);
    const card = el('article', `past-card ${isCurrent ? 'is-current-routine' : 'is-past-routine'}`);

    const head = el('div', 'past-card-head');
    const titleWrap = el('div', 'past-card-title');
    titleWrap.append(
      el('h3', 'past-card-name', r.name),
      el('span', `badge ${isCurrent ? 'badge-current' : 'badge-past'}`, isCurrent ? 'Active' : 'Past routine'),
    );
    head.appendChild(titleWrap);

    if (!isCurrent) {
      const btn = el('button', 'btn btn-small-text', 'Load routine');
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        await openRecording(r);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      head.appendChild(btn);
    }

    const barWrap = el('div', 'past-card-bar');
    barWrap.appendChild(stackedBar(share));
    const topPostures = POSTURES
      .filter((p) => share[p] >= 0.02)
      .sort((a, b) => share[b] - share[a])
      .map((p) => `${capitalize(p)} ${Math.round(share[p] * 100)}%`)
      .join(' · ');
    barWrap.appendChild(el('p', 'past-card-shares', topPostures));

    const metrics = el('dl', 'past-card-metrics');
    for (const [k, v] of [
      ['Duration', minutes(t.duration_min)],
      ['Walked', `${Math.round(t.walking_distance_m)} m`],
      ['Sit-downs', String(t.sit_stand_transitions)],
      ['Max sit', minutes(t.longest_sitting_min)],
    ]) {
      const cell = el('div');
      cell.append(el('dt', '', k), el('dd', '', v));
      metrics.appendChild(cell);
    }

    card.append(head, barWrap, metrics);

    if (!isCurrent && curIns) {
      const dWalk = Math.round(t.walking_distance_m - curIns.walking_distance_m);
      const dWalkPct = Math.round(((t.share?.walking ?? 0) - (curIns.share?.walking ?? 0)) * 100);
      const deltaText = `${dWalk >= 0 ? `+${dWalk}` : dWalk} m vs ${current.name} · `
        + `${dWalkPct >= 0 ? `+${dWalkPct}` : dWalkPct}% walking`;
      card.appendChild(el('p', 'past-card-delta', deltaText));
    }
    return card;
  }));

  const table = $('days-table');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(...['Session', 'Status', 'Posture split', 'Duration', 'Walked', 'Muse match', ''].map((t) => Object.assign(el('th', '', t), { scope: 'col' })));
  thead.appendChild(hr);
  const tbody = el('tbody');
  for (const { r, ins, post } of sorted) {
    const isCurrent = r.name === current?.name;
    const tr = el('tr');
    const barTd = el('td');
    barTd.appendChild(stackedBar(shareOf(post?.labels?.rules ?? [])));
    const a = post?.agreement;
    const actionTd = el('td');
    if (!isCurrent) {
      const open = el('button', 'btn btn-small-text', 'Open');
      open.type = 'button';
      open.addEventListener('click', () => {
        openRecording(r);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      actionTd.appendChild(open);
    } else {
      actionTd.appendChild(el('span', 'past-active-tag', 'Active'));
    }
    tr.append(
      Object.assign(el('th', '', r.name), { scope: 'row' }),
      el('td', '', isCurrent ? 'Current' : 'Past'),
      barTd,
      el('td', 'num', minutes(ins.total.duration_min)),
      el('td', 'num', `${Math.round(ins.total.walking_distance_m)} m`),
      el('td', 'num', a && Number.isFinite(a.muse) ? `${Math.round(a.muse * 100)}%` : 'Muse Spark'),
      actionTd,
    );
    tbody.appendChild(tr);
  }
  table.replaceChildren(thead, tbody);
}

async function load(rec) {
  $('day-status').textContent = 'Loading';
  const [report, csv, postures, muse] = await Promise.all([
    getJson(rec.files['insights.json']),
    fetch(rec.files['activity.csv'], { cache: 'no-store' }).then((r) => r.text()),
    getJson(rec.files['postures.json']),
    getJson(rec.files['narration_muse.json']),
  ]);
  Object.assign(view, { rows: parseCsv(csv), postures, captions: muse ?? [] });
  $('posture-switch').closest('.posture-pick').hidden = !postures;
  renderStats(report.total);
  renderReview(report);
  pickSource('rules');
  $('day-status').textContent = `${rec.name} · ${clock(view.rows.length)}`;
  await renderHistory(rec);
}

for (const b of $('posture-switch').children) b.addEventListener('click', () => pickSource(b.dataset.source));
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
