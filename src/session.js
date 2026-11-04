// LifeLens front-end: the recording the page shows (picked on the start screen, or a live session) and what its 3D
// body is doing at any moment. Everything that depends on the recording listens for "lifelens:session".

const FPS = 30;

export const session = {
  user: '',
  rec: null,      // a processed recording from /api/recordings, or null in a live session
  live: false,    // the camera is the POV; nothing is processed yet
  pose: null,     // pose_timeseries.csv as columns
};

export async function fetchRecordings() {
  const res = await fetch('/api/recordings', { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'needs the dev server (npm run dev)' : `server answered ${res.status}`);
  return res.json();
}

function announce() {
  document.dispatchEvent(new CustomEvent('lifelens:session', { detail: session }));
}

export async function openRecording(rec) {
  const text = await (await fetch(rec.files['pose_timeseries.csv'])).text();
  const [head, ...rows] = text.trim().split('\n');
  const cols = head.split(',');
  const data = Object.fromEntries(cols.map((c) => [c, new Float32Array(rows.length)]));
  rows.forEach((row, i) => row.split(',').forEach((v, k) => { data[cols[k]][i] = Number(v); }));
  Object.assign(session, { rec, live: false, pose: { ...data, n: rows.length } });
  announce();
}

export function openLive() {
  Object.assign(session, { rec: null, live: true, pose: null });
  announce();
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

// What the body did over the `window` seconds up to time t, from its kinematics (no model):
//   pace     mean walking speed (m/s)          still   share of the time below 0.08 m/s
//   steps    steps per minute: while walking the knees take turns bending, so left minus right knee flexion
//            changes sign once per step (with 4 degrees of hysteresis against jitter)
//   arm      how much the elbows move (standard deviation of their mean flexion, degrees)
//   upright  1 for a straight trunk, 0 at 40 degrees of lean or more
// and, at t itself, how fast each limb moves (degrees per second over the last 0.3 s): what the stage lights follow.
export function bodyFeatures(t, window = 10) {
  const p = session.pose;
  if (!p || !Number.isFinite(t)) return null;
  const i1 = Math.min(p.n - 1, Math.max(0, Math.round(t * FPS)));
  const i0 = Math.max(0, i1 - Math.round(window * FPS));
  const slice = (c) => Array.from(p[c].subarray(i0, i1 + 1));
  const speed = slice('speed_m_s');
  const pace = mean(speed);
  let crossings = 0;
  let side = 0;
  const kl = slice('knee_l');
  const kr = slice('knee_r');
  for (let i = 0; i < kl.length; i++) {
    const d = kl[i] - kr[i];
    const s = d > 4 ? 1 : d < -4 ? -1 : 0;
    if (s && s !== side) { if (side) crossings += 1; side = s; }
  }
  const seconds = (i1 - i0) / FPS || 1;
  const elbows = slice('elbow_l').map((v, i) => (v + p.elbow_r[i0 + i]) / 2);
  const lean = mean(slice('trunk_lean'));
  const k = Math.max(0, i1 - Math.round(0.3 * FPS));
  const rate = (c) => Math.abs(p[c][i1] - p[c][k]) / ((i1 - k) / FPS || 1);
  return {
    t, window: seconds, pace, still: mean(speed.map((v) => (v < 0.08 ? 1 : 0))),
    steps: pace > 0.25 ? (crossings / seconds) * 60 : 0,
    arm: std(elbows), lean, upright: clamp01(1 - lean / 40),
    now: {
      speed: p.speed_m_s[i1], trunk: p.trunk_lean[i1], knee: (p.knee_l[i1] + p.knee_r[i1]) / 2,
      armL: rate('elbow_l'), armR: rate('elbow_r'), legL: rate('knee_l'), legR: rate('knee_r'),
    },
  };
}

export { clamp01 };
