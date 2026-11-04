// LifeLens front-end: a live session. The camera is the POV, with Muse Spark's live captions; Record films it and Stop
// saves it to recordings/ (dev server). Process (now, or later from "Open a recording") builds its 3D body, posture,
// captions and Muse Spark review, with the Processing screen's progress and GPU/CPU telemetry.

import { media } from './extras.js';
import { openRecording, session } from './session.js';
import { cameraSelect, enter, processVideo } from './start.js';

const $ = (id) => document.getElementById(id);
const btn = $('record-btn');
const label = $('record-label');
const caption = $('media-caption');
const TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
let stream = null;
let recorder = null;
let chunks = [];
let started = 0;
let ticker = null;
let liveRun = 0;
let previewBlobUrl = '';
const CAPTION_EVERY_MS = 6000;
const overlay = $('live-overlay');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function grab() {
  const v = media.pov;
  if (!v.videoWidth) return null;
  const c = Object.assign(document.createElement('canvas'), { width: 448, height: Math.round(448 * v.videoHeight / v.videoWidth) });
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

async function captionLoop(run) {
  overlay.hidden = false;
  $('live-posture').textContent = 'Muse Spark';
  $('live-caption').textContent = 'Watching…';
  while (run === liveRun) {
    const t0 = performance.now();
    const first = grab();
    await wait(1000);
    const images = [first, grab()].filter(Boolean);
    if (images.length && run === liveRun) {
      try {
        const res = await fetch('/api/live/caption', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images }) });
        const body = await res.json().catch(() => ({}));
        if (run !== liveRun) break;
        if (!res.ok) throw new Error(body.error || `the dev server answered ${res.status}`);
        $('live-posture').textContent = body.posture || 'Muse Spark';
        $('live-caption').textContent = `${body.caption} (${(body.ms / 1000).toFixed(1)} s)`;
      } catch (err) {
        $('live-caption').textContent = `Live caption: ${err.message}.`;
        if (/key/i.test(err.message)) break;
      }
    }
    await wait(Math.max(0, CAPTION_EVERY_MS - (performance.now() - t0)));
  }
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const say = (text) => { caption.textContent = text; };

async function startCamera() {
  media.clear();
  showRequirement();           // what a live 3D body needs, with or without a camera
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: 'environment' },
      audio: false,
    });
    media.setLive(stream);
    btn.disabled = false;
    captionLoop(++liveRun);
    say('Camera live · Record, then Stop to save the session.');
  } catch (err) {
    btn.disabled = true;
    say(window.isSecureContext ? `No camera: ${err.message}.` : 'The camera needs localhost or https.');
  }
}

function stopCamera() {
  if (recorder?.state === 'recording') {
    recorder.removeEventListener('stop', upload);
    recorder.stop();
  }
  clearInterval(ticker);
  liveRun += 1;
  overlay.hidden = true;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function record() {
  if (!stream) return;
  const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  chunks = [];
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  recorder.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
  recorder.addEventListener('stop', upload);
  recorder.start(500);
  started = Date.now();
  ticker = setInterval(() => say(`Recording live session · ${mmss((Date.now() - started) / 1000)}`), 250);
  label.textContent = 'Stop';
  btn.dataset.recording = 'true';
}

// Stop saves the clip to recordings/ under the name typed (not processed): Process now, or later from "Open a recording".
let saved = '';
async function upload() {
  clearInterval(ticker);
  delete btn.dataset.recording;
  btn.disabled = true;
  label.textContent = 'Record';
  const blob = new Blob(chunks, { type: recorder?.mimeType || 'video/webm' });
  stopCamera();
  if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
  previewBlobUrl = URL.createObjectURL(blob);
  media.setPreview(previewBlobUrl);
  say('Saving the recording…');
  try {
    const name = encodeURIComponent($('rec-name').value.trim());
    const res = await fetch(`/api/recordings?name=${name}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `the dev server answered ${res.status}`);
    saved = body.file;
    $('saved-text').textContent = `Saved as "${body.name}". Process it now, or later from Open a recording.`;
    $('saved-bar').hidden = false;
    say('');
  } catch (err) {
    say(`Couldn't save the recording: ${err.message}.`);
    btn.disabled = false;
  }
}

// What a live 3D body would need. Measured here (bench/live_fps.json): 0.3-0.8 fps on an RTX 4060 Laptop, 8 GB;
// shortcut: the 16 GB / RTX 4080-4090 figure is an estimate from GPU throughput, not measured; measure on such a GPU.
async function showRequirement() {
  const hw = await fetch('/api/hardware').then((r) => r.json()).catch(() => null);
  const gb = hw?.vramTotalMb ? Math.round(hw.vramTotalMb / 1024) : 0;
  $('live-req').hidden = false;
  $('live-req').textContent = 'Live 3D body: about 1-2 fps needs an NVIDIA GPU with 16 GB of VRAM or more '
    + `(RTX 4080/4090 class, estimated). ${hw?.gpu ?? 'This machine'}${gb ? ` (${gb} GB)` : ''}: `
    + (gb >= 16 ? 'may reach it, but live 3D is not built yet. ' : 'an RTX 4060 Laptop (8 GB) measured 0.3-0.8 fps. ')
    + 'So record, then press Process: it builds the 3D body, the music and the stage show at full quality, '
    + 'and keeps the session for next time.';
}

$('saved-process').addEventListener('click', () => {
  $('saved-bar').hidden = true;
  processVideo(saved, $('saved-process'), say, async (rec) => { await openRecording(rec); enter(); }, previewBlobUrl, $('rec-camera').value);
});
$('saved-again').addEventListener('click', () => {
  $('saved-bar').hidden = true;
  $('rec-name').value = '';
  startCamera();
});

btn.addEventListener('click', () => (recorder?.state === 'recording' ? recorder.stop() : record()));
document.addEventListener('lifelens:session', () => {
  btn.hidden = !session.live;
  $('rec-name').hidden = !session.live;
  $('rec-camera').hidden = !session.live;
  if (!session.live) { $('live-req').hidden = true; $('saved-bar').hidden = true; }
  document.body.classList.toggle('is-live-session', session.live);
  if (session.live) startCamera();
  else stopCamera();
});
document.addEventListener('lifelens:leave', stopCamera);
cameraSelect($('rec-camera'));
