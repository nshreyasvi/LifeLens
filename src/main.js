// LifeLens front-end: the director's live messages for the open recording, and what the 3D body does at each moment,
// shown on Activity, Music and Stage.
//   Play / Pause / Restart start and stop the director on this recording (vite.config.js: /api/live/*); the page
//   connects to it at ws://127.0.0.1:8765 and the videos follow its clock (extras.js).
//   Music: the body's last 10 s (session.js: pace, steps, arm swing, uprightness, stillness) and the director's mood
//   and tempo set ReccoBeats' targets; a search for the mood finds the seed song.
//   Stage: each light follows one part of the body; the director sets the color, the master level and the flashes.

import { bodyFeatures, clamp01, session } from './session.js';
import { FIXTURES, resetStage, updateStage } from './stage.js';

const LIVE_URL = 'ws://127.0.0.1:8765';
const LIVE_RETRY_MS = 5000;
const LIVE_STARTING_RETRY_MS = 400; // after Play: the director waits only 5 s for the page
const LIVE_START_TIMEOUT_MS = 20000;
const MAX_CUES = 100;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const ENERGY_ORDER = ['low', 'medium', 'high'];
const ACTION_LABELS = { flash_light: 'Flash light', dim: 'Dim', change_color: 'Change color' };
const MOOD_RANGES = { calm: [60, 80], curious: [80, 110], joyful: [110, 140], tense: [90, 120], powerful: [120, 160] };
// How each mood shifts the songs' valence (director/music_map.py moods).
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
  activityView: $('view-activity'), energyChip: $('energy-chip'), energyValue: $('energy-value'),
  energySegs: [...document.querySelectorAll('#energy-meter .seg')], energyNote: $('energy-note'),
  timeline: $('timeline'), timelineCount: $('timeline-count'), ambient: $('ambient'), bulbs: $('bulbs'),
  lightsAction: $('lights-action'), lightsEnergy: $('lights-energy'), lightsMood: $('lights-mood'),
  lightsSwatch: $('lights-swatch'), lightsColor: $('lights-color'), lightsReason: $('lights-reason'),
  musicPanel: $('music-panel'), musicState: $('music-state'), beats: [...document.querySelectorAll('.beat')],
  tempoValue: $('tempo-value'), tempoLabel: $('tempo-label'), songsMood: $('songs-mood'), songList: $('song-list'),
  songsNote: $('songs-note'), player: $('player'), playerEmbed: $('player-embed'), playerBeat: $('player-beat'),
  playerNote: $('player-note'), chainState: $('chain-state'), chainWindow: $('chain-window'),
  features: $('music-features'), body: document.querySelector('#media [data-pane="body"] video'),
};

// phase: 'idle' (no director) → 'live' (connected) → 'ended' (it closed); 'paused' after Pause
const state = { phase: 'idle', starting: false, cues: [], liveCount: 0, last: null, master: 1, color: '#3977FF' };

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const word = (v) => (typeof v === 'string' && /^[a-z][a-z -]{0,23}$/i.test(v.trim()) ? v.trim().toLowerCase() : '');

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
  els.player.hidden = !['music', 'stage', 'gym'].includes(name);
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
  const level = ENERGY_ORDER.indexOf(msg.energy) + 1;
  els.energyValue.textContent = capitalize(msg.energy);
  els.energySegs.forEach((seg, i) => seg.classList.toggle('is-on', i < level));
  const posture = word(msg.posture_label) === 'unknown' ? '' : word(msg.posture_label);
  const speed = Number.isFinite(msg.speed) ? ` at ${msg.speed.toFixed(2)} m/s` : '';
  els.energyNote.textContent = `${msg.time ?? ''} · ${capitalize(posture || 'moving')}${speed} · ${ACTION_LABELS[msg.action]}`;

  if (Number.isFinite(msg.intensity)) state.master = Math.min(1, Math.max(0, msg.intensity));
  if (typeof msg.color === 'string' && HEX_COLOR.test(msg.color)) state.color = msg.color;
  if (msg.action === 'flash_light') {
    els.bulbs.classList.remove('flash');
    void els.bulbs.offsetWidth; // restart the animation on back-to-back flashes
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

  // Mood and tempo are the model's only once its first reply came (source "slow"); before that the director sends its
  // built-in starting scene (curious, 90 BPM), which is not shown as a result.
  if (msg.source === 'slow') state.modelMood = true;
  const mood = state.modelMood ? word(msg.mood) : '';
  const range = MOOD_RANGES[mood];
  const label = `${mood ? `${capitalize(mood)} mood` : 'Waiting for Muse Spark'}${range ? `, ${range[0]}-${range[1]} BPM` : ''}`;
  els.tempoValue.textContent = mood ? msg.music_tempo : '-';
  els.tempoLabel.textContent = label;
  els.lightsMood.textContent = mood ? capitalize(mood) : '-';
  for (const beat of els.beats) beat.style.setProperty('--beat', `${(60 / msg.music_tempo).toFixed(3)}s`);
  state.last = msg;
}

