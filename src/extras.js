// LifeLens front-end: extras that follow the panel without changing it.
// - Videos of the open recording (POV, 3D body, kinematics): each tab opens its own panes and remembers the toggles;
//   the videos follow the director's clock while it plays.
// - AI badge: whether the director's Meta Muse Spark model is on.
// - Theme switch: light or dark, remembered in this browser.

import { mediaSet } from './media.js';
import { session } from './session.js';
import './live.js';

const $ = (id) => document.getElementById(id);

// ---------- Videos ----------

const SYNC_TOLERANCE_S = 0.75;
const LIVE_IDLE_MS = 3000;
const TAB_PANES = { activity: ['body', 'graph'], music: ['body', 'graph'], stage: ['body'], gym: ['body', 'graph'] };
// Stage and Gym have their own main view (stage.js show, gym.js viewer) over the POV; the rail keeps the body and graph.
const TAB_TEXT = {
  activity: 'First-person POV, 3D body, live kinematics & session routine.',
  music: 'Movement pace, step cadence & arm swing select the tracks.',
  stage: 'Lights follow each body part, poses, jumps, turns and hits; Muse Spark designs the scene. The stage plays in the main view.',
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
  if (event.detail.phase !== 'live') media.pause();
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
