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
const TAB_PANES = { activity: ['body', 'graph'], music: ['body', 'graph'], stage: ['body'] };
const TAB_TEXT = {
  activity: 'First-person POV, 3D SMPL-H body, live kinematics & session routine.',
  music: 'Movement pace, step cadence & arm swing select the tracks.',
  stage: '6 body-coupled stage fixtures driven by limb velocity & mood.',
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
