// LifeLens front-end: extras that follow the panel without changing it.
// - Videos of the open recording (POV, 3D body, kinematics): each tab opens its own panes and remembers the toggles;
//   the videos follow the director's clock while it plays.
// - AI badge: whether the director's Meta Muse Spark model is on.
// - Theme switch: light or dark, remembered in this browser.

import { mediaSet } from './media.js';
import { session } from './session.js';
import './live.js';

const $ = (id) => document.getElementById(id);

// ---------- Cute / Quirky Illustrated Empty-State Cards (Gym, Dance Studio, and <10s Music) ----------

const ILLUSTRATIONS = {
  stage: `<svg viewBox="0 0 220 140" class="quirky-svg" aria-hidden="true">
    <defs>
      <linearGradient id="qStageBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#2B44E8" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="#C83E1B" stop-opacity="0.16"/>
      </linearGradient>
    </defs>
    <rect x="8" y="8" width="204" height="124" rx="18" fill="url(#qStageBg)" stroke="currentColor" stroke-opacity="0.14"/>
    <!-- Velvet stage curtains tied back -->
    <path d="M8 26 C42 26, 38 85, 18 124 L8 124 Z" fill="#C83E1B" opacity="0.75"/>
    <path d="M212 26 C178 26, 182 85, 202 124 L212 124 Z" fill="#C83E1B" opacity="0.75"/>
    <circle cx="24" cy="78" r="5" fill="#F0A830"/>
    <circle cx="196" cy="78" r="5" fill="#F0A830"/>
    <!-- Top truss & snoozing disco ball -->
    <line x1="28" y1="24" x2="192" y2="24" stroke="currentColor" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round"/>
    <line x1="110" y1="24" x2="110" y2="40" stroke="currentColor" stroke-opacity="0.45" stroke-width="2"/>
    <circle cx="110" cy="58" r="19" fill="#2B44E8" opacity="0.22" stroke="#2B44E8" stroke-width="2"/>
    <!-- Cute sleeping eyes on disco ball -->
    <path d="M101 56 Q105 60 109 56" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M112 56 Q116 60 120 56" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M107 64 Q110 67 113 64" fill="none" stroke="#C83E1B" stroke-width="2" stroke-linecap="round"/>
    <!-- Snoozing spotlights on truss -->
    <g transform="translate(62,24)">
      <rect x="-8" y="0" width="16" height="12" rx="4" fill="currentColor" opacity="0.65"/>
      <text x="-14" y="28" font-size="11" font-weight="700" fill="#2B44E8">Zzz</text>
    </g>
    <g transform="translate(158,24)">
      <rect x="-8" y="0" width="16" height="12" rx="4" fill="currentColor" opacity="0.65"/>
      <text x="4" y="26" font-size="10" font-weight="700" fill="#C83E1B">zZ</text>
    </g>
    <!-- Cozy steaming noodle bowl center stage -->
    <ellipse cx="110" cy="116" rx="38" ry="6" fill="currentColor" opacity="0.12"/>
    <path d="M88 98 L132 98 C130 113, 90 113, 88 98 Z" fill="#C83E1B"/>
    <rect x="85" y="94" width="50" height="5" rx="2.5" fill="#F0A830"/>
    <path d="M100 89 Q103 83 100 78 M110 89 Q113 82 110 76 M120 89 Q123 83 120 78" fill="none" stroke="currentColor" stroke-opacity="0.55" stroke-width="2" stroke-linecap="round"/>
    <line x1="118" y1="93" x2="140" y2="80" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="122" y1="95" x2="144" y2="85" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,

  gym: `<svg viewBox="0 0 220 140" class="quirky-svg" aria-hidden="true">
    <defs>
      <linearGradient id="qGymBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1C7A3A" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="#F0A830" stop-opacity="0.18"/>
      </linearGradient>
    </defs>
    <rect x="8" y="8" width="204" height="124" rx="18" fill="url(#qGymBg)" stroke="currentColor" stroke-opacity="0.14"/>
    <!-- Cozy pillow under the dumbbell -->
    <rect x="42" y="72" width="136" height="36" rx="16" fill="#FFFFFF" fill-opacity="0.65" stroke="currentColor" stroke-opacity="0.2" stroke-width="1.5"/>
    <!-- Cute cartoon dumbbell napping -->
    <rect x="52" y="60" width="22" height="42" rx="7" fill="#2B44E8"/>
    <rect x="44" y="66" width="10" height="30" rx="4" fill="#1C7A3A"/>
    <rect x="146" y="60" width="22" height="42" rx="7" fill="#2B44E8"/>
    <rect x="166" y="66" width="10" height="30" rx="4" fill="#1C7A3A"/>
    <rect x="74" y="74" width="72" height="14" rx="6" fill="currentColor" opacity="0.75"/>
    <!-- Cozy blanket tucked over middle of dumbbell with smiling face -->
    <path d="M78 70 Q110 56 142 70 L146 104 Q110 110 74 104 Z" fill="#C83E1B"/>
    <path d="M98 82 Q102 86 106 82" fill="none" stroke="#FAF9F5" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M114 82 Q118 86 122 82" fill="none" stroke="#FAF9F5" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M106 90 Q110 94 114 90" fill="none" stroke="#F0A830" stroke-width="2.2" stroke-linecap="round"/>
    <!-- 0 REPS badge & Zzz -->
    <rect x="68" y="22" width="84" height="22" rx="11" fill="#F0A830" opacity="0.9"/>
    <text x="110" y="37" text-anchor="middle" font-size="10" font-weight="800" fill="#141413">0 REPS · COZY MODE</text>
    <text x="162" y="48" font-size="12" font-weight="800" fill="#1C7A3A">Zzz</text>
  </svg>`,

  music: `<svg viewBox="0 0 220 140" class="quirky-svg" aria-hidden="true">
    <defs>
      <linearGradient id="qMusicBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#C83E1B" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="#2B44E8" stop-opacity="0.18"/>
      </linearGradient>
    </defs>
    <rect x="8" y="8" width="204" height="124" rx="18" fill="url(#qMusicBg)" stroke="currentColor" stroke-opacity="0.14"/>
    <!-- Headphones arc -->
    <path d="M68 74 A42 42 0 0 1 152 74" fill="none" stroke="#2B44E8" stroke-width="6" stroke-linecap="round"/>
    <rect x="58" y="66" width="14" height="28" rx="7" fill="#C83E1B"/>
    <rect x="148" y="66" width="14" height="28" rx="7" fill="#C83E1B"/>
    <!-- Vinyl record character with quirky expression -->
    <circle cx="110" cy="80" r="34" fill="#1D2028" stroke="currentColor" stroke-opacity="0.25" stroke-width="2"/>
    <circle cx="110" cy="80" r="24" fill="none" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="1.5" stroke-dasharray="6 4"/>
    <circle cx="110" cy="80" r="13" fill="#F0A830"/>
    <!-- Surprised cute eyes on the vinyl label -->
    <circle cx="105" cy="78" r="2.2" fill="#141413"/>
    <circle cx="115" cy="78" r="2.2" fill="#141413"/>
    <circle cx="110" cy="85" r="2.5" fill="#C83E1B"/>
    <!-- Stopwatch badge & question-mark notes -->
    <rect x="64" y="18" width="92" height="22" rx="11" fill="#C83E1B"/>
    <text x="110" y="33" text-anchor="middle" font-size="10" font-weight="800" fill="#FAF9F5">⏱ UNDER 10s CLIP?!</text>
    <text x="34" y="54" font-size="16" font-weight="800" fill="#2B44E8">♪?</text>
    <text x="172" y="52" font-size="15" font-weight="800" fill="#C83E1B">♫?</text>
  </svg>`,
};

export function buildQuirkyCard(kind, activity = 'an everyday moment', custom = {}) {
  const act = activity || 'an everyday moment';
  const copy = {
    stage: {
      kicker: '🎭 Dance Studio on Standby · Cozy Moment',
      title: 'The Dance Studio spotlights are on a noodle break',
      text: `Meta Muse Spark peeked through the velvet curtains and saw ${act} — 10/10 form, zero choreography! Strobe lights and fog machines felt a little dramatic for a quiet moment, so all six stage fixtures are snoozing. Bring some dance moves, jumps, or a workout in your next clip and the whole Dance Studio will light right up!`,
      pill: 'Switch to Routine or Music to explore this session',
    },
    gym: {
      kicker: '🏋️ Gymify Rest Day · 0 Workout Reps',
      title: "Wrist curls with a fork don't count as a set (we checked!)",
      text: `Meta Muse Spark inspected every 3D joint and spotted ${act} instead of a workout set. The dumbbells are officially napping under a blanket — enjoy the fuel-up, and bring squats, lunges, or push-ups when you're ready to track reps, depth, and left-right symmetry!`,
      pill: 'Open the exercising session to see live 3D rep & depth coaching',
    },
    music: {
      kicker: custom.kicker || '⏱️ Short Clip (< 10 seconds) · AI DJ Warming Up',
      title: custom.title || 'Hold the drop — that was a blink, not a groove!',
      text: custom.text || 'Your clip clocked in under 10 seconds. Our AI DJ barely put its headphones on before the tape ran out! Give us at least 10–20 seconds of movement so we can read your pace, step cadence, and arm swing to know what song fits you best.',
      pill: custom.pill || '10–30s clips lock 1 best song · 35s+ clips sync 1 song per ~20s window',
    },
  }[kind] || copy.music;

  const wrap = document.createElement('div');
  wrap.className = `quirky-card quirky-card-${kind}`;
  const art = document.createElement('div');
  art.className = 'quirky-art';
  art.innerHTML = ILLUSTRATIONS[kind] || ILLUSTRATIONS.music;

  const body = document.createElement('div');
  body.className = 'quirky-body';
  const kicker = Object.assign(document.createElement('span'), { className: 'quirky-kicker', textContent: copy.kicker });
  const title = Object.assign(document.createElement('strong'), { className: 'quirky-title', textContent: copy.title });
  const text = Object.assign(document.createElement('p'), { className: 'quirky-text', textContent: copy.text });
  const pill = Object.assign(document.createElement('span'), { className: 'quirky-pill', textContent: copy.pill });
  body.append(kicker, title, text, pill);
  wrap.append(art, body);
  return wrap;
}

