// LifeLens front-end: the director's live messages for the open recording, and what the 3D body does at each moment,
// shown on Routine, Music, Stage, and Gym.
// - Unified Video + Music Player: pressing Play (above the video or on the music bar) plays both the video and the
//   matched song for the current ~20 s window in lockstep; crossing into a new ~20 s window or scrubbing the video
//   switches the song automatically. Clips of 20-30 s use 1 song; clips under 10 s show a quirky warm-up card.

import { buildQuirkyCard, media } from './extras.js';
import { bodyFeatures, clamp01, session } from './session.js';
import { FIXTURES, resetStage, updateStage } from './stage.js';

const LIVE_URL = 'ws://127.0.0.1:8765';
const LIVE_RETRY_MS = 5000;
const LIVE_STARTING_RETRY_MS = 400;
const LIVE_START_TIMEOUT_MS = 20000;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const ENERGY_ORDER = ['low', 'medium', 'high'];
const ACTION_LABELS = { flash_light: 'Flash light', dim: 'Dim', change_color: 'Change color' };
const MOOD_RANGES = { calm: [60, 80], curious: [80, 110], joyful: [110, 140], tense: [90, 120], powerful: [120, 160] };
const MOOD_VALENCE = { calm: 0, curious: 0.05, joyful: 0.25, tense: -0.2, powerful: 0.15 };
const COLOR_NAMES = [
  ['White', '#FFFFFF'], ['Warm white', '#FFF1D6'], ['Red', '#E53935'], ['Coral', '#FF6F59'], ['Orange', '#FB8C00'],
  ['Amber', '#F59E0B'], ['Yellow', '#FDD835'], ['Lime', '#9CCC65'], ['Green', '#43A047'], ['Teal', '#14B8A6'],
  ['Cyan', '#00BCD4'], ['Sky blue', '#4FC3F7'], ['Blue', '#3977FF'], ['Indigo', '#3F51B5'], ['Violet', '#9A55E8'],
  ['Purple', '#7B1FA2'], ['Pink', '#F48FB1'], ['Rose', '#F43F5E'], ['Brown', '#8D6E63'], ['Gray', '#9E9E9E'], ['Black', '#1C1E21'],
];

const $ = (id) => document.getElementById(id);
const els = {
  error: $('error'), playBtn: $('play-btn'), playLabel: $('play-label'), restartBtn: $('restart-btn'),
  progressLabel: $('progress-label'), progressFill: $('progress-fill'), tabs: $('tabs'),
  tabBtns: [...document.querySelectorAll('[role="tab"]')], views: [...document.querySelectorAll('[role="tabpanel"]')],
  ambient: $('ambient'), bulbs: $('bulbs'),
  lightsAction: $('lights-action'), lightsEnergy: $('lights-energy'), lightsMood: $('lights-mood'),
  lightsSwatch: $('lights-swatch'), lightsColor: $('lights-color'), lightsReason: $('lights-reason'),
  musicPanel: $('music-panel'), musicState: $('music-state'), beats: [...document.querySelectorAll('.beat')],
  tempoValue: $('tempo-value'), tempoLabel: $('tempo-label'), songsMood: $('songs-mood'), songList: $('song-list'),
  songsNote: $('songs-note'), player: $('player'), playerEmbed: $('player-embed'), playerBeat: $('player-beat'),
  playerNote: $('player-note'), chainState: $('chain-state'), chainWindow: $('chain-window'),
  features: $('music-features'), body: document.querySelector('#media [data-pane="body"] video'),
};

const state = { phase: 'idle', starting: false, videoPlaying: false, cues: [], liveCount: 0, last: null, master: 1, color: '#3977FF' };

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const word = (v) => (typeof v === 'string' && /^[a-z][a-z -]{0,23}$/i.test(v.trim()) ? v.trim().toLowerCase() : '');
const clock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

function emit(name, detail) {
  document.dispatchEvent(new CustomEvent(`lifelens:${name}`, { detail }));
}

function isValidMessage(m) {
  return m && ENERGY_ORDER.includes(m.energy) && Object.hasOwn(ACTION_LABELS, m.action) && Number.isFinite(m.music_tempo);
}

// ---------- Tabs ----------

function selectTab(name, { focus = false } = {}) {
  for (const btn of els.tabBtns) {
    const on = btn.dataset.tab === name;
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
    if (on && focus) btn.focus();
  }
  for (const view of els.views) view.hidden = view.dataset.view !== name;
  const routineDeck = $('view-day');
  if (routineDeck) routineDeck.hidden = name !== 'activity';
  $('gym-deck').hidden = name !== 'gym';
  els.player.hidden = !['music', 'stage', 'gym'].includes(name);
  const dock = $('music-dock'), bar = els.player.querySelector('.player-bar') ?? dock.querySelector('.player-bar');
  if (name === 'music') dock.append(bar, $('song-queue'));
  else { els.player.querySelector('.player-embed').before(bar); $('song-queue-home').append($('song-queue')); }
  dock.hidden = name !== 'music';
  const rig = document.querySelector('.panel-lights');
  if (name === 'stage') $('stage-dock').append(rig);
  else $('view-stage').append(rig);
  $('stage-dock').hidden = name !== 'stage' || session.active === false;
  emit('tab', { tab: name });
}

function onTabKeydown(e) {
  const i = els.tabBtns.indexOf(document.activeElement);
  if (i === -1) return;
  const last = els.tabBtns.length - 1;
  const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  selectTab(els.tabBtns[next].dataset.tab, { focus: true });
}

// ---------- Director messages: energy, cues, light color, tempo and mood ----------

function renderMessage(msg) {
  if (Number.isFinite(msg.intensity)) state.master = Math.min(1, Math.max(0, msg.intensity));
  if (typeof msg.color === 'string' && HEX_COLOR.test(msg.color)) state.color = msg.color;
  if (msg.action === 'flash_light') {
    els.bulbs.classList.remove('flash');
    void els.bulbs.offsetWidth;
    els.bulbs.classList.add('flash');
  }
  els.lightsAction.textContent = ACTION_LABELS[msg.action];
  els.lightsAction.classList.add('is-active');
  els.lightsEnergy.textContent = capitalize(msg.energy);
  els.lightsSwatch.style.backgroundColor = state.color;
  els.lightsColor.textContent = colorName(state.color);
  els.ambient.style.backgroundColor = state.color;
  if (typeof msg.reason === 'string' && msg.reason.trim()) {
    els.lightsReason.textContent = msg.reason.trim();
    els.lightsReason.hidden = false;
  }

  if (msg.source === 'slow') state.modelMood = true;
  const mood = state.modelMood ? word(msg.mood) : '';
  const range = MOOD_RANGES[mood];
  const label = `${mood ? `${capitalize(mood)} mood` : 'Synced with 20s movement window'}${range ? `, ${range[0]}-${range[1]} BPM` : ''}`;
  els.tempoValue.textContent = mood ? msg.music_tempo : (player.song?.tempo || '-');
  els.tempoLabel.textContent = label;
  els.lightsMood.textContent = mood ? capitalize(mood) : '-';
  for (const beat of els.beats) beat.style.setProperty('--beat', `${(60 / (msg.music_tempo || 100)).toFixed(3)}s`);
  state.last = msg;
}

