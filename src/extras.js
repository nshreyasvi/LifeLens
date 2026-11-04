// LifeLens front-end: extras that follow the panel without changing it.
// - Videos of the open recording (POV, 3D body, kinematics): each tab opens its own panes and remembers the toggles;
//   the videos follow the director's clock while it plays.
// - AI badge: whether the director's Meta model is on.
// - Theme switch: light or dark, remembered in this browser.
// main.js sends "lifelens:tab", "lifelens:message" and "lifelens:state"; session.js sends "lifelens:session".

import { mediaSet } from './media.js';
import { session } from './session.js';
import './live.js';

const $ = (id) => document.getElementById(id);

// ---------- Videos ----------

const SYNC_TOLERANCE_S = 0.75; // only jump when the video drifts further than this
const LIVE_IDLE_MS = 3000;     // pause when the director stops sending
const TAB_PANES = { activity: [], music: ['body', 'graph'], stage: ['body'] };
const TAB_TEXT = {
  activity: 'What the head camera saw; the 3D body opens beside it.',
  music: 'Its pace, steps and arm swing pick the songs.',
  stage: 'Each light follows one part of the body.',
};

const mediaRoot = $('media');
const media = mediaSet(mediaRoot);
const chosen = {};
let tab = document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab ?? 'activity';
let liveIdleTimer = null;

function openTab(next) {
  if (TAB_PANES[tab]) chosen[tab] = media.shown();
  tab = next;
  mediaRoot.dataset.tab = tab;
  mediaRoot.hidden = !TAB_PANES[tab];
  if (!TAB_PANES[tab]) return;
  media.show(chosen[tab] ?? TAB_PANES[tab]);
  $('media-sub').textContent = session.live ? 'Live: Muse captions and posture every 6 s. The 3D body, music and lights come after you stop.' : TAB_TEXT[tab];
}

// Director time looks like "0:00:44.133" (hours:minutes:seconds into the clip).
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
    $('media-caption').textContent = 'POV: the head camera. 3D body and kinematics: LifeLens, from that video.';
  } else if (session.live) {
    $('media-title').textContent = 'Live session';
    $('media-caption').textContent = '';
  }
  openTab(tab);
});

document.addEventListener('lifelens:message', (event) => {
  if (!TAB_PANES[tab]) return; // Routine: the director is stopping; don't restart these videos
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
  if (event.detail.phase === 'live' && aiBadge.dataset.mode === 'idle') setAi('Waiting', 'waiting');
});

document.addEventListener('lifelens:message', (event) => {
  const { msg } = event.detail;
  const decision = typeof msg.model_decision === 'string' ? msg.model_decision : '';
  if (/^Model calls are disabled/i.test(decision)) setAi('Off', 'off');
  else if (msg.source === 'slow') setAi('Muse Spark on', 'on');
});

document.addEventListener('lifelens:session', () => setAi('Idle', 'idle'));

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
  if (themeMeta) themeMeta.content = dark ? '#0B0D12' : '#FFFFFF';
}

function savedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}

applyTheme(savedTheme() === 'dark' ? 'dark' : 'light');
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private window: just don't remember */ }
});
