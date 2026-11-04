// LifeLens front-end: the start screen. Your name, then a new live session or a recording: one LifeLens processed
// (opens at once) or a video in recordings/ that the dev server processes now (vite.config.js).

import { fetchRecordings, openLive, openRecording, session } from './session.js';

const NAME_KEY = 'lifelens-name';
const $ = (id) => document.getElementById(id);
const nameInput = $('user-name');
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const note = (text) => { $('rec-note').textContent = text; };
let polling = null;

function remember() {
  session.user = nameInput.value.trim();
  try { localStorage.setItem(NAME_KEY, session.user); } catch { /* private window: just don't remember */ }
}

function enter() {
  remember();
  document.body.classList.remove('is-starting');
  $('who').textContent = [session.user, session.live ? 'Live session' : session.rec?.name].filter(Boolean).join(' · ');
}

function item(name, meta, action, onClick) {
  const li = Object.assign(document.createElement('li'), { className: 'rec' });
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-small-text', textContent: action });
  btn.addEventListener('click', () => onClick(btn));
  li.append(Object.assign(document.createElement('span'), { className: 'rec-name', textContent: name }),
    Object.assign(document.createElement('span'), { className: 'rec-meta', textContent: meta }), btn);
  return li;
}

export async function showRecordings() {
  $('rec-list').hidden = false;
  note('Looking for recordings…');
  try {
    const { processed, raw } = await fetchRecordings();
    $('rec-processed').replaceChildren(...processed.map((rec) => item(rec.name, clock(rec.seconds), 'Open', async (btn) => {
      btn.disabled = true;
      await openRecording(rec);
      enter();
    })));
    $('rec-raw').replaceChildren(...raw.map((r) => item(r.name, `${Math.max(1, Math.round(r.size / 2 ** 20))} MB, not processed`,
      'Process', (btn) => processVideo(r.file, btn))));
    note(processed.length || raw.length ? '' : 'No recordings yet: start a live session.');
  } catch (err) {
    note(`Recordings: ${err.message}.`);
  }
}

// Run the pipeline on a video in recordings/; `onStep` hears every status, `onReady` gets the processed recording.
export async function processVideo(file, btn, onStep = note, onReady) {
  if (btn) btn.disabled = true;
  const res = await fetch('/api/process', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    onStep(body.error || `The dev server answered ${res.status}.`);
    if (btn) btn.disabled = false;
    return;
  }
  clearInterval(polling);
  polling = setInterval(async () => {
    const job = await (await fetch('/api/process/status')).json();
    if (job.error) {
      clearInterval(polling);
      onStep(`${job.name}: ${job.error}`);
      return;
    }
    onStep(job.done ? `${job.name} is ready.` : `Processing ${job.name}: ${job.step} (${job.index + 1} of ${job.steps.length})`);
    if (!job.done) return;
    clearInterval(polling);
    const { processed } = await fetchRecordings();
    const rec = processed.find((r) => r.name === job.name);
    if (onReady && rec) onReady(rec);
    else showRecordings();
  }, 3000);
}

try { nameInput.value = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* no storage */ }
$('choose-rec').addEventListener('click', showRecordings);
$('choose-live').addEventListener('click', () => {
  openLive();
  enter();
});
$('change-btn').addEventListener('click', () => {
  document.body.classList.add('is-starting');
  document.dispatchEvent(new CustomEvent('lifelens:leave'));
});
export { enter };