function colorName(hex) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  return COLOR_NAMES.reduce((best, [name, h]) => {
    const [r2, g2, b2] = rgb(h);
    const d = 2 * (r - r2) ** 2 + 4 * (g - g2) ** 2 + 3 * (b - b2) ** 2;
    return d < best[1] ? [name, d] : best;
  }, ['', Infinity])[0];
}

// ---------- The body, every frame: stage lights and the music's targets ----------

function buildBulbs() {
  els.bulbs.replaceChildren(...FIXTURES.map((f) => {
    const light = Object.assign(document.createElement('div'), { className: 'light' });
    light.append(Object.assign(document.createElement('div'), { className: 'bulb' }),
      Object.assign(document.createElement('span'), { className: 'light-name', textContent: f.name }),
      Object.assign(document.createElement('span'), { className: 'light-value' }));
    return light;
  }));
}

function songBeats() {
  const bpm = player.song?.tempo;
  return bpm && !player.paused ? ((player.pos + performance.now() - player.at) / 60000) * bpm : null;
}

function renderLights(f) {
  const s = updateStage(f, {
    t: els.body.currentTime, master: state.master, color: state.color, live: state.phase === 'live' || state.videoPlaying,
    songBpm: songBeats() != null ? player.song.tempo : 0, songBeats: songBeats(), song: player.song,
    mood: state.modelMood ? word(state.last?.mood) : '',
  });
  const lights = els.bulbs.children;
  s.fixtures.forEach(({ level, color, own }, i) => {
    const bulb = lights[i].firstChild;
    bulb.style.backgroundColor = color;
    bulb.style.opacity = (level ? 0.2 + 0.8 * level : 0).toFixed(2);
    bulb.style.boxShadow = `0 0 ${Math.round(12 + 44 * level)}px ${Math.round(2 + 9 * level)}px ${color}${Math.round(150 * level).toString(16).padStart(2, '0')}`;
    lights[i].lastChild.textContent = `${Math.round(own * 100)}%`;
  });
  els.ambient.style.opacity = (0.3 * state.master).toFixed(2);
}

function musicTargets(f, msg) {
  const mood = state.modelMood ? word(msg?.mood) : '';
  const rhythm = f.rhythm?.strength > 0.3 ? f.rhythm : null;
  return {
    energy: clamp01(0.1 + 0.55 * Math.min(f.pace / 1.2, 1) + 0.35 * Math.min(f.arm / 20, 1)),
    danceability: clamp01(0.2 + 0.7 * (rhythm?.strength ?? 0) + 0.1 * Math.min(f.arm / 20, 1)),
    valence: clamp01(0.25 + 0.45 * f.upright + (MOOD_VALENCE[mood] ?? 0)),
    acousticness: clamp01(0.15 + 0.7 * f.still),
    instrumentalness: clamp01(0.1 + 0.6 * f.still),
    loudness: -16 + 10 * clamp01(f.pace / 1.2),
    tempo: rhythm ? Math.round(rhythm.bpm) : mood ? msg.music_tempo : null,
    tempoFrom: rhythm ? 'body rhythm' : mood ? 'Muse Spark' : '',
    mood,
  };
}

function renderFeatures(f, t) {
  const rows = [
    ['Pace', `${f.pace.toFixed(2)} m/s`],
    ['Rhythm', f.rhythm?.strength > 0.3 ? `${Math.round(f.rhythm.bpm)}/min · ${Math.round(f.rhythm.strength * 100)}%` : 'none'],
    ['Arm swing', `${Math.round(f.arm)}°`], ['Upright', `${Math.round(f.upright * 100)}%`],
    ['Still', `${Math.round(f.still * 100)}%`], ['Energy', t.energy.toFixed(2)], ['Dance', t.danceability.toFixed(2)],
    ['Valence', t.valence.toFixed(2)], ['Acoustic', t.acousticness.toFixed(2)], ['Tempo', t.tempo ? (t.tempoFrom === 'body rhythm' ? `${t.tempo}/min · body rhythm` : `${t.tempo} BPM · ${t.tempoFrom}`) : (player.song?.tempo ? `${player.song.tempo} BPM · track` : '-')],
  ];
  els.features.replaceChildren(...rows.map(([k, v], i) => {
    const row = Object.assign(document.createElement('div'), { className: i < 5 ? 'feat feat-in' : 'feat feat-out' });
    row.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
    return row;
  }));
}

let lastFeaturesAt = 0;
function frame() {
  requestAnimationFrame(frame);
  if (!session.pose) return;
  const t = els.body.currentTime;
  const f = bodyFeatures(t);
  if (!f) return;
  renderLights(f);
  if (performance.now() - lastFeaturesAt < 250) return;
  lastFeaturesAt = performance.now();
  const targets = { ...musicTargets(f, state.last), at: t };
  renderFeatures(f, targets);
  els.chainWindow.textContent = `Matched to your movement (${clock(Math.max(0, t - f.window))}–${clock(t)}) · synced with player.`;
  maybeAskSongs(targets);
  preSection(t);
  renderBar();
}

// ---------- Songs: 1 best song per ~20 s window (1 song for 20-30 s clips, quirky notice for <10 s clips) ----------

const RECCO = 'https://api.reccobeats.com/v1';
const RECCO_TIMEOUT_MS = 6000;
const ASK_EVERY_MS = 15000;
const songs = {
  asked: null, at: 0, request: 0, seeds: {}, profile: null,
  pre: null, preAt: -1, tooShort: false, previewShort: false, durationS: 0, quirkyTitle: '', quirkyNote: '',
};