// ---------- Videos ----------

const SYNC_TOLERANCE_S = 0.75;
const LIVE_IDLE_MS = 3000;
const TAB_PANES = { activity: ['body', 'graph'], music: ['body', 'graph'], stage: ['body', 'graph'], gym: ['body', 'graph'] };
// Stage and Gym have their own main view (stage.js show, gym.js viewer) over the POV; the rail keeps the body and graph.
const TAB_TEXT = {
  activity: 'First-person POV, 3D body, live kinematics & session routine.',
  music: 'Video & music player in sync: 1 matched song per ~20s movement window (1 song for 20–30s clips).',
  stage: 'Lights follow each body part, poses, jumps, turns and hits; Muse Spark designs the scene.',
  gym: 'Gymify: reps, sets, range of motion, tempo and symmetry from the 3D body; Muse Spark gives form feedback.',
};

const mediaRoot = $('media');
const media = mediaSet(mediaRoot);
const chosen = {};
let tab = document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab ?? 'activity';
let liveIdleTimer = null;

function openTab(next) {
  if (next !== tab && TAB_PANES[tab]) chosen[tab] = media.shown();
  tab = next;
  mediaRoot.dataset.tab = tab;
  renderActions();
  renderRest();
  mediaRoot.hidden = !TAB_PANES[tab];
  if (!TAB_PANES[tab]) return;
  media.show(chosen[tab] ?? TAB_PANES[tab]);
  $('media-sub').textContent = session.live
    ? 'Live camera with Meta Muse Spark captions every 6 s. Click Record, then Stop to reconstruct the 3D body.'
    : TAB_TEXT[tab];
}

