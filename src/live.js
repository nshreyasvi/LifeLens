// LifeLens front-end: a live session. The camera is the POV; Record films it, the clip goes to recordings/ (dev server)
// and the pipeline builds its 3D body, posture, captions and Meta Muse Spark review; while processing, the dedicated
// Processing Studio loading screen shows live stage progress (0-100%), GPU/CPU telemetry, and the newly recorded clip.

import { media } from './extras.js';
import { openRecording, session } from './session.js';
import { enter, hideProcessModal, processVideo, showProcessModal } from './start.js';

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
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: 'environment' },
      audio: false,
    });
    media.setLive(stream);
    btn.disabled = false;
    captionLoop(++liveRun);
    say('Camera live · Click Record to capture your session, then Stop to run the 3D body & Muse Spark pipeline.');
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

async function upload() {
  clearInterval(ticker);
  delete btn.dataset.recording;
  btn.disabled = true;
  label.textContent = 'Record';
  const blob = new Blob(chunks, { type: recorder?.mimeType || 'video/webm' });

  // Immediately stop the live camera and preview the newly recorded clip (never leaving an old video on screen).
  stopCamera();
  if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
  previewBlobUrl = URL.createObjectURL(blob);
  media.setPreview(previewBlobUrl);

  showProcessModal({
    name: 'live-capture',
    step: 'Saving newly recorded camera clip…',
    percent: 0,
    elapsedMs: 0,
    log: `Captured ${Math.max(1, Math.round(blob.size / 1024))} KB video stream. Uploading to local studio server…`,
    previewUrl: previewBlobUrl,
  });

  say('Saving & processing your new recording…');
  try {
    const res = await fetch('/api/recordings', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `the dev server answered ${res.status}`);
    await processVideo(body.file, btn, say, async (rec) => {
      await openRecording(rec);
      enter();
    }, previewBlobUrl);
  } catch (err) {
    hideProcessModal();
    say(`Couldn't save the recording: ${err.message}.`);
    btn.disabled = false;
  }
}

btn.addEventListener('click', () => (recorder?.state === 'recording' ? recorder.stop() : record()));
document.addEventListener('lifelens:session', () => {
  btn.hidden = !session.live;
  document.body.classList.toggle('is-live-session', session.live);
  if (session.live) startCamera();
  else stopCamera();
});
document.addEventListener('lifelens:leave', stopCamera);
