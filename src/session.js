// LifeLens front-end: the recording the page shows (picked on the start screen, or a live session) and what its 3D
// body is doing at any moment. Everything that depends on the recording listens for "lifelens:session".

const FPS = 30;

export const session = {
  user: '',
  rec: null,      // a processed recording from /api/recordings, or null in a live session
  live: false,    // the camera is the POV; nothing is processed yet
  pose: null,     // pose_timeseries.csv as columns
  kin: null,      // per-frame signals from the 3D joints (kinematics/joints_world.csv), see kinematics()
};

export async function fetchRecordings() {
  const res = await fetch('/api/recordings', { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'needs the dev server (npm run dev)' : `server answered ${res.status}`);
  return res.json();
}

function announce() {
  document.dispatchEvent(new CustomEvent('lifelens:session', { detail: session }));
}

function columns(text) {
  const [head, ...rows] = text.trim().split('\n');
  const cols = head.split(',');
  const data = Object.fromEntries(cols.map((c) => [c, new Float32Array(rows.length)]));
  rows.forEach((row, i) => row.split(',').forEach((v, k) => { data[cols[k]][i] = Number(v); }));
  return { ...data, n: rows.length };
}

export async function openRecording(rec) {
  const get = async (f) => (rec.files[f] ? columns(await (await fetch(rec.files[f])).text()) : null);
  const [pose, joints] = await Promise.all([get('pose_timeseries.csv'), get('kinematics/joints_world.csv')]);
  Object.assign(session, { rec, live: false, pose, kin: joints ? kinematics(joints) : null });
  announce();
}

export function openLive() {
  Object.assign(session, { rec: null, live: true, pose: null, kin: null });
  announce();
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

function smooth(a, r) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(a.length - 1, i + r); k++) { s += a[k]; c += 1; }
    out[i] = s / c;
  }
  return out;
}

// Per-frame signals from the 3D joints (meters, z up), computed once per recording:
//   limbs    speed (m/s) of the left/right wrist and ankle, lightly smoothed
//   motion   their sum: what the rhythm is found in
//   up       hand height: the higher wrist between the pelvis (0) and the head (1)
//   spread   distance between the wrists (m)
//   yaw      the shoulders' heading in degrees, unwrapped, for the turning rate
//   lift     pelvis height relative to the clip's standing height (median): + jumping, - crouching or sitting
//   x, y     pelvis floor position, 0-1 across the clip's own floor area
function kinematics(j) {
  const n = j.n;
  const at = (name, k) => [j[`${name}_x`][k], j[`${name}_y`][k], j[`${name}_z`][k]];
  const speed = (name) => {
    const out = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      const a = at(name, k - 1), b = at(name, k);
      out[k] = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * FPS;
    }
    return smooth(out, 2);
  };
  const limbs = ['left_wrist', 'right_wrist', 'left_ankle', 'right_ankle'].map(speed);
  const motion = new Float32Array(n);
  const up = new Float32Array(n), spread = new Float32Array(n), yaw = new Float32Array(n), z = new Float32Array(n);
  let turns = 0, prev = null;
  for (let k = 0; k < n; k++) {
    motion[k] = limbs[0][k] + limbs[1][k] + limbs[2][k] + limbs[3][k];
    const p = at('pelvis', k), h = at('head', k), wl = at('left_wrist', k), wr = at('right_wrist', k);
    up[k] = (Math.max(wl[2], wr[2]) - p[2]) / Math.max(0.2, h[2] - p[2]);
    spread[k] = Math.hypot(wl[0] - wr[0], wl[1] - wr[1], wl[2] - wr[2]);
    const sl = at('left_shoulder', k), sr = at('right_shoulder', k);
    const a = (Math.atan2(sr[1] - sl[1], sr[0] - sl[0]) * 180) / Math.PI;
    if (prev !== null) turns += Math.round((prev - a) / 360);   // unwrap across ±180°
    prev = a;
    yaw[k] = a + 360 * turns;
    z[k] = p[2];
  }
  const sorted = Array.from(z).sort((a, b) => a - b);
  const standing = sorted[Math.floor(sorted.length * 0.5)] || 1;
  const px = j.pelvis_x, py = j.pelvis_y;
  const lo = (a) => a.reduce((m, v) => Math.min(m, v), Infinity), hi = (a) => a.reduce((m, v) => Math.max(m, v), -Infinity);
  const [x0, x1, y0, y1] = [lo(px), hi(px), lo(py), hi(py)];
  return {
    n, limbs, motion: smooth(motion, 1), up, spread, yaw: smooth(yaw, 3),
    lift: Float32Array.from(z, (v) => v / standing - 1),
    x: Float32Array.from(px, (v) => (v - x0) / Math.max(0.5, x1 - x0)),
    y: Float32Array.from(py, (v) => (v - y0) / Math.max(0.5, y1 - y0)),
  };
}