async function reccoGet(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RECCO_TIMEOUT_MS);
  try {
    const res = await fetch(`${RECCO}${path}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`ReccoBeats answered ${res.status}`);
    return await res.json();
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'ReccoBeats did not answer in time' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

const spotifyId = (href) => (typeof href === 'string' && href.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/)?.[1]) || null;

async function seedFor(words) {
  if (!songs.seeds[words]) {
    const found = await reccoGet(`/track/search?searchText=${encodeURIComponent(words)}&size=5`);
    const hit = (found.content ?? []).find((t) => t.id);
    if (!hit) throw new Error(`ReccoBeats found no song for "${words}"`);
    songs.seeds[words] = { id: hit.id, name: hit.trackTitle };
  }
  return songs.seeds[words];
}

const changed = (a, b) => !b || a.mood !== b.mood || Math.abs(a.tempo - b.tempo) > 8
  || ['energy', 'danceability', 'valence', 'acousticness'].some((k) => Math.abs(a[k] - b[k]) > 0.12);

// Keep the active 20 s section in sync with the video playhead `t`
function preSection(t, { forcePlay = false } = {}) {
  if (songs.tooShort || songs.previewShort) {
    renderShortClipMusic();
    return;
  }
  if (!songs.pre || songs.profile) return;
  let k = songs.pre.findIndex((s) => t >= s.start_s && t < s.end_s);
  if (k < 0) k = t < songs.pre[0].start_s ? 0 : songs.pre.length - 1;
  const sectionChanged = k !== songs.preAt;
  if (!sectionChanged && !forcePlay) return;
  songs.preAt = k;
  const sec = songs.pre[k];
  const primary = sec.songs?.[0];
  player.queue = [...(sec.songs ?? []), ...(sec.fallbacks ?? [])];
  drawSongs(sec.songs ?? []);
  const totalSec = songs.pre.length;
  els.songsMood.textContent = totalSec === 1
    ? `1 song matched for this ${Math.round(songs.durationS || sec.end_s)}s clip · synced with video`
    : `Part ${k + 1} of ${totalSec} (${clock(sec.start_s)}–${clock(sec.end_s)}) · synced with video`;
  els.songsNote.hidden = true;
  if (!state.modelMood && primary?.tempo) {
    els.tempoValue.textContent = primary.tempo;
    els.tempoLabel.textContent = `${capitalize(sec.mood || 'matched')} mood · ${sec.style}`;
  }
  if (primary && (sectionChanged || !player.song)) {
    player.song = { ...primary, ended: false };
    els.playerBeat.textContent = primary.tempo ? `${primary.tempo} BPM · Synced` : 'Synced';
    els.playerNote.textContent = `${clock(sec.start_s)}–${clock(sec.end_s)} · ${sec.what_happens || sec.style}: ${sec.why}`;
  }
  renderPlayerSegments();
  renderBar();
  const isPlaying = state.videoPlaying || state.phase === 'live' || !els.body.paused || forcePlay;
  if (isPlaying && primary && (sectionChanged || forcePlay || player.song?.spotifyId !== primary.spotifyId || player.paused)) {
    playSong(primary);
  }
}

function renderShortClipMusic() {
  els.songList.replaceChildren();
  const card = buildQuirkyCard('music', session.activity || 'a quick moment', {
    kicker: songs.tooShort
      ? `⏱️ Clip is ${songs.durationS.toFixed(1)}s (< 10s minimum) · AI DJ Warming Up`
      : '⏱️ How < 10s Clips Work · AI DJ Warm-Up Preview',
    title: songs.quirkyTitle || 'Hold the drop — that was a blink, not a groove!',
    text: songs.quirkyNote || 'When a clip is under 10 seconds long, our AI DJ barely gets its headphones on before the tape runs out! Give LifeLens at least 10–20 seconds of movement so it can read your pace, cadence, and arm swing to pick the best song. (Clips of 20–30s lock 1 song; longer clips switch songs every ~20s in sync with the video.)',
  });
  if (!songs.tooShort && songs.previewShort) {
    const backBtn = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'btn btn-small-text quirky-back-btn',
      textContent: '← Back to synced song queue',
    });
    backBtn.addEventListener('click', () => {
      songs.previewShort = false;
      songs.preAt = -1;
      preSection(els.body.currentTime || 0);
    });
    card.querySelector('.quirky-body')?.appendChild(backBtn);
  }
  const li = document.createElement('li');
  li.className = 'queue-quirky-item';
  li.appendChild(card);
  els.songList.appendChild(li);
  els.songsNote.hidden = true;
  if ($('vibe-recs')) $('vibe-recs').hidden = true;
  els.songsMood.textContent = songs.tooShort ? 'Clip under 10s — need 10s+ for a song match' : 'Previewing <10s clip notice';
}

async function loadPreSongs() {
  Object.assign(songs, { pre: null, preAt: -1, tooShort: false, previewShort: false, durationS: 0, quirkyTitle: '', quirkyNote: '' });
  Object.assign(session, { active: true, activity: '', tooShort: false });
  const base = session.rec?.base;
  if (!base) return;
  const data = await fetch(`/${base}/songs.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!data || session.rec?.base !== base) return;
  const clipDur = Number(data.duration_s) || (session.pose ? session.pose.n / 30 : 0);
  const tooShort = Boolean(data.too_short) || (clipDur > 0 && clipDur < 10);
  Object.assign(songs, {
    tooShort,
    durationS: clipDur,
    quirkyTitle: data.quirky_title || '',
    quirkyNote: data.quirky_note || '',
  });
  Object.assign(session, { active: data.active !== false, activity: data.activity || '', tooShort });
  emit('activity', { active: session.active, activity: session.activity, tooShort });
  if (tooShort) {
    renderShortClipMusic();
    return;
  }
  const pre = (data.sections ?? []).filter((s) => s.songs?.length);
  for (const sec of pre) {
    sec.songs = sec.songs.slice(0, 1); // Always 1 best-fitting song per ~20s window
    for (const s of [...sec.songs, ...(sec.fallbacks ?? [])]) {
      s.windowLabel = `${clock(sec.start_s)}–${clock(sec.end_s)}`;
      s.whatHappens = sec.what_happens || session.activity || 'Movement window';
      s.why = `${sec.style} (${sec.mood}): ${sec.why}`;
    }
  }
  songs.pre = pre.length ? pre : null;
  preSection(els.body.currentTime || 0);
}

