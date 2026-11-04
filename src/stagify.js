// Stagify: plan the whole stage show for a processed recording, offline, then record it.
// 1. Every 10 s segment: the body's numbers (pace, rhythm, arm hits, jumps, crouches, fast turns, hands up, spread)
//    from its 3D joints, and a frame of the 3D body. 2. Meta Muse Spark plans a scene per segment and 2-4 music
//    sections at once (/api/stage/plan); ReccoBeats picks each section's song. Saved as <run>/stage.json, which the
//    Stage tab and Show view then play instantly. 3. The Show view is replayed from 0:00 and recorded with its sound
//    effects (stage_show.webm), and the 6 lights are sampled 10x a second into stage_cues.csv (for a lighting desk,
//    or `node server/replay.js <run>/stage_cues.csv` to Art-Net or Hue).

import { media } from './extras.js';
import { askSongs } from './main.js';
import { bodyFeatures, session } from './session.js';
import { FIXTURES, openShow, recordFx, setPlan, stage } from './stage.js';

const $ = (id) => document.getElementById(id);
const SEG_S = 10;
const FPS = 30;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const say = (text) => { $('stagify-status').hidden = !text; $('stagify-status').textContent = text; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Moments in frames [i0, i1) of the 3D joints, with the same thresholds as the live rules (stage.js / session.js).
function moments(i0, i1) {
  const q = session.kin;
  const out = { hits: 0, jumps: 0, crouches: 0, turns: 0, up: 0, spread: 0 };
  let was = {};
  for (let j = Math.max(FPS, i0); j < i1; j++) {
    const before = (s) => { let m = 0; for (let k = j - FPS; k < j - 3; k++) m += s[k]; return m / (FPS - 3); };
    const hit = Math.max(...q.limbs.slice(0, 2).map((s) => (s[j] - before(s)) / 1.5));
    const turn = Math.abs(q.yaw[j] - q.yaw[j - 9]) / 0.3;
    const now = { hits: hit > 0.45, jumps: q.lift[j] > 0.06, crouches: q.lift[j] < -0.15, turns: turn > 120 };
    for (const k of Object.keys(now)) if (now[k] && !was[k]) out[k] += 1;
    was = now;
    out.up += q.up[j] > 0.8 ? 1 : 0;
    out.spread += q.spread[j];
  }
  const n = Math.max(1, i1 - Math.max(FPS, i0));
  return { ...out, up: out.up / n, spread: out.spread / n };
}

function segmentFacts(t0, t1) {
  const f = bodyFeatures(t1, t1 - t0);
  const m = moments(Math.round(t0 * FPS), Math.round(t1 * FPS));
  return `${clock(t0)}-${clock(t1)}: pace ${f.pace.toFixed(2)} m/s, still ${Math.round(100 * f.still)}%, `
    + `${f.rhythm?.strength > 0.3 ? `body rhythm ${Math.round(f.rhythm.bpm)}/min` : 'no steady rhythm'}, `
    + `${m.hits} sudden arm moves, ${m.jumps} jumps, ${m.crouches} crouches, ${m.turns} fast turns, `
    + `hands up ${Math.round(100 * m.up)}%, arm spread ${m.spread.toFixed(2)} m.`;
}

// The 3D body in the middle of each segment (the original render when the recording has it).
async function frames(times) {
  const v = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto' });
  v.src = session.rec.files['mesh_exo.mp4'] || session.rec.body;
  await new Promise((r, x) => { v.addEventListener('loadeddata', r, { once: true }); v.addEventListener('error', x, { once: true }); });
  const c = Object.assign(document.createElement('canvas'), { width: 320, height: Math.round((320 * v.videoHeight) / v.videoWidth) });
  const out = [];
  for (const t of times) {
    v.currentTime = Math.min(v.duration - 0.1, t);
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    out.push(c.toDataURL('image/jpeg', 0.75));
  }
  return out;
}

async function save(file, body, type) {
  const res = await fetch(`/api/stage/save?run=${encodeURIComponent(session.rec.base)}&file=${file}`,
    { method: 'POST', body, headers: { 'Content-Type': type } });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `saving ${file}: ${res.status}`);
  return out.url;
}