function clipSeconds(time) {
  const parts = typeof time === 'string' ? time.split(':').map(Number) : [];
  return parts.length === 3 && parts.every(Number.isFinite) ? parts[0] * 3600 + parts[1] * 60 + parts[2] : NaN;
}

document.addEventListener('lifelens:tab', (event) => openTab(event.detail.tab));

document.addEventListener('lifelens:session', () => {
  const rec = session.rec;
  if (rec) {
    media.setSources({ pov: rec.pov, body: rec.body, graph: rec.graph });
    $('media-title').textContent = rec.name;
    $('media-caption').textContent = 'POV: head camera · 3D body & kinematics: OmniEgoCap + HaWoR · AI: Meta Muse Spark.';
  } else if (session.live) {
    media.clear();
    $('media-title').textContent = 'Live session';
    $('media-caption').textContent = '';
  }
  openTab(tab);
});

document.addEventListener('lifelens:message', (event) => {
  if (!TAB_PANES[tab]) return;
  const t = clipSeconds(event.detail.msg.time);
  if (Number.isFinite(t) && Math.abs(media.body.currentTime - t) > SYNC_TOLERANCE_S) media.seek(t);
  if (media.body.paused) media.play();
  clearTimeout(liveIdleTimer);
  liveIdleTimer = setTimeout(() => media.pause(), LIVE_IDLE_MS);
});

