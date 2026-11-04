// LifeLens front-end: the start screen and the dedicated Processing Studio loading screen.
// Shows live GPU/CPU hardware telemetry, lets the user start a live camera session or open a recording,
// and displays real-time 0-100% stage progress when processing a newly recorded clip.

import { fetchRecordings, openLive, openRecording, session } from './session.js';

const NAME_KEY = 'lifelens-name';
const $ = (id) => document.getElementById(id);
const nameInput = $('user-name');
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const note = (text) => { if ($('rec-note')) $('rec-note').textContent = text; };
let polling = null;

const DEFAULT_STAGES = [
  { id: 'ingest', label: 'Video ingest & 30 fps normalization', state: 'active' },
  { id: 'hawor', label: 'HaWoR 3D hand tracking & DROID-SLAM', state: 'pending' },
  { id: 'build_input', label: 'Floor plane & camera height calibration', state: 'pending' },
  { id: 'omniegocap', label: 'OmniEgoCap 3D full-body SMPL-H reconstruction', state: 'pending' },
  { id: 'render', label: '3D body mesh & kinematics stream rendering', state: 'pending' },
  { id: 'describe_muse', label: 'Meta Muse Spark egocentric scene narration', state: 'pending' },
  { id: 'posture_muse', label: 'Biomechanical & Meta Muse Spark posture analysis', state: 'pending' },
  { id: 'routine_tips', label: 'Meta Muse Spark routine coaching & history review', state: 'pending' },
];

function updateGreeting() {
  const val = nameInput.value.trim();
  const g = $('start-greeting');
  if (g) g.textContent = val ? `Welcome, ${val}` : 'Welcome to LifeLens';
}

function remember() {
  session.user = nameInput.value.trim();
  updateGreeting();
  try { localStorage.setItem(NAME_KEY, session.user); } catch { /* private window */ }
}

export function enter() {
  remember();
  document.body.classList.remove('is-starting');
  $('who').textContent = [session.user, session.live ? 'Live session' : session.rec?.name].filter(Boolean).join(' · ');
}

export function renderHardware(hw) {
  if (!hw) return;
  const shortCpu = (hw.cpu || 'Multi-core CPU').replace(/\(R\)|\(TM\)|CPU|@.*$/gi, '').replace(/\s+/g, ' ').trim();
  const startText = $('start-hw-text');
  if (startText) {
    const vramGb = hw.vramTotalMb ? ` (${Math.round(hw.vramTotalMb / 1024)} GB VRAM)` : '';
    startText.textContent = `${hw.gpu}${vramGb} · ${shortCpu} · Meta Muse Spark`;
  }
  const gpuName = $('hw-gpu-name');
  if (gpuName) gpuName.textContent = hw.gpu || 'GPU';
  const gpuMeta = $('hw-gpu-meta');
  if (gpuMeta) {
    const parts = [];
    if (hw.vramTotalMb) parts.push(`VRAM ${hw.vramUsedMb} / ${hw.vramTotalMb} MB`);
    if (hw.telemetry) parts.push(`Load ${hw.gpuUtilPct ?? 0}%`);
    if (hw.gpuTempC) parts.push(`${hw.gpuTempC}°C`);
    gpuMeta.textContent = parts.join(' · ') || 'No live GPU readings on this machine';
  }
  const gpuBar = $('hw-gpu-bar');
  if (gpuBar) {
    const vramPct = hw.vramTotalMb ? (hw.vramUsedMb / hw.vramTotalMb) * 100 : 0;
    const pct = hw.telemetry ? Math.min(100, Math.max(hw.gpuUtilPct || 0, vramPct)) : 0; // measured, or empty
    gpuBar.style.width = `${Math.round(pct)}%`;
  }
  const cpuName = $('hw-cpu-name');
  if (cpuName) cpuName.textContent = shortCpu;
  const cpuMeta = $('hw-cpu-meta');
  if (cpuMeta) cpuMeta.textContent = `${hw.cpuCores} logical threads · ${hw.ramGb} GB RAM · ${hw.platform}`;
  const stackChip = $('hw-stack-chip');
  if (stackChip && hw.stack) stackChip.textContent = hw.stack.split(' · ')[0];
}

async function fetchHardware() {
  try {
    const res = await fetch('/api/hardware', { cache: 'no-store' });
    if (res.ok) renderHardware(await res.json());
  } catch { /* ignore when static */ }
}

function renderProcessStages(stages = DEFAULT_STAGES) {
  const list = $('process-stages');
  if (!list) return;
  const activeIdx = stages.findIndex((s) => s.state === 'active');
  const doneCount = stages.filter((s) => s.state === 'done').length;
  const countChip = $('process-stage-count');
  if (countChip) {
    countChip.textContent = doneCount === stages.length
      ? `All ${stages.length} stages complete`
      : `Stage ${Math.min(stages.length, (activeIdx >= 0 ? activeIdx : doneCount) + 1)} of ${stages.length}`;
  }
  list.replaceChildren(...stages.map((s, i) => {
    const li = document.createElement('li');
    li.className = 'process-stage';
    li.dataset.state = s.state;
    const dot = document.createElement('span');
    dot.className = 'process-stage-dot';
    dot.textContent = s.state === 'done' ? '✓' : s.state === 'error' ? '!' : String(i + 1);
    const text = document.createElement('span');
    text.textContent = s.label;
    li.append(dot, text);
    return li;
  }));
}