// The tempo of a movement signal: the lag (60-180 BPM) at which it best matches itself (autocorrelation).
// strength: that match, 0-1; under ~0.3 there is no clear rhythm (standing, or irregular moves).
export function rhythmBpm(sig, fps = FPS, lo = 60, hi = 180) {
  const n = sig.length;
  if (n < fps * 4) return null;
  const m = mean(sig);
  const x = Array.from(sig, (v) => v - m);
  const e = x.reduce((s, v) => s + v * v, 0) / n;
  if (e < 1e-4) return null;
  const lag0 = Math.round((fps * 60) / hi), lag1 = Math.round((fps * 60) / lo);
  const r = [];
  for (let lag = lag0 - 1; lag <= lag1 + 1; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    r.push(s / (n - lag) / e);
  }
  // a true peak only: a smooth signal matches itself best at the shortest lag, which is no rhythm
  let best = null;
  for (let k = 1; k < r.length - 1; k++) {
    if (r[k] >= r[k - 1] && r[k] > r[k + 1] && (!best || r[k] > best.r)) best = { lag: lag0 - 1 + k, r: r[k] };
  }
  return best ? { bpm: (60 * fps) / best.lag, strength: clamp01(best.r) } : null;
}

// What the body did over the `window` seconds up to time t, from its kinematics (no model):
//   pace     mean walking speed (m/s)          still   share of the time below 0.08 m/s
//   steps    steps per minute: while walking the knees take turns bending, so left minus right knee flexion
//            changes sign once per step (with 4 degrees of hysteresis against jitter)
//   arm      how much the elbows move (standard deviation of their mean flexion, degrees)
//   upright  1 for a straight trunk, 0 at 40 degrees of lean or more
//   rhythm   {bpm, strength} of all four limbs' speeds over the last 8 s (rhythmBpm)
// and, at t itself (`now`): how fast each limb bends (deg/s over 0.3 s), plus from the 3D joints the hit (a limb's
// speed now above its last second, wrists only, 0-1 at 1.5 m/s), hand height, arm spread (m), turning rate (deg/s), lift and
// floor position. These are what the stage lights follow.
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
  const now = {
    speed: p.speed_m_s[i1], trunk: p.trunk_lean[i1], knee: (p.knee_l[i1] + p.knee_r[i1]) / 2,
    armL: rate('elbow_l'), armR: rate('elbow_r'), legL: rate('knee_l'), legR: rate('knee_r'),
    hit: 0, hitLimb: -1, up: 0, spread: 0, turn: 0, lift: 0, x: 0.5, y: 0.5,
  };
  const q = session.kin;
  let rhythm = null;
  if (q && i1 < q.n) {
    const j = Math.min(i1, q.n - 1);
    q.limbs.slice(0, 2).forEach((s, limb) => {     // wrists only: every walking step is an ankle "hit"
      const before = mean(Array.from(s.subarray(Math.max(0, j - FPS), Math.max(1, j - 3))));
      const jump = clamp01((s[j] - before) / 1.5);
      if (jump > now.hit) { now.hit = jump; now.hitLimb = limb; }
    });
    const jk = Math.max(0, j - Math.round(0.3 * FPS));
    Object.assign(now, {
      up: q.up[j], spread: q.spread[j], lift: q.lift[j], x: q.x[j], y: q.y[j],
      turn: (q.yaw[j] - q.yaw[jk]) / ((j - jk) / FPS || 1),
    });
    rhythm = rhythmBpm(q.motion.subarray(Math.max(0, j - 8 * FPS), j + 1));
  }
  return {
    t, window: seconds, pace, still: mean(speed.map((v) => (v < 0.08 ? 1 : 0))),
    steps: pace > 0.25 ? (crossings / seconds) * 60 : 0,
    arm: std(elbows), lean, upright: clamp01(1 - lean / 40), rhythm, now,
  };
}

export { clamp01 };
