// LifeLens front-end: a live session. The camera is the POV; Record films it, the clip goes to recordings/ (dev server)
// and the pipeline builds its 3D body, posture, captions and Muse review; when that is done the recording opens.
// Live now: Meta Muse Spark captions the camera and names the posture every few seconds (/api/live/caption, the key
// stays in the dev server). There is no live 3D body: the pipeline needs about 37 s per second of video on an RTX 4060
// laptop (README, "Live mode").

import { media } from './extras.js';
import { openRecording, session } from './session.js';
import { enter, processVideo } from './start.js';

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
const CAPTION_EVERY_MS = 6000;
const overlay = $('live-overlay');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// One 448 px JPEG of the camera now.
function grab() {
  const v = media.pov;
  if (!v.videoWidth) return null;
  const c = Object.assign(document.createElement('canvas'), { width: 448, height: Math.round(448 * v.videoHeight / v.videoWidth) });
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

// Two frames 1 s apart to Muse, then the caption and posture over the POV; one request at a time.
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
        $('live-caption').textContent = `No live caption: ${err.message}.`;
        if (/key/i.test(err.message)) break; // no Muse key: stop asking
      }
    }
    await wait(Math.max(0, CAPTION_EVERY_MS - (performance.now() - t0)));
  }
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const say = (text) => { caption.textContent = text; };

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: 'environment' },
      audio: false,
    });
    media.setLive(stream);
    btn.disabled = false;
    captionLoop(++liveRun);
    say('Fix the camera to your head, tilted 20-30° down, stand still for 3 s, then Record.');
  } catch (err) {
    btn.disabled = true;
    say(window.isSecureContext ? `No camera: ${err.message}.` : 'The camera needs localhost or https.');
  }
}

function stopCamera() {
  if (recorder?.state === 'recording') {
    recorder.removeEventListener('stop', upload); // leaving discards a running recording
    recorder.stop();
  }
  clearInterval(ticker);
  liveRun += 1; // ends the caption loop
  overlay.hidden = true;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function record() {
  const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  chunks = [];
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  recorder.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
  recorder.addEventListener('stop', upload);
  recorder.start(1000);
  started = Date.now();
  ticker = setInterval(() => say(`Recording ${mmss((Date.now() - started) / 1000)}`), 250);
  label.textContent = 'Stop';
  btn.dataset.recording = 'true';
}

async function upload() {
  clearInterval(ticker);
  delete btn.dataset.recording;
  btn.disabled = true;
  label.textContent = 'Record';
  const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
  say('Saving the recording…');
  try {
    const res = await fetch('/api/recordings', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `the dev server answered ${res.status}`);
    processVideo(body.file, null, say, async (rec) => {
      stopCamera();
      await openRecording(rec);
      enter();
    });
  } catch (err) {
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