function addCue(msg) {
  const last = state.cues[state.cues.length - 1];
  if (last && last.action === msg.action && last.energy === msg.energy && last.music_tempo === msg.music_tempo) {
    state.cues[state.cues.length - 1] = msg; // ~3 messages a second repeat the same cue: they update the last row
    els.timeline.lastElementChild.querySelector('time').textContent = msg.time ?? '';
  } else {
    state.cues.push(msg);
    const li = document.createElement('li');
    li.className = 'tl-item';
    li.innerHTML = `<span class="tl-dot" aria-hidden="true"></span><div><div class="tl-row"><span class="tl-action"></span>
      <time></time></div><div class="tl-meta"><span class="energy energy-${msg.energy}"></span><span></span></div></div>`;
    li.querySelector('.tl-action').textContent = ACTION_LABELS[msg.action];
    li.querySelector('time').textContent = msg.time ?? '';
    li.querySelector('.energy').textContent = `${capitalize(msg.energy)} energy`;
    li.querySelector('.tl-meta span:last-child').textContent = state.modelMood ? `${msg.music_tempo} BPM` : 'Tempo pending';
    els.timeline.appendChild(li);
  }
  if (state.cues.length > MAX_CUES) {
    state.cues.shift();
    els.timeline.firstElementChild.remove();
  }
  [...els.timeline.children].forEach((li, i, all) => li.classList.toggle('is-current', i === all.length - 1));
  els.timelineCount.textContent = `${state.cues.length} cue${state.cues.length === 1 ? '' : 's'}`;
  if (!els.activityView.hidden) {
    const cur = els.timeline.lastElementChild;
    els.timeline.scrollTo({ top: Math.max(cur.offsetTop - els.timeline.clientHeight / 2, 0), behavior: 'smooth' });
  }
}