// Replay the recording from 0:00 in the Show view; record the canvas and the sound effects; sample the lights.
async function recordShow() {
  openShow(true);                    // record the stage view
  const fx = recordFx();
  const stream = new MediaStream([...$('show-canvas').captureStream(30).getVideoTracks(), ...fx.stream.getAudioTracks()]);
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6e6 });
  const chunks = [];
  rec.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
  const rows = ['time_s,fixture,name,r,g,b,level'];
  $('restart-btn').click();                                   // the director from 0:00
  await wait(1500);
  rec.start(1000);
  const end = (session.pose?.n ?? 0) / FPS;
  const sampler = setInterval(() => {
    const t = media.body.currentTime;
    stage.fixtures.forEach((fx, i) => {
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(fx.color.slice(k, k + 2), 16));
      rows.push(`${t.toFixed(2)},${i + 1},${FIXTURES[i].name},${r},${g},${b},${fx.level.toFixed(3)}`);
    });
    say(`Recording the show… ${clock(t)} / ${clock(end)}`);
  }, 100);
  while (media.body.currentTime < end - 0.4 && !/finished|Ended/i.test($('progress-label').textContent)) await wait(250);
  clearInterval(sampler);
  await new Promise((r) => { rec.addEventListener('stop', r, { once: true }); rec.stop(); });
  stage.recDest = null;
  openShow(true);                    // back to the Stage tab view
  return { video: new Blob(chunks, { type: 'video/webm' }), cues: rows.join('\n') };
}

function showOutputs(urls) {
  const box = $('stagify-out');
  box.replaceChildren(...Object.entries(urls).filter(([, u]) => u).map(([label, u]) => Object.assign(document.createElement('a'),
    { href: u, textContent: label, target: '_blank', rel: 'noopener', className: 'btn btn-small-text' })));
  box.hidden = !box.children.length;
}

async function stagify() {
  const btn = $('stagify-btn');
  btn.disabled = true;
  try {
    if (!session.kin) throw new Error('this recording has no 3D joints (kinematics/joints_world.csv)');
    const total = session.pose.n / FPS;
    const starts = Array.from({ length: Math.ceil(total / SEG_S) }, (_, k) => k * SEG_S);
    say(`Reading the 3D body in ${starts.length} segments of ${SEG_S} s…`);
    const segments = starts.map((t0) => segmentFacts(t0, Math.min(total, t0 + SEG_S)));
    const images = await frames(starts.map((t0) => Math.min(total - 0.5, t0 + SEG_S / 2)));
    say('Muse Spark is planning the show (scenes and music)…');
    const res = await fetch('/api/stage/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments, images }) });
    const plan = await res.json();
    if (!res.ok) throw new Error(plan.error || `the dev server answered ${res.status}`);
    say('Picking a song for each music section (ReccoBeats)…');
    for (const m of plan.music) {
      // ReccoBeats' search can find nothing for a long phrase: try Muse's words, then its first two, then its first
      const words = m.search.split(/\s+/);
      for (const search of [m.search, words.slice(0, 2).join(' '), words[0]]) {
        const list = await askSongs({ ...m, search, at: m.start_s, from: `Stagify, from ${clock(m.start_s)} (Muse Spark)` }).catch(() => null);
        m.track = list?.songs?.[0] ?? null;
        if (m.track) { m.seed_search = search; break; }
      }
    }
    const full = { segment_s: SEG_S, made: new Date().toISOString(), segments, ...plan };
    await save('stage.json', JSON.stringify(full, null, 1), 'application/json');
    setPlan(full);
    const shown = await recordShow();
    say('Saving the show video and the lighting cues…');
    const video = await save('stage_show.webm', shown.video, 'video/webm');
    const cues = await save('stage_cues.csv', shown.cues, 'text/csv');
    say(`Stagified: ${full.scenes.length} scenes, ${full.music.length} music sections. The Stage tab and Show view now play this plan.`);
    showOutputs({ 'Show video': video, 'Lighting cues (CSV)': cues });
  } catch (err) {
    say(`Stagify stopped: ${err.message}.`);
  } finally {
    btn.disabled = false;
  }
}

// A planned section's song starts when playback reaches it.
let section = -1;
media.body.addEventListener('timeupdate', () => {
  const music = stage.plan?.music;
  if (!music?.length) return;
  const t = media.body.currentTime;
  const k = music.reduce((a, m, i) => (m.start_s <= t ? i : a), 0);
  if (k === section) return;
  section = k;
  if (music[k].track) document.dispatchEvent(new CustomEvent('lifelens:play-song', { detail: music[k].track }));
});

$('stagify-btn').addEventListener('click', stagify);
document.addEventListener('lifelens:session', async () => {
  section = -1;
  say('');
  showOutputs({});
  const f = session.rec?.files ?? {};
  if (!f['stage.json']) return;
  const plan = await fetch(`${f['stage.json']}${f['stage.json'].includes('?') ? '&' : '?'}t=${Date.now()}`).then((r) => r.json()).catch(() => null);
  if (!plan) return;
  setPlan(plan);
  say(`Stagified plan loaded: ${plan.scenes.length} scenes, ${plan.music.length} music sections.`);
  showOutputs({ 'Show video': f['stage_show.webm'], 'Lighting cues (CSV)': f['stage_cues.csv'] });
});