document.addEventListener('lifelens:state', (event) => {
  if (event.detail.phase !== 'live' && !event.detail.playing) media.pause();
});
document.addEventListener('lifelens:leave', () => media.pause());

export { media };

// ---------- AI badge ----------

const aiState = $('ai-state');
const aiBadge = $('ai-badge');

// Meta model calls panel: the AI badge opens it; every 2 s it shows the newest Muse Spark calls (model, request, reply)
const FEATURE = { captions: 'Captions', posture_muse: 'Posture', routine_tips: 'Routine feedback', gymify: 'Gymify form feedback',
  server: 'Director mood', live_caption: 'Live caption', stage_scene: 'Stage scene', stagify_plan: 'Stagify plan', songs: 'Songs' };
let logTimer = null;
async function showCalls() {
  const calls = await fetch('/api/muse/log', { cache: 'no-store' }).then((r) => r.json()).catch(() => []);
  $('muse-log-list').replaceChildren(...calls.map((c) => {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'muse-call-head';
    head.textContent = [new Date(c.t).toLocaleTimeString(), FEATURE[c.feature] ?? c.feature, c.model, c.effort && `effort ${c.effort}`,
      c.ms != null && `${(c.ms / 1000).toFixed(1)} s`].filter(Boolean).join(' · ');
    const ask = document.createElement('p');
    ask.className = 'muse-call-text';
    ask.textContent = `→ ${c.prompt}${c.images ? ` [+ ${c.images} image${c.images > 1 ? 's' : ''}]` : ''}`;
    const reply = document.createElement('p');
    reply.className = `muse-call-text${c.error ? ' is-error' : ''}`;
    reply.textContent = c.error ? `✕ ${c.error}` : `← ${c.reply}`;
    li.append(head, ask, reply);
    return li;
  }));
}
function toggleCalls(open = $('muse-log').hidden) {
  $('muse-log').hidden = !open;
  aiBadge.setAttribute('aria-expanded', String(open));
  clearInterval(logTimer);
  if (open) { showCalls(); logTimer = setInterval(showCalls, 2000); }
}
aiBadge.addEventListener('click', () => toggleCalls());
aiBadge.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCalls(); } });
$('muse-log-close').addEventListener('click', () => toggleCalls(false));