function colorName(hex) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  return COLOR_NAMES.reduce((best, [name, h]) => {
    const [r2, g2, b2] = rgb(h);
    const d = 2 * (r - r2) ** 2 + 4 * (g - g2) ** 2 + 3 * (b - b2) ** 2; // weighted RGB distance
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

// The song's beat count (its measured BPM from ReccoBeats, on the player's clock), or null when nothing plays.
function songBeats() {
  const bpm = player.song?.tempo;
  return bpm && !player.paused ? ((player.pos + performance.now() - player.at) / 60000) * bpm : null;
}

// The lights: stage.js mixes each body part, poses, jumps, turns and hits with the director and Muse's scene.
function renderLights(f) {
  const s = updateStage(f, {
    t: els.body.currentTime, master: state.master, color: state.color, live: state.phase === 'live',
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

// ReccoBeats' targets (0-1, tempo in BPM) from the body and the director's mood. The tempo is the body's own rhythm
// (all four limbs, session.js rhythmBpm) when it has a clear one; otherwise Muse's tempo for the mood.
function musicTargets(f, msg) {
  const mood = state.modelMood ? word(msg?.mood) : '';
  const rhythm = f.rhythm?.strength > 0.3 ? f.rhythm : null;
  return {
    energy: clamp01(0.1 + 0.55 * Math.min(f.pace / 1.2, 1) + 0.35 * Math.min(f.arm / 20, 1)),
    danceability: clamp01(0.2 + 0.7 * (rhythm?.strength ?? 0) + 0.1 * Math.min(f.arm / 20, 1)),
    valence: clamp01(0.25 + 0.45 * f.upright + (MOOD_VALENCE[mood] ?? 0)),
    acousticness: clamp01(0.15 + 0.7 * f.still),
    instrumentalness: clamp01(0.1 + 0.6 * f.still),       // still, focused stretches: fewer vocals
    loudness: -16 + 10 * clamp01(f.pace / 1.2),           // dB: louder songs for faster movement
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
    ['Valence', t.valence.toFixed(2)], ['Acoustic', t.acousticness.toFixed(2)], ['Tempo', t.tempo ? `${t.tempo} BPM · ${t.tempoFrom}` : '-'],
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
  if (performance.now() - lastFeaturesAt < 500) return;
  lastFeaturesAt = performance.now();
  const targets = { ...musicTargets(f, state.last), at: t };
  renderFeatures(f, targets);
  els.chainWindow.textContent = `The 3D body from ${clock(Math.max(0, t - f.window))} to ${clock(t)}.`;
  maybeAskSongs(targets);
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- Songs: ReccoBeats, from the targets ----------

const RECCO = 'https://api.reccobeats.com/v1';
const RECCO_TIMEOUT_MS = 6000;
const ASK_EVERY_MS = 15000;    // at most one request per 15 s, and only when the body changed
const songs = { asked: null, at: 0, request: 0, seeds: {}, profile: null };   // profile: Gymify's music, while it is on

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

// The seed song: ReccoBeats' top match for the words given: the mood the director's AI picked, or Gymify's style
// words from Muse Spark (no fixed seed).
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

function maybeAskSongs(t) {
  if (songs.profile || !t.mood || performance.now() - songs.at < ASK_EVERY_MS || !changed(t, songs.asked)) return;
  songs.asked = t;
  songs.at = performance.now();
  const request = ++songs.request;
  askSongs(t).then((list) => {
    if (request !== songs.request) return;
    player.queue = list.songs;
    drawSongs(list.songs);
    els.songsMood.textContent = `Seed: ${list.seed}`;
    els.songsNote.hidden = true;
    if (state.phase === 'live' && (!player.song || player.song.ended)) playSong(list.songs[0]);
  }).catch((err) => {
    if (request !== songs.request) return;
    els.songList.replaceChildren();
    els.songsNote.hidden = false;
    els.songsNote.textContent = `No songs: ${err.message}.`;
    songs.asked = null; // try again in 15 s
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
  // Each song's measured audio features, so the list shows how close it is and sorts by it.
  const features = await reccoGet(`/audio-features?ids=${encodeURIComponent(list.map((s) => s.id).join(','))}`);
  const by = new Map((features.content ?? []).map((x) => [spotifyId(x.href), x]));
  for (const s of list) {
    const x = by.get(s.spotifyId);
    s.tempo = x ? Math.round(x.tempo) : null;
    s.fit = x ? Math.abs(x.tempo - t.tempo) / 60 + Math.abs(x.energy - t.energy) + Math.abs(x.valence - t.valence) : 9;
    s.why = t.search ? `${t.from ?? 'Muse Spark'}: ${t.search}, ${Math.round(t.tempo)} BPM, energy ${t.energy.toFixed(2)}.`
      : `Picked at ${clock(t.at)} for energy ${t.energy.toFixed(2)}, ${t.tempo} BPM, ${t.mood} mood.`;
  }
  list.sort((a, b) => a.fit - b.fit);
  return { seed: `"${seed.name}"`, songs: list.slice(0, 5) };
}

function drawSongs(list) {
  els.songList.replaceChildren(...list.map((song) => {
    const li = Object.assign(document.createElement('li'), { className: 'song' });
    li.dataset.id = song.spotifyId;
    const info = Object.assign(document.createElement('div'), { className: 'song-info' });
    info.append(Object.assign(document.createElement('span'), { className: 'song-name', textContent: song.name }),
      Object.assign(document.createElement('span'), { className: 'song-artist', textContent: song.artist }));
    li.appendChild(info);
    if (song.tempo) li.appendChild(Object.assign(document.createElement('span'), { className: 'song-tempo', textContent: `${song.tempo} BPM` }));
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'song-play', textContent: 'Play' });
    btn.setAttribute('aria-label', `Play ${song.name}`);
    btn.addEventListener('click', () => playSong(song));
    li.appendChild(btn);
    return li;
  }));
  markPlaying();
}

// ---------- Player: one Spotify embed for Music and Stage, driven by Spotify's iFrame API ----------
// Spotify plays a 30 s preview, or the whole song when this browser is logged in to Spotify. When a song ends, the
// newest list's first other song plays, so the music follows the body at song boundaries, not mid-song.

const player = { api: null, ctrl: null, song: null, queue: [], paused: true, pos: 0, at: 0 };

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
  for (const li of els.songList.children) li.classList.toggle('is-playing', li.dataset.id === player.song?.spotifyId);
}

async function playSong(song) {
  if (!song || player.creating) return;
  player.song = { ...song, ended: false };
  // Some recommended tracks can't play in Spotify's embed (region or rights): if it hasn't started in 6 s, the next one
  setTimeout(() => {
    if (player.song?.spotifyId !== song.spotifyId || player.song.started || state.phase !== 'live') return;
    song.unplayable = true;
    const next = player.queue.find((s) => s.spotifyId !== song.spotifyId && !s.unplayable);
    if (next) playSong(next);
  }, 6000);
  els.playerBeat.textContent = song.tempo ? `${song.tempo} BPM` : 'BPM unknown';
  els.playerNote.textContent = song.why ?? '';
  markPlaying();
  const uri = `spotify:track:${song.spotifyId}`;
  if (player.ctrl) {
    player.ctrl.loadUri(uri);
    player.ctrl.play();
    // play() right after loadUri is often ignored while the song loads: ask again while it is still paused.
    for (const ms of [800, 1800, 3500]) {
      setTimeout(() => { if (player.paused && player.song?.spotifyId === song.spotifyId && state.phase === 'live') player.ctrl.resume(); }, ms);
    }
    return;
  }
  player.creating = true;
  try {
    const api = await spotifyApi();
    api.createController(els.playerEmbed, { uri, width: '100%', height: 80 }, (ctrl) => {
      player.ctrl = ctrl;
      player.creating = false;
      ctrl.addListener('ready', () => ctrl.play());
      ctrl.addListener('playback_update', ({ data }) => {
        Object.assign(player, { paused: data.isPaused, pos: data.position, at: performance.now() });
        const song = player.song;
        if (!song || !data.duration) return;
        // Right after loadUri the embed still reports the old song's end: count an end only after this one played.
        if (!data.isPaused && data.position > 0 && data.position < data.duration - 1500) song.started = true;
        // The end: near the duration, or (updates come ~1 s apart) back at 0 and paused once it had played.
        const atEnd = data.position >= data.duration - 400 || (data.isPaused && data.position === 0);
        if (song.started && atEnd && !song.ended) {
          player.song.ended = true;
          if (state.phase === 'live') playSong(player.queue.find((s) => s.spotifyId !== player.song.spotifyId));
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
  const live = state.phase === 'live';
  const hasRec = Boolean(session.rec);
  emit('state', { phase: state.phase, playing: live });
  els.playBtn.disabled = !hasRec || state.starting;
  els.restartBtn.disabled = !hasRec || state.starting;
  els.playBtn.dataset.state = live ? 'pause' : 'play';
  els.playLabel.textContent = state.starting ? 'Starting…' : live ? 'Pause' : state.phase === 'paused' ? 'Resume' : 'Play';
  for (const btn of els.tabBtns) btn.classList.toggle('is-live', live && btn.dataset.tab !== 'day');
  const status = live ? 'Live' : state.phase === 'paused' ? 'Paused' : state.phase === 'ended' ? 'Ended' : 'Waiting';
  for (const chip of [els.energyChip, els.musicState, els.chainState]) {
    chip.textContent = status;
    chip.classList.toggle('is-active', live);
  }
  els.musicPanel.classList.toggle('is-paused', !live);
  if (session.live) els.progressLabel.textContent = 'Live session';
  else if (!hasRec) els.progressLabel.textContent = 'Pick a recording';
  else if (live) els.progressLabel.textContent = `Live · message ${state.liveCount}`;
  else els.progressLabel.textContent = state.phase === 'ended' ? 'Director finished' : state.phase === 'paused' ? 'Paused' : 'Ready';
  els.progressFill.style.transform = `scaleX(${live ? 1 : 0})`;
}

function showNotice(text) {
  els.error.hidden = false;
  els.error.textContent = text;
}

function reset() {
  Object.assign(state, { phase: 'idle', cues: [], liveCount: 0, last: null, master: 1, modelMood: false });
  resetStage();
  els.timeline.replaceChildren();
  els.timelineCount.textContent = '0 cues';
  els.energyValue.textContent = '-';
  els.energySegs.forEach((s) => s.classList.remove('is-on'));
  els.energyNote.textContent = 'Press Play.';
  els.lightsAction.textContent = 'Waiting';
  els.lightsAction.classList.remove('is-active');
  els.lightsReason.hidden = true;
  els.tempoValue.textContent = '-';
  player.ctrl?.pause();
  player.song = null;
  player.queue = [];
  els.playerBeat.textContent = 'No song yet';
  els.playerNote.textContent = 'Press Play: the first song ReccoBeats picks for the body starts here.';
  songs.asked = null;
  songs.at = 0;
  songs.profile = null;
  els.songList.replaceChildren();
  els.songsNote.hidden = false;
  els.songsNote.textContent = 'Songs come once the body has moved for a few seconds.';
  els.songsMood.textContent = 'Waiting';
  els.features.replaceChildren();
}

// Play, Pause, Restart: the dev server starts the director on this recording from `start`; the page then connects.
async function startDirector(start) {
  if (!session.rec) return;
  state.starting = true;
  els.error.hidden = true;
  renderControls();
  try {
    const res = await fetch('/api/live/start', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run: session.rec.base, start, captions: 'muse' }) });
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error('Play needs the dev server: run npm run dev.');
    if (!res.ok) throw new Error(body.error || `The dev server answered ${res.status}.`);
    retryMs = LIVE_STARTING_RETRY_MS;
    connectLive();
    setTimeout(() => {
      if (state.starting) fail('The director started, but the page could not connect to it.');
    }, LIVE_START_TIMEOUT_MS);
  } catch (err) {
    fail(err.message);
  }
}

function fail(reason) {
  state.starting = false;
  retryMs = LIVE_RETRY_MS;
  showNotice(`Couldn't play. ${reason}`);
  renderControls();
}

async function stopDirector() {
  player.ctrl?.pause();
  await fetch('/api/live/stop', { method: 'POST' }).catch(() => {});
  state.phase = 'paused';
  renderControls();
}

function onPlay() {
  if (state.phase === 'live') stopDirector();
  else startDirector(state.phase === 'paused' ? els.body.currentTime : 0);
}

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
    retryMs = LIVE_RETRY_MS;
    els.error.hidden = true;
    if (player.song && !player.song.ended) player.ctrl?.resume();
    renderControls();
  });
  socket.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (!isValidMessage(msg) || !session.rec) return;
      emit('message', { msg, live: true });
      renderMessage(msg);
      addCue(msg);
      state.liveCount += 1;
      renderControls();
    } catch (err) {
      console.warn('Ignored bad live message:', err.message);
    }
  });
  socket.addEventListener('close', () => {
    socket = null;
    if (state.phase === 'live') state.phase = 'ended'; // the director closes at the end of the recording
    if (!state.starting) player.ctrl?.pause();
    renderControls();
    if (state.starting) scheduleConnect(); // retry only while a Play is waiting for the director

  });
}

// ---------- Startup ----------

document.addEventListener('lifelens:session', () => {
  if (state.phase === 'live') fetch('/api/live/stop', { method: 'POST' }).catch(() => {});
  reset();
  renderControls();
});
// Stagify's song plan: a planned section's song plays, and the body-based picks pause while the plan runs.
document.addEventListener('lifelens:play-song', (e) => {
  songs.profile = e.detail;
  player.queue = [e.detail];
  drawSongs([e.detail]);                            // the Music tab shows the planned song
  els.songsMood.textContent = 'Stagify plan';
  els.songsNote.hidden = true;
  if (state.phase === 'live') playSong(e.detail);
});
export { askSongs };

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
  if (state.phase === 'live') stopDirector();
});

buildBulbs();
els.playBtn.addEventListener('click', onPlay);
els.restartBtn.addEventListener('click', () => startDirector(0));
els.tabBtns.forEach((btn) => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));
els.tabs.addEventListener('keydown', onTabKeydown);
renderControls();
requestAnimationFrame(frame);