function maybeAskSongs(t) {
  if (songs.tooShort || songs.pre || songs.profile || !t.mood || performance.now() - songs.at < ASK_EVERY_MS || !changed(t, songs.asked)) return;
  songs.asked = t;
  songs.at = performance.now();
  const request = ++songs.request;
  askSongs(t).then((list) => {
    if (request !== songs.request) return;
    player.queue = list.songs.slice(0, 1);
    drawSongs(player.queue);
    els.songsMood.textContent = `Seed: ${list.seed}`;
    els.songsNote.hidden = true;
    if ((state.phase === 'live' || state.videoPlaying) && (!player.song || player.song.ended)) playSong(player.queue[0]);
  }).catch((err) => {
    if (request !== songs.request) return;
    els.songList.replaceChildren();
    els.songsNote.hidden = false;
    els.songsNote.textContent = `No songs: ${err.message}.`;
    songs.asked = null;
  });
}

const FEATURES = ['energy', 'danceability', 'valence', 'acousticness', 'instrumentalness', 'loudness'];

async function askSongs(t) {
  const seed = await seedFor(t.search || t.mood);
  const params = new URLSearchParams({ size: '10', seeds: seed.id, tempo: String(Math.round(t.tempo)) });
  for (const k of FEATURES) if (Number.isFinite(t[k])) params.set(k, t[k].toFixed(2));
  const data = await reccoGet(`/track/recommendation?${params}`);
  const seen = new Set();
  const list = (data.content ?? []).map((s) => ({
    id: String(s.id || ''), name: String(s.trackTitle || ''), spotifyId: spotifyId(s.href),
    artist: Array.isArray(s.artists) ? s.artists.map((a) => a.name).join(', ') : '',
  })).filter((s) => s.name && s.spotifyId && !seen.has(s.spotifyId) && seen.add(s.spotifyId));
  if (!list.length) throw new Error('ReccoBeats returned no songs');
  const features = await reccoGet(`/audio-features?ids=${encodeURIComponent(list.map((s) => s.id).join(','))}`);
  const by = new Map((features.content ?? []).map((x) => [spotifyId(x.href), x]));
  for (const s of list) {
    const x = by.get(s.spotifyId);
    s.tempo = x ? Math.round(x.tempo) : null;
    s.fit = x ? Math.abs(x.tempo - t.tempo) / 60 + Math.abs(x.energy - t.energy) + Math.abs(x.valence - t.valence) : 9;
    s.why = t.search ? `${t.from ?? 'Muse Spark'}: ${t.search}, ${Math.round(t.tempo)} BPM, energy ${t.energy.toFixed(2)}.`
      : `Picked at ${clock(t.at)} for energy ${t.energy.toFixed(2)}, ${t.tempo}${t.tempoFrom === 'body rhythm' ? '/min body rhythm' : ' BPM'}, ${t.mood} mood.`;
  }
  list.sort((a, b) => a.fit - b.fit);
  return { seed: `"${seed.name}"`, songs: list.slice(0, 1) };
}

function jumpToSection(k) {
  if (!songs.pre?.[k]) return;
  const sec = songs.pre[k];
  media.seek(sec.start_s + 0.05);
  state.videoPlaying = true;
  media.play();
  preSection(sec.start_s + 0.05, { forcePlay: true });
  renderControls();
}

function drawQueue() {
  const cur = songs.preAt;
  const single = songs.pre.length === 1;
  const items = songs.pre.map((sec, k) => {
    const isCurrent = k === cur;
    const li = Object.assign(document.createElement('li'), { className: `queue-section${isCurrent ? ' is-current' : ''}` });
    const head = Object.assign(document.createElement('div'), { className: 'queue-head' });
    const timeTag = Object.assign(document.createElement('span'), {
      className: 'queue-time',
      textContent: single ? `${clock(sec.start_s)}–${clock(sec.end_s)} · Full clip` : `Window ${k + 1} · ${clock(sec.start_s)}–${clock(sec.end_s)}`,
    });
    const styleStrong = Object.assign(document.createElement('strong'), { textContent: sec.what_happens || sec.style });
    const moodBadge = Object.assign(document.createElement('span'), {
      className: `queue-mood${isCurrent ? ' is-synced' : ''}`,
      textContent: isCurrent ? `● Synced now · ${sec.mood}` : `${sec.style} · ${sec.mood}`,
    });
    head.append(timeTag, styleStrong, moodBadge);

    const whyLine = Object.assign(document.createElement('p'), {
      className: 'queue-why',
      textContent: `${capitalize(sec.style)}: ${sec.why}`,
    });

    const ol = Object.assign(document.createElement('ol'), { className: 'queue-songs' });
    const topSong = sec.songs?.[0];
    if (topSong) ol.appendChild(songRow(topSong, k, isCurrent));
    li.append(head, whyLine, ol);
    return li;
  });

  // Add a compact footer row explaining the <10s / 20-30s / 20s-window rules with a 1-click preview of the <10s quirky DJ card
  const ruleLi = Object.assign(document.createElement('li'), { className: 'queue-rule-footer' });
  const ruleText = Object.assign(document.createElement('span'), {
    className: 'queue-rule-text',
    textContent: single
      ? '20–30s clip: locked to 1 best-fitting track in sync with the video.'
      : `Synced by ~20s windows (${songs.pre.length} windows): the track switches automatically as the video plays.`,
  });
  const shortBtn = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'queue-short-preview-btn',
    textContent: 'What if a clip is <10s?',
  });
  shortBtn.addEventListener('click', () => {
    songs.previewShort = true;
    renderShortClipMusic();
  });
  ruleLi.append(ruleText, shortBtn);
  els.songList.replaceChildren(...items, ruleLi);
  renderVibeRecs();
  markPlaying();
}