export function showProcessModal({ name, step, percent = 0, elapsedMs = 0, stages = DEFAULT_STAGES, log = '', previewUrl = '' }) {
  const modal = $('process-screen');
  if (!modal) return;
  modal.hidden = false;
  $('process-close-btn').hidden = true;
  $('process-rec-name').textContent = name || 'new-session';
  $('process-step-label').textContent = step || 'Initializing 3D reconstruction & Meta Muse Spark…';
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  $('process-pct').textContent = `${pct}%`;
  $('process-bar-fill').style.width = `${pct}%`;
  $('process-progressbar')?.setAttribute('aria-valuenow', String(pct));
  $('process-elapsed').textContent = clock(elapsedMs / 1000);
  renderProcessStages(stages);
  if (log) {
    const logEl = $('process-log');
    logEl.textContent = log.trim().split('\n').slice(-10).join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }
  const previewWrap = $('process-preview-wrap');
  const previewVideo = $('process-preview-video');
  if (previewUrl && previewWrap && previewVideo) {
    previewWrap.hidden = false;
    if (previewVideo.src !== previewUrl) {
      previewVideo.src = previewUrl;
      previewVideo.play().catch(() => {});
    }
  }
}

export function hideProcessModal() {
  const modal = $('process-screen');
  if (modal) modal.hidden = true;
  const previewVideo = $('process-preview-video');
  if (previewVideo) {
    previewVideo.pause();
    previewVideo.removeAttribute('src');
  }
  const previewWrap = $('process-preview-wrap');
  if (previewWrap) previewWrap.hidden = true;
}

function item(name, meta, action, onClick) {
  const li = Object.assign(document.createElement('li'), { className: 'rec' });
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-small-text btn-primary', textContent: action });
  btn.addEventListener('click', () => onClick(btn));
  li.append(Object.assign(document.createElement('span'), { className: 'rec-name', textContent: name }),
    Object.assign(document.createElement('span'), { className: 'rec-meta', textContent: meta }), btn);
  return li;
}

export async function showRecordings() {
  $('rec-list').hidden = false;
  note('Loading sessions…');
  try {
    const { processed, raw } = await fetchRecordings();
    const countChip = $('rec-count-chip');
    if (countChip) countChip.textContent = `${processed.length} ready${raw.length ? ` · ${raw.length} raw` : ''}`;
    $('rec-processed').replaceChildren(...processed.map((rec) => item(rec.name, clock(rec.seconds), 'Open', async (btn) => {
      btn.disabled = true;
      await openRecording(rec);
      enter();
    })));
    $('rec-raw').replaceChildren(...raw.map((r) => item(r.name, `${Math.max(1, Math.round(r.size / 2 ** 20))} MB · raw`,
      'Process', (btn) => processVideo(r.file, btn))));
    note(processed.length || raw.length ? '' : 'No recordings yet: start a live session.');
  } catch (err) {
    note(`Recordings: ${err.message}.`);
  }
}

// Run the pipeline on a video in recordings/; shows the dedicated Processing Studio screen with progress bar & GPU telemetry.
export async function processVideo(file, btn, onStep = note, onReady, previewUrl = '') {
  if (btn) btn.disabled = true;
  const clipName = file.split('/').pop().replace(/\.[^.]+$/, '');
  showProcessModal({
    name: clipName,
    step: 'Uploading & starting 3D reconstruction pipeline…',
    percent: 0,
    elapsedMs: 0,
    stages: DEFAULT_STAGES,
    log: `Queued ${file} for HaWoR + OmniEgoCap + Meta Muse Spark…`,
    previewUrl,
  });
  fetchHardware();

  const res = await fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.error || `The dev server answered ${res.status}.`;
    onStep(msg);
    $('process-step-label').textContent = `Error: ${msg}`;
    $('process-close-btn').hidden = false;
    if (btn) btn.disabled = false;
    return;
  }
  if (body.hardware) renderHardware(body.hardware);

  clearInterval(polling);
  polling = setInterval(async () => {
    try {
      const job = await (await fetch('/api/process/status', { cache: 'no-store' })).json();
      if (job.hardware) renderHardware(job.hardware);
      if (job.error) {
        clearInterval(polling);
        onStep(`${job.name}: ${job.error}`);
        showProcessModal({
          name: job.name,
          step: job.error,
          percent: job.percent || 0,
          elapsedMs: job.elapsedMs || 0,
          stages: job.stages || DEFAULT_STAGES,
          log: job.log || job.error,
        });
        $('process-close-btn').hidden = false;
        if (btn) btn.disabled = false;
        return;
      }
      const pct = job.done ? 100 : (job.percent ?? 0);
      showProcessModal({
        name: job.name || clipName,
        step: job.done ? 'Session ready — opening studio…' : `${job.step} (${pct}%)`,
        percent: pct,
        elapsedMs: job.elapsedMs || 0,
        stages: job.stages || DEFAULT_STAGES,
        log: job.log || '',
      });
      onStep(job.done ? `${job.name} is ready.` : `Processing ${job.name}: ${job.step} (${pct}%)`);
      if (!job.done) return;
      clearInterval(polling);
      const { processed } = await fetchRecordings();
      const rec = processed.find((r) => r.name === job.name);
      setTimeout(() => {
        hideProcessModal();
        if (onReady && rec) onReady(rec);
        else showRecordings();
      }, 450);
    } catch { /* transient poll glitch */ }
  }, 1000);
}

try { nameInput.value = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* no storage */ }
updateGreeting();
nameInput.addEventListener('input', updateGreeting);
fetchHardware();
$('choose-rec').addEventListener('click', showRecordings);
$('choose-live').addEventListener('click', () => {
  openLive();
  enter();
});
$('change-btn').addEventListener('click', () => {
  document.body.classList.add('is-starting');
  document.dispatchEvent(new CustomEvent('lifelens:leave'));
  fetchHardware();
});
$('process-close-btn')?.addEventListener('click', hideProcessModal);