const ACTIONS = { stage: { btn: 'stagify-btn', status: 'stagify-status', done: () => Boolean(document.querySelector('#stagify-out a')) || Boolean(session.rec?.files?.['stage.json']), again: 'Stagify again' },
  gym: { btn: 'gym-btn', status: 'gym-status', done: () => Boolean(document.querySelector('#gym-result .gym-ex')), again: 'Run Gymify again' } };
const firstLabel = {};

function renderRest() {
  const restBox = $('rest-note');
  const inactive = (tab === 'stage' || tab === 'gym') && session.active === false;
  const shortMusic = tab === 'music' && session.tooShort === true;
  if (!inactive && !shortMusic) {
    restBox.hidden = true;
    $('stage-dock').hidden = tab !== 'stage';
    const rig = document.querySelector('.panel-lights');
    if (rig) rig.hidden = false;
    return;
  }
  const kind = shortMusic ? 'music' : tab;
  restBox.replaceChildren(buildQuirkyCard(kind, session.activity || 'an everyday moment'));
  restBox.hidden = false;
  $('stage-dock').hidden = true;
  // Also show a friendly card in the Stage right-rail when Stage is inactive
  if (tab === 'stage' && inactive) {
    let railNote = $('stage-rail-quirky');
    if (!railNote) {
      railNote = document.createElement('div');
      railNote.id = 'stage-rail-quirky';
      $('view-stage')?.prepend(railNote);
    }
    railNote.replaceChildren(buildQuirkyCard('stage', session.activity || 'an everyday moment'));
    railNote.hidden = false;
    const rig = document.querySelector('.panel-lights');
    if (rig) rig.hidden = true;
  } else {
    const railNote = $('stage-rail-quirky');
    if (railNote) railNote.hidden = true;
    const rig = document.querySelector('.panel-lights');
    if (rig) rig.hidden = false;
  }
}
document.addEventListener('lifelens:activity', () => { renderRest(); renderActions(); });

function renderActions() {
  for (const [name, a] of Object.entries(ACTIONS)) {
    const box = document.querySelector(`.media-action[data-tab="${name}"]`);
    const btn = $(a.btn);
    firstLabel[name] ??= btn.textContent;
    box.hidden = tab !== name || !session.rec || session.live || session.active === false;
    box.dataset.state = btn.disabled ? 'running' : a.done() ? 'done' : 'idle';
    btn.textContent = box.dataset.state === 'done' ? a.again : firstLabel[name];
    box.querySelector('.action-status').textContent = btn.disabled ? $(a.status)?.textContent ?? '' : '';
  }
}
setInterval(renderActions, 600);

function setAi(text, mode) {
  aiState.textContent = text;
  aiBadge.dataset.mode = mode;
}

document.addEventListener('lifelens:state', (event) => {
  if (event.detail.phase === 'live' && aiBadge.dataset.mode === 'idle') setAi('Streaming', 'waiting');
});

document.addEventListener('lifelens:message', (event) => {
  const { msg } = event.detail;
  const decision = typeof msg.model_decision === 'string' ? msg.model_decision : '';
  if (/^Model calls are disabled/i.test(decision)) setAi('Local rules', 'off');
  else if (msg.source === 'slow') setAi('Active', 'on');
});

document.addEventListener('lifelens:session', () => setAi('Ready', 'idle'));

// ---------- Theme switch ----------

const THEME_KEY = 'lifelens-theme';
const themeBtn = $('theme-toggle');
const themeLabel = $('theme-label');
const themeMeta = document.querySelector('meta[name="theme-color"]');

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeBtn.setAttribute('aria-pressed', String(dark));
  themeLabel.textContent = dark ? 'Light' : 'Dark';
  themeBtn.title = dark ? 'Switch to the light theme' : 'Switch to the dark theme';
  if (themeMeta) themeMeta.content = dark ? '#0E1015' : '#FAF9F5';
}

function savedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}

applyTheme(savedTheme() === 'dark' ? 'dark' : 'light');
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private window */ }
});