const SIMILAR_POOLS = {
  cozy: {
    vibeBadge: '☀️ Your Day Vibe in a Song',
    vibeTitle: 'Unhurried Cozy Reset',
    vibeDesc: 'Warm, laid-back acoustic energy that matches a relaxed seated moment.',
    vibeFallback: { name: 'Better Together', artist: 'Jack Johnson, Paula Fuga', spotifyId: '2iXdwVdzA0KrI2Q0iZNJbX', tempo: 110 },
    tasks: [
      { when: '☕ Next time you’re having coffee or a quiet meal', why: 'Gentle acoustic rhythm that keeps the table relaxed.', song: { name: 'Banana Pancakes', artist: 'Jack Johnson', spotifyId: '0BgbobvykXxEvxo2HhCuvM', tempo: 115 } },
      { when: '🍳 Next time you’re cooking or prepping food', why: 'Easygoing feel-good groove for moving around the kitchen.', song: { name: 'Put Your Records On', artist: 'Corinne Bailey Rae', spotifyId: '2nGFzvICaeEWjIrBrL2RAx', tempo: 96 } },
      { when: '📖 Next time you’re winding down or reading', why: 'Soft, unhurried melody for a calm evening break.', song: { name: 'Sunrise', artist: 'Norah Jones', spotifyId: '7zkLpY72g6lKQbiHDqri1S', tempo: 106 } },
    ],
  },
  outdoor: {
    vibeBadge: '🏔️ Your Day Vibe in a Song',
    vibeTitle: 'Dialed-In Mountain Prep',
    vibeDesc: 'Focused, grounded energy as you crouch, reach, and lock into your gear before riding.',
    vibeFallback: { name: 'On Top Of The World', artist: 'Imagine Dragons', spotifyId: '213x4gsFDm04hSqIUkg88w', tempo: 100 },
    tasks: [
      { when: '🏂 Next time you’re strapping in or gearing up outdoors', why: 'Steady head-nod beat while you lock in your boots and bindings.', song: { name: 'Best Day Of My Life', artist: 'American Authors', spotifyId: '5Hroj5K7vLpIG4FNCRIjbP', tempo: 100 } },
      { when: '🎿 Next time you’re carving down a slope or trail', why: 'Upbeat momentum that matches balance shifts and turns.', song: { name: 'Walking On Sunshine', artist: 'Katrina & The Waves', spotifyId: '05wIrZSwuaVWhcv5FfqeH0', tempo: 110 } },
      { when: '🎒 Next time you’re packing gear or heading out', why: 'Bright indie energy for the trip to the mountain.', song: { name: 'Send Me On My Way', artist: 'Rusted Root', spotifyId: '6XK6Zw6JkFsHXzAcMWNiIr', tempo: 106 } },
    ],
  },
  workout: {
    vibeBadge: '⚡ Your Day Vibe in a Song',
    vibeTitle: 'High-Energy Training Flow',
    vibeDesc: 'Upbeat stride and driving power that move with your walk-in, squat set, and cool-down.',
    vibeFallback: { name: 'On Top Of The World', artist: 'Imagine Dragons', spotifyId: '213x4gsFDm04hSqIUkg88w', tempo: 100 },
    tasks: [
      { when: '🏃 Next time you’re warming up or taking a brisk walk', why: 'Matches a steady walking cadence to get you moving.', song: { name: 'Best Day Of My Life', artist: 'American Authors', spotifyId: '5Hroj5K7vLpIG4FNCRIjbP', tempo: 100 } },
      { when: '💪 Next time you’re doing squats or a quick home set', why: 'Punchy beat that paces controlled down-and-up reps.', song: { name: 'Stronger', artist: 'Kanye West', spotifyId: '0j2T0R9dR9qdJYsB7ciXhf', tempo: 104 } },
      { when: '🧘 Next time you’re cooling down or stretching after a set', why: 'Smooth, grounded tempo to bring your breathing down.', song: { name: 'Better Together', artist: 'Jack Johnson, Paula Fuga', spotifyId: '2iXdwVdzA0KrI2Q0iZNJbX', tempo: 110 } },
    ],
  },
};

function renderVibeRecs() {
  const box = $('vibe-recs');
  if (!box) return;
  if (!songs.pre?.length || songs.tooShort || songs.previewShort) {
    box.hidden = true;
    return;
  }
  const actText = `${session.rec?.name || ''} ${session.activity || ''}`.toLowerCase();
  const kind = /snow|board|strap|ski|skate/.test(actText)
    ? 'outdoor'
    : (session.active === false || /eat|noodle|meal|coffee|sit|desk/.test(actText))
      ? 'cozy'
      : 'workout';
  const preset = SIMILAR_POOLS[kind];
  const allFallbacks = songs.pre.flatMap((s) => s.fallbacks ?? []).filter((s) => s?.spotifyId);
  const usedIds = new Set(songs.pre.flatMap((s) => (s.songs ?? []).map((x) => x.spotifyId)));

  const pickSong = (preferred) => {
    const fromRun = allFallbacks.find((f) => !usedIds.has(f.spotifyId));
    if (fromRun) {
      usedIds.add(fromRun.spotifyId);
      return fromRun;
    }
    usedIds.add(preferred.spotifyId);
    return preferred;
  };

  const vibeSong = pickSong(preset.vibeFallback);

  const vibeCard = document.createElement('div');
  vibeCard.className = 'vibe-day-card';
  const vibeTop = document.createElement('div');
  vibeTop.className = 'vibe-day-top';
  vibeTop.append(
    Object.assign(document.createElement('span'), { className: 'vibe-badge', textContent: preset.vibeBadge }),
    Object.assign(document.createElement('strong'), { className: 'vibe-title', textContent: preset.vibeTitle }),
    Object.assign(document.createElement('p'), { className: 'vibe-desc', textContent: preset.vibeDesc }),
  );
  const vibeRow = songRow(vibeSong, null, false);
  vibeRow.querySelector('.song-play').textContent = 'Play day vibe';
  vibeCard.append(vibeTop, vibeRow);

  const nextWrap = document.createElement('div');
  nextWrap.className = 'vibe-next-wrap';
  const nextHead = document.createElement('div');
  nextHead.className = 'vibe-next-head';
  nextHead.append(
    Object.assign(document.createElement('h4'), { textContent: 'Play next time you’re doing similar tasks' }),
    Object.assign(document.createElement('span'), { textContent: 'Picked from your pace & activity vibe' }),
  );
  const nextList = document.createElement('ul');
  nextList.className = 'vibe-next-list';

  for (const item of preset.tasks) {
    const s = pickSong(item.song);
    const li = document.createElement('li');
    li.className = 'vibe-next-item';
    const taskTag = Object.assign(document.createElement('span'), { className: 'vibe-task-tag', textContent: item.when });
    const whyText = Object.assign(document.createElement('p'), { className: 'vibe-task-why', textContent: item.why });
    const row = songRow(s, null, false);
    row.querySelector('.song-play').textContent = 'Play';
    li.append(taskTag, whyText, row);
    nextList.appendChild(li);
  }
  nextWrap.append(nextHead, nextList);
  box.replaceChildren(vibeCard, nextWrap);
  box.hidden = false;
}

