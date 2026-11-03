// LifeLens front-end: extras that follow the panel without changing it.
// - POV box: plays the 3D body video of the office clip, synced to the director's time.
// - AI badge: names the director's Meta models and shows whether they are on.
// - Theme switch: light or dark, remembered in this browser.
// main.js sends "lifelens:message" and "lifelens:state" events; this file only listens.

const $ = (id) => document.getElementById(id);

// ---------- POV video ----------

const VIDEO_START_S = 23;       // the clip time the demo starts from (same as --start 23)
const SYNC_TOLERANCE_S = 0.75;  // only jump when the video drifts further than this
const LIVE_IDLE_MS = 3000;      // pause when the director stops sending

const video = $('pov-video');
let liveIdleTimer = null;

// Director time looks like "0:00:44.133" (hours:minutes:seconds); sample data uses clock
// times like "19:00:05", which are not clip times, so those are ignored.
function clipSeconds(time) {
  if (typeof time !== 'string') return NaN;
  const parts = time.split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return NaN;
  const [h, m, s] = parts;
  return h * 3600 + m * 60 + s;
}

function play() {
  const p = video.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

function onMessage(event) {
  if (!video) return;
  const { msg, live } = event.detail;
  if (!live) return;
  const t = clipSeconds(msg.time);
  if (Number.isFinite(t) && Number.isFinite(video.duration) && t < video.duration) {
    if (Math.abs(video.currentTime - t) > SYNC_TOLERANCE_S) video.currentTime = t;
  }
  if (video.paused) play();
  clearTimeout(liveIdleTimer);
  liveIdleTimer = setTimeout(() => video.pause(), LIVE_IDLE_MS);
}

function onState(event) {
  if (!video) return;
  const { phase, playing } = event.detail;
  if (phase === 'live') return; // live messages drive the video
  clearTimeout(liveIdleTimer);
  if ((phase === 'activity' || phase === 'stage') && playing) play();
  else video.pause();
  if (phase === 'idle') video.currentTime = VIDEO_START_S;
}

if (video) {
  video.addEventListener('loadedmetadata', () => {
    if (video.currentTime < VIDEO_START_S) video.currentTime = VIDEO_START_S;
  });
  document.addEventListener('lifelens:message', onMessage);
  document.addEventListener('lifelens:state', onState);
}

// ---------- AI badge ----------

const aiState = $('ai-state');
const aiBadge = $('ai-badge');

function setAi(text, mode) {
  if (!aiState) return;
  aiState.textContent = text;
  aiBadge.dataset.mode = mode;
}

document.addEventListener('lifelens:state', (event) => {
  const { phase } = event.detail;
  if (phase !== 'live') setAi('Sample data', 'demo');
  else if (aiBadge.dataset.mode === 'demo') setAi('Waiting', 'waiting');
});

document.addEventListener('lifelens:message', (event) => {
  const { msg, live } = event.detail;
  if (!live) return;
  const decision = typeof msg.model_decision === 'string' ? msg.model_decision : '';
  if (/^Model calls are disabled/i.test(decision)) setAi('Off (test run)', 'off');
  else if (decision || msg.source === 'slow') setAi('On', 'on');
});

// ---------- Theme switch ----------

const THEME_KEY = 'lifelens-theme';
const themeBtn = $('theme-toggle');
const themeLabel = $('theme-label');
const themeMeta = document.querySelector('meta[name="theme-color"]');

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (themeBtn) {
    themeBtn.setAttribute('aria-pressed', String(dark));
    themeLabel.textContent = dark ? 'Light' : 'Dark';
    themeBtn.title = dark ? 'Switch to the light theme' : 'Switch to the dark theme';
  }
  if (themeMeta) themeMeta.content = dark ? '#0B0D12' : '#FFFFFF';
}

function savedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}

applyTheme(savedTheme() === 'dark' ? 'dark' : 'light');

if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private window: just don't remember */ }
  });
}