function songRow(song, sectionIdx = null, isCurrentSection = false) {
  const li = Object.assign(document.createElement('li'), { className: 'song' });
  li.dataset.id = song.spotifyId;
  const info = Object.assign(document.createElement('div'), { className: 'song-info' });
  info.append(
    Object.assign(document.createElement('span'), { className: 'song-name', textContent: song.name }),
    Object.assign(document.createElement('span'), { className: 'song-artist', textContent: song.artist }),
  );
  li.appendChild(info);
  if (song.tempo) li.appendChild(Object.assign(document.createElement('span'), { className: 'song-tempo', textContent: `${song.tempo} BPM` }));
  const isPlayingThis = isCurrentSection && (state.videoPlaying || state.phase === 'live' || !els.body.paused);
  const btn = Object.assign(document.createElement('button'), {
    type: 'button',
    className: `song-play${isPlayingThis ? ' is-active' : ''}`,
    textContent: isPlayingThis ? 'Playing in sync' : 'Play window',
  });
  btn.setAttribute('aria-label', `Play ${song.name} in sync with video`);
  btn.addEventListener('click', () => {
    if (sectionIdx != null) jumpToSection(sectionIdx);
    else {
      state.videoPlaying = true;
      media.play();
      playSong(song);
      renderControls();
    }
  });
  li.appendChild(btn);
  return li;
}

function drawSongs(list) {
  if (songs.tooShort || songs.previewShort) { renderShortClipMusic(); return; }
  if (songs.pre && !songs.profile) { drawQueue(); return; }
  els.songList.replaceChildren(...list.slice(0, 1).map((s) => songRow(s)));
  markPlaying();
}

// ---------- Unified Video + Spotify Player ----------

const player = { api: null, ctrl: null, song: null, pendingSong: null, queue: [], paused: true, pos: 0, at: 0, dur: 0 };

function clipTotalDuration() {
  return els.body?.duration || songs.durationS || (session.pose ? session.pose.n / 30 : 0) || (songs.pre?.length ? songs.pre[songs.pre.length - 1].end_s : 0);
}

function renderPlayerSegments() {
  const winBox = $('p-windows');
  const segBox = $('p-segments');
  if (!winBox || !segBox) return;
  if (!songs.pre?.length || songs.tooShort || songs.previewShort) {
    winBox.replaceChildren();
    segBox.replaceChildren();
    return;
  }
  const total = Math.max(1, clipTotalDuration());
  // Divider ticks on the progress bar where each ~20s window starts
  winBox.replaceChildren(...songs.pre.slice(1).map((sec) => {
    const tick = document.createElement('span');
    tick.className = 'p-win-tick';
    tick.style.left = `${Math.min(99, Math.max(1, (100 * sec.start_s) / total))}%`;
    return tick;
  }));

  // Clickable clip-part pills so user can select any part of the clip and play its matched song
  segBox.replaceChildren(...songs.pre.map((sec, k) => {
    const top = sec.songs?.[0];
    const isCur = k === songs.preAt;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `p-seg-btn${isCur ? ' is-active' : ''}`;
    const timeText = songs.pre.length === 1
      ? `${clock(sec.start_s)}–${clock(sec.end_s)}`
      : `Part ${k + 1} (${clock(sec.start_s)}–${clock(sec.end_s)})`;
    btn.innerHTML = `<span class="p-seg-time">${timeText}</span><strong class="p-seg-song">${top?.name || sec.style}</strong>`;
    btn.title = `Select ${timeText} and play "${top?.name || sec.style}"`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      jumpToSection(k);
    });
    return btn;
  }));
}

function renderBar() {
  const s = player.song;
  const videoRunning = state.videoPlaying || state.phase === 'live' || (els.body && !els.body.paused);
  const sec = songs.pre?.[songs.preAt];
  $('p-title').textContent = s?.name ?? 'No song yet';
  const winTag = sec
    ? (songs.pre.length === 1 ? `Full clip (${clock(sec.start_s)}–${clock(sec.end_s)})` : `Part ${songs.preAt + 1}/${songs.pre.length} (${clock(sec.start_s)}–${clock(sec.end_s)})`)
    : '';
  $('p-artist').textContent = s
    ? [s.artist, s.tempo && `${s.tempo} BPM`, winTag].filter(Boolean).join(' · ')
    : 'Press Play or click any part of the clip below';
  $('p-toggle').dataset.state = videoRunning ? 'pause' : 'play';
  $('p-toggle').setAttribute('aria-label', videoRunning ? 'Pause video & music' : 'Play video & music in sync');

  const vidDur = clipTotalDuration();
  const vidCur = els.body?.currentTime || 0;
  const thumb = $('p-thumb');
  const prog = $('p-progress');
  if (vidDur > 0) {
    const pct = Math.min(100, Math.max(0, (100 * vidCur) / vidDur));
    $('p-fill').style.width = `${pct}%`;
    if (thumb) thumb.style.left = `${pct}%`;
    if (prog) prog.setAttribute('aria-valuenow', String(Math.round(pct)));
    $('p-time').textContent = `${clock(vidCur)} / ${clock(vidDur)}`;
  } else {
    const pos = player.pos + (!player.paused ? performance.now() - player.at : 0);
    const pct = player.dur ? Math.min(100, (100 * pos) / player.dur) : 0;
    $('p-fill').style.width = `${pct}%`;
    if (thumb) thumb.style.left = `${pct}%`;
    $('p-time').textContent = player.dur ? `${clock(pos / 1000)} / ${clock(player.dur / 1000)}` : '';
  }
}

function seekClipAndPlaySong(targetSec) {
  const dur = clipTotalDuration();
  if (!(dur > 0)) return;
  const t = Math.min(Math.max(0, targetSec), Math.max(0, dur - 0.08));
  media.seek(t);
  state.videoPlaying = true;
  media.play();
  preSection(t, { forcePlay: true });
  renderControls();
}

const pProgress = $('p-progress');
if (pProgress) {
  const scrubAt = (clientX) => {
    const rect = pProgress.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    seekClipAndPlaySong(frac * clipTotalDuration());
  };
  let dragging = false;
  pProgress.addEventListener('pointerdown', (e) => {
    dragging = true;
    pProgress.setPointerCapture?.(e.pointerId);
    scrubAt(e.clientX);
  });
  pProgress.addEventListener('pointermove', (e) => {
    if (dragging) scrubAt(e.clientX);
  });
  pProgress.addEventListener('pointerup', () => { dragging = false; });
  pProgress.addEventListener('pointercancel', () => { dragging = false; });
  pProgress.addEventListener('keydown', (e) => {
    const dur = clipTotalDuration();
    if (!(dur > 0)) return;
    const cur = els.body?.currentTime || 0;
    const next = { ArrowRight: cur + 5, ArrowUp: cur + 5, ArrowLeft: cur - 5, ArrowDown: cur - 5, Home: 0, End: dur - 0.2 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    seekClipAndPlaySong(next);
  });
}

const stepWindowOrSong = (d) => {
  if (songs.pre?.length > 1) {
    const nextIdx = (Math.max(0, songs.preAt) + d + songs.pre.length) % songs.pre.length;
    jumpToSection(nextIdx);
    return;
  }
  if (songs.pre?.length === 1) {
    jumpToSection(0);
    return;
  }
  const q = player.queue.filter((s) => !s.unplayable);
  if (!q.length) return;
  const i = q.findIndex((s) => s.spotifyId === player.song?.spotifyId);
  playSong(q[(i + d + q.length) % q.length]);
};

$('p-toggle').addEventListener('click', () => onPlay());
$('p-prev').addEventListener('click', () => stepWindowOrSong(-1));
$('p-next').addEventListener('click', () => stepWindowOrSong(1));
setInterval(() => { if (player.song || state.videoPlaying) renderBar(); }, 250);

function spotifyApi() {
  player.api ??= new Promise((resolve, reject) => {
    window.onSpotifyIframeApiReady = resolve;
    const script = Object.assign(document.createElement('script'), { src: 'https://open.spotify.com/embed/iframe-api/v1', async: true });
    script.onerror = () => { player.api = null; reject(new Error('the Spotify player did not load')); };
    document.head.append(script);
  });
  return player.api;
}

function markPlaying() {
  for (const li of document.querySelectorAll('.song')) {
    li.classList.toggle('is-playing', li.dataset.id === player.song?.spotifyId);
  }
}

async function playSong(song) {
  if (!song) return;
  player.song = { ...song, ended: false };
  if (player.creating) {
    player.pendingSong = song;
    renderBar();
    return;
  }
  setTimeout(() => {
    if (player.song?.spotifyId !== song.spotifyId || player.song.started) return;
    song.unplayable = true;
    const next = player.queue.find((s) => s.spotifyId !== song.spotifyId && !s.unplayable);
    if (next) playSong(next);
  }, 6000);
  const sec = songs.pre?.[songs.preAt];
  els.playerBeat.textContent = song.tempo ? `${song.tempo} BPM · Synced` : 'Synced';
  els.playerNote.textContent = sec
    ? `${clock(sec.start_s)}–${clock(sec.end_s)} · ${sec.what_happens || sec.style}: ${sec.why}`
    : (song.why ?? '');
  markPlaying();
  if (songs.pre && !songs.profile) drawQueue();
  renderPlayerSegments();
  renderBar();
  const uri = `spotify:track:${song.spotifyId}`;
  if (player.ctrl) {
    player.ctrl.loadUri(uri);
    player.ctrl.play();
    for (const ms of [600, 1500, 3000]) {
      setTimeout(() => {
        if (player.paused && player.song?.spotifyId === song.spotifyId && (state.phase === 'live' || state.videoPlaying)) {
          player.ctrl.resume();
        }
      }, ms);
    }
    return;
  }
  player.creating = true;
  try {
    const api = await spotifyApi();
    api.createController(els.playerEmbed, { uri, width: '100%', height: 80 }, (ctrl) => {
      player.ctrl = ctrl;
      player.creating = false;
      ctrl.addListener('ready', () => {
        if (player.pendingSong && player.pendingSong.spotifyId !== song.spotifyId) {
          const next = player.pendingSong;
          player.pendingSong = null;
          playSong(next);
          return;
        }
        player.pendingSong = null;
        if (state.videoPlaying || state.phase === 'live') ctrl.play();
      });
      ctrl.addListener('playback_update', ({ data }) => {
        Object.assign(player, { paused: data.isPaused, pos: data.position, at: performance.now(), dur: data.duration || player.dur });
        // Keep video in sync if user clicked play/pause inside the Spotify iframe itself
        if (!data.isPaused && els.body?.paused && session.rec) {
          state.videoPlaying = true;
          media.play();
          renderControls();
        }
        renderBar();
        const curSong = player.song;
        if (!curSong || !data.duration) return;
        if (!data.isPaused && data.position > 0 && data.position < data.duration - 1500) curSong.started = true;
        const atEnd = data.position >= data.duration - 400 || (data.isPaused && data.position === 0);
        if (curSong.started && atEnd && !curSong.ended) {
          player.song.ended = true;
          if (state.phase === 'live' || state.videoPlaying) {
            const activePrimary = songs.pre?.[songs.preAt]?.songs?.[0] || player.queue[0];
            if (activePrimary) playSong(activePrimary);
          }
        }
      });
    });
  } catch (err) {
    player.creating = false;
    els.playerNote.textContent = `No player: ${err.message}.`;
  }
}

// ---------- Controls and state ----------

function renderControls() {
  const activePlay = state.phase === 'live' || state.videoPlaying;
  const hasRec = Boolean(session.rec);
  emit('state', { phase: state.phase, playing: activePlay });
  els.playBtn.disabled = !hasRec;
  els.restartBtn.disabled = !hasRec;
  els.playBtn.dataset.state = activePlay ? 'pause' : 'play';
  els.playLabel.textContent = activePlay ? 'Pause' : state.phase === 'paused' ? 'Resume' : 'Play';
  for (const btn of els.tabBtns) btn.classList.toggle('is-live', activePlay && btn.dataset.tab !== 'day');
  const status = activePlay ? 'Synced · Live' : state.phase === 'paused' ? 'Paused' : state.phase === 'ended' ? 'Ended' : 'Ready';
  for (const chip of [els.musicState, els.chainState]) {
    chip.textContent = status;
    chip.classList.toggle('is-active', activePlay);
  }
  els.musicPanel.classList.toggle('is-paused', !activePlay);
  if (session.live) els.progressLabel.textContent = 'Live session';
  else if (!hasRec) els.progressLabel.textContent = 'Pick a session';
  else if (activePlay) els.progressLabel.textContent = 'Playing video & music in sync';
  else els.progressLabel.textContent = state.phase === 'ended' ? 'Finished' : state.phase === 'paused' ? 'Paused' : 'Ready';
  els.progressFill.style.transform = `scaleX(${activePlay ? 1 : 0})`;
  renderBar();
}

function showNotice(text) {
  els.error.hidden = false;
  els.error.textContent = text;
}

function reset() {
  Object.assign(state, { phase: 'idle', starting: false, videoPlaying: false, cues: [], liveCount: 0, last: null, master: 1, modelMood: false });
  resetStage();
  els.lightsAction.textContent = 'Waiting';
  els.lightsAction.classList.remove('is-active');
  els.lightsReason.hidden = true;
  els.tempoValue.textContent = '-';
  if (player.song) player.ctrl?.pause();
  player.song = null;
  player.queue = [];
  els.playerBeat.textContent = 'No song yet';
  els.playerNote.textContent = 'Press Play: the video and its matched 20s-window song start together in sync.';
  songs.asked = null;
  songs.at = 0;
  songs.profile = null;
  els.songList.replaceChildren();
  if ($('vibe-recs')) $('vibe-recs').hidden = true;
  els.songsNote.hidden = false;
  els.songsNote.textContent = 'Songs load per ~20 s window for this clip.';
  els.songsMood.textContent = 'Waiting';
  els.features.replaceChildren();
}

async function startDirector(start) {
  if (!session.rec) return;
  els.error.hidden = true;
  state.videoPlaying = true;
  media.seek(start);
  media.play();
  preSection(start, { forcePlay: true });
  renderControls();
  state.starting = true;
  try {
    const res = await fetch('/api/live/start', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run: session.rec.base, start, captions: 'muse' }) });
    if (res.ok) {
      retryMs = LIVE_STARTING_RETRY_MS;
      connectLive();
      setTimeout(() => { state.starting = false; }, LIVE_START_TIMEOUT_MS);
    } else {
      state.starting = false;
    }
  } catch {
    state.starting = false;
  }
}

async function stopDirector() {
  state.videoPlaying = false;
  state.starting = false;
  media.pause();
  if (player.song) player.ctrl?.pause();
  await fetch('/api/live/stop', { method: 'POST' }).catch(() => {});
  state.phase = 'paused';
  if (songs.pre && !songs.profile) drawQueue();
  renderControls();
}

function onPlay() {
  if (state.phase === 'live' || state.videoPlaying) stopDirector();
  else startDirector(els.body.currentTime || 0);
}

// Keep music section locked if user scrubs the timeline directly
els.body?.addEventListener('seeked', () => {
  preSection(els.body.currentTime || 0, { forcePlay: state.videoPlaying || state.phase === 'live' });
  renderBar();
});

els.body?.addEventListener('play', () => {
  if (!state.videoPlaying && state.phase !== 'live') {
    state.videoPlaying = true;
    if (state.phase === 'idle' || state.phase === 'ended' || state.phase === 'paused') {
      state.phase = 'playing';
    }
    preSection(els.body.currentTime || 0, { forcePlay: true });
    if (player.song && player.ctrl) player.ctrl.resume();
    else if (player.queue.length) playSong(player.queue[0]);
    renderControls();
  }
});

// Allow clicking POV or 3D body video directly to toggle play/pause
[document.querySelector('#media [data-pane="pov"] video'), els.body].forEach((vid) => {
  if (!vid) return;
  vid.style.cursor = 'pointer';
  vid.addEventListener('click', () => {
    if (session.rec && !session.live) onPlay();
  });
});

// ---------- Live connection ----------

let socket = null;
let retryTimer = null;
let retryMs = LIVE_RETRY_MS;

function scheduleConnect() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connectLive, retryMs);
}

function connectLive() {
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  try {
    socket = new WebSocket(LIVE_URL);
  } catch {
    scheduleConnect();
    return;
  }
  socket.addEventListener('open', () => {
    state.starting = false;
    state.phase = 'live';
    state.videoPlaying = true;
    retryMs = LIVE_RETRY_MS;
    els.error.hidden = true;
    if (media.body.paused) media.play();
    if (player.song && !player.song.ended && player.ctrl) player.ctrl.resume();
    else if (player.queue.length) playSong(player.queue[0]);
    renderControls();
  });
  socket.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (!isValidMessage(msg) || !session.rec) return;
      emit('message', { msg, live: true });
      renderMessage(msg);
      state.liveCount += 1;
      renderControls();
    } catch (err) {
      console.warn('Ignored bad live message:', err.message);
    }
  });
  socket.addEventListener('close', () => {
    socket = null;
    if (state.phase === 'live') {
      state.phase = 'ended';
      state.videoPlaying = false;
    }
    if (!state.starting && player.song) player.ctrl?.pause();
    renderControls();
    if (state.starting) scheduleConnect();
  });
}

// ---------- Startup ----------

document.addEventListener('lifelens:session', () => {
  if (state.phase === 'live' || state.videoPlaying) fetch('/api/live/stop', { method: 'POST' }).catch(() => {});
  reset();
  renderControls();
  loadPreSongs();
});

document.addEventListener('lifelens:play-song', (e) => {
  songs.profile = e.detail;
  player.queue = [e.detail];
  drawSongs([e.detail]);
  els.songsMood.textContent = 'Stagify plan · Synced';
  els.songsNote.hidden = true;
  if (state.phase === 'live' || state.videoPlaying) playSong(e.detail);
});
export { askSongs };

document.addEventListener('lifelens:songs-changed', () => loadPreSongs());
document.addEventListener('lifelens:music-profile', async (e) => {
  const m = e.detail;
  songs.profile = m;
  els.songsMood.textContent = 'Gym music (Muse Spark)';
  try {
    const list = await askSongs({ search: m.search, tempo: m.tempo, energy: m.energy, valence: m.valence,
      danceability: m.danceability, instrumentalness: m.instrumentalness, at: els.body.currentTime, from: 'Gym music (Muse Spark)' });
    player.queue = list.songs;
    drawSongs(list.songs);
    els.songsNote.hidden = true;
    playSong(list.songs[0]);
  } catch (err) {
    els.songsNote.hidden = false;
    els.songsNote.textContent = `No gym music: ${err.message}.`;
  }
});
document.addEventListener('lifelens:leave', () => {
  if (state.phase === 'live' || state.videoPlaying) stopDirector();
});

buildBulbs();
els.playBtn.addEventListener('click', onPlay);
els.restartBtn.addEventListener('click', () => startDirector(0));
els.tabBtns.forEach((btn) => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));
els.tabs.addEventListener('keydown', onTabKeydown);
renderControls();
requestAnimationFrame(frame);
