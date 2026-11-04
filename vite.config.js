import { defineConfig } from 'vite';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { basename, extname, join } from 'node:path';
import { output as lightsOutput, status as lightsStatus } from './server/lights.js';

// Dev-server endpoints behind the page (npm run dev only), local requests only:
//   GET  /api/hardware            live GPU (nvidia-smi) and CPU processor telemetry
//   GET  /api/recordings          processed recordings (runs/, examples/) and raw videos waiting in recordings/
//   POST /api/recordings[?name=]  save a camera clip from the page to recordings/<name>.webm (or .mp4); not processed
//   DELETE /api/recordings?file=  delete a saved, unprocessed clip in recordings/
//   POST /api/process {file}      run the 3D body + Meta Muse Spark pipeline on a raw video
//   GET  /api/process/status      live pipeline stage progress (0-100%), logs, and GPU/CPU telemetry
//   POST /api/live/start {run, start}   the director replays that recording from `start` s with Meta Muse Spark captions
//   POST /api/live/stop           stop the director
//   POST /api/live/caption {images}   live session: Meta Muse Spark captions 1-2 camera frames and names the posture
//   POST /api/stage/scene {body, song, mood}   Meta Muse Spark as lighting designer: the next scene for the 6 fixtures
//   GET|POST /api/lights          the fixtures to real lights (server/lights.js: simulator, Art-Net or Hue)
//   POST /api/gymify {run, exercise}   pipeline/gymify.py on a processed recording -> <run>/gym.json; GET .../status
//   POST /api/stage/plan {segments, images}   Stagify: Muse Spark plans a scene per 10 s segment and music sections
//   POST /api/stage/save?run=&file=   save stage.json, stage_cues.csv or stage_show.webm into a processed recording
const MAX_RECORDING_BYTES = 500 * 2 ** 20;
const VIDEO = /\.(mp4|mov|webm|mkv)$/i;
const SKIP = new Set(['day', '_smoke']);
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const POSTURES = ['walking', 'standing', 'sitting', 'crouching', 'bending', 'arms raised'];
// the exercises pipeline/gymify.py knows (its EXERCISES); '' lets Muse Spark recognise it from the 3D body frames
const GYM_EXERCISES = ['squat', 'lunge', 'jump squat', 'step-up', 'deadlift', 'good morning', 'hip hinge', 'sit-up',
  'push-up', 'bicep curl', 'shoulder press', 'tricep dip', 'jumping jacks', 'arm raise'];
// head cameras pipeline/run.py knows (--camera): field of view, lens position in the head, lens correction
const CAMERAS = ['phone', 'gopro-linear', 'gopro-wide', 'glasses'];
const PATTERNS = ['pulse', 'chase', 'strobe', 'still'];
const STAGE_FILES = { 'stage.json': 5 * 2 ** 20, 'stage_cues.csv': 20 * 2 ** 20, 'stage_show.webm': 400 * 2 ** 20 };
const PLAN_PROMPT = `You are the lighting designer and music supervisor of a stage show made from one recording. The
performer wore a head camera and LifeLens turned it into a 3D body. The show has {n} segments of about 10 s; for each
you get the body's numbers, and image k shows the 3D body in the middle of segment k (legs estimated):
{segments}
Plan the whole show so it builds and breathes with the movement. Answer with one JSON object only:
{"scenes": exactly {n} objects, one per segment in order: {"name": 2-4 words, "palette": 2 or 3 hex colors like
"#FF3366", "pattern": "pulse", "chase", "strobe" or "still", "focus": "arms", "legs", "torso" or "all",
"strobe_on_hits": true or false, "intensity": 0.3 to 1, "reason": one short sentence naming the numbers},
"music": 2 to 4 sections in order covering the show: {"start_s": seconds, "search": 2-4 words of genre or style for
a seed song, "energy": 0-1, "tempo": BPM, "valence": 0-1, "danceability": 0-1, "instrumentalness": 0-1, "reason":
one sentence}}.`;
const FOCUS = ['arms', 'legs', 'torso', 'all'];
const SCENE_PROMPT = `You are the lighting designer of a live stage show. The performer wears a head camera and LifeLens
turns it into a 3D body; the image is that 3D body now; these are its numbers and the music:
{facts}
Design the next lighting scene for 6 fixtures (left arm, right arm, left leg, right leg, torso, pace); each fixture
already follows its body part, jumps lift all lights and crouches dim them. Answer with one JSON object only:
{"name": a 2-4 word scene name, "palette": 2 or 3 hex colors like "#FF3366", "pattern": "pulse" (all lights on the
beat), "chase" (one light after another on the beat), "strobe" (hard flashes on hits) or "still" (no beat), "focus":
"arms", "legs", "torso" or "all", "strobe_on_hits": true or false, "intensity": 0.3 to 1, "reason": one sentence that
names the numbers behind the choice}.`;
const LIVE_PROMPT = 'These are frames, 1 s apart, from a camera on a person\'s head. Answer with one JSON object only: '
  + '{"caption": what the person is doing, one short sentence starting with a verb, "posture": one of '
  + `${POSTURES.join(', ')}}.`;

const PIPELINE_STAGES = [
  { id: 'ingest', label: 'Video ingest & 30 fps normalization', pct: 8 },
  { id: 'hawor', label: 'HaWoR 3D hand tracking & DROID-SLAM', pct: 24 },
  { id: 'build_input', label: 'Floor plane & camera height calibration', pct: 42 },
  { id: 'omniegocap', label: 'OmniEgoCap 3D full-body reconstruction', pct: 60 },
  { id: 'render', label: '3D body mesh & kinematics stream rendering', pct: 74 },
  { id: 'describe_muse', label: 'Meta Muse Spark egocentric scene narration', pct: 84 },
  { id: 'posture_muse', label: 'Biomechanical & Meta Muse Spark posture analysis', pct: 92 },
  { id: 'routine_tips', label: 'Meta Muse Spark routine coaching & history review', pct: 97 },
];

function lifelensApi() {
  let director = null;
  let gym = null; // the Gymify job: { run, exercise, log, error, done }
  let job = null;
  let root = '';
  const mac = process.platform === 'darwin';
  let hwCache = {
    // macOS: no nvidia-smi; torch runs on the Apple GPU (MPS), and own videos need a CUDA machine for SLAM (README)
    gpu: mac ? 'Apple GPU (MPS)' : 'No NVIDIA GPU found',
    vramTotalMb: 0,
    vramUsedMb: 0,
    gpuUtilPct: 0,
    gpuTempC: 0,
    cpu: (os.cpus()[0]?.model || 'Multi-core Processor').replace(/\s+/g, ' ').trim(),
    cpuCores: os.cpus().length,
    ramGb: Math.round(os.totalmem() / 2 ** 30),
    platform: mac ? 'macOS' : process.platform === 'win32' ? 'WSL2' : 'Linux',
    telemetry: false, // true once nvidia-smi answered: only then are the GPU numbers measured
    stack: `${mac ? 'macOS MPS' : process.platform === 'win32' ? 'WSL2 CUDA' : 'Linux CUDA'} · OmniEgoCap + HaWoR · Meta Muse Spark`,
    updatedAt: 0,
  };

  function refreshHardware() {
    if (mac || Date.now() - hwCache.updatedAt < 1800) return;
    hwCache.updatedAt = Date.now();
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'],
      { timeout: 1500 },
      (err, stdout) => {
        if (err || !stdout) return;
        const parts = stdout.trim().split('\n')[0].split(',').map((s) => s.trim());
        if (parts.length >= 4) {
          hwCache = {
            ...hwCache,
            gpu: parts[0] || hwCache.gpu,
            vramTotalMb: Number(parts[1]) || 0,
            vramUsedMb: Number(parts[2]) || 0,
            gpuUtilPct: Number(parts[3]) || 0,
            gpuTempC: Number(parts[4]) || 0,
            telemetry: true,
            updatedAt: Date.now(),
          };
        }
      },
    );
  }
  refreshHardware();

  const python = () => process.env.DIRECTOR_PYTHON
    || [join('director', 'venv', 'bin', 'python'), join('director', 'venv', 'Scripts', 'python.exe')].find(existsSync)
    || 'python';
  const local = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const send = (res, code, body) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((ok) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 2e6) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } });
  });
  const wsl = (cmd) => (process.platform === 'win32'
    ? ['wsl', ['-e', 'bash', '-lc', `cd '/mnt/${root[0].toLowerCase()}${root.slice(2).replace(/\\/g, '/')}' && ${cmd}`]]
    : ['bash', ['-lc', `cd '${root}' && ${cmd}`]]);
  const env = (name) => `${process.env.CONDA_ROOT || '~/anaconda3'}/envs/${name}/bin`; // run.py reads CONDA_ROOT too
  // One Muse Spark call: [{type: 'input_text'|'input_image', ...}] -> the first JSON object in its answer.
  // effort: Muse's reasoning effort ('low' answers live requests in seconds instead of tens of seconds).
  async function askMuse(key, content, timeoutMs = 30000, effort = 'low') {
    const r = await fetch('https://api.meta.ai/v1/responses', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.MUSE_MODEL || 'muse-spark-1.3', input: [{ role: 'user', content }],
        reasoning: { effort } }),
    });
    if (!r.ok) throw new Error(`Muse answered ${r.status}`);
    const p = await r.json();
    const text = p.output_text || (p.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('');
    return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
  }
  const museError = (err) => (err.name === 'TimeoutError' ? 'Muse did not answer in time' : `Muse: ${err.message}`);
  const museKey = () => {
    const f = join(root, 'director', '.env');
    const line = existsSync(f) ? readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('MUSE_API_KEY=')) : null;
    return line ? line.split('=').slice(1).join('=').trim() : '';
  };

  function recordings() {
    const found = new Map();
    for (const dir of ['examples', 'runs']) {
      const base = join(root, dir);
      if (!existsSync(base)) continue;
      for (const name of readdirSync(base)) {
        const run = join(base, name);
        if (SKIP.has(name) || name.startsWith('bench_') || !existsSync(join(run, 'pose_timeseries.csv'))
          || !existsSync(join(run, 'mesh_exo.mp4')) || !existsSync(join(run, 'insights.json'))) continue;
        const url = (f) => {
          const full = join(run, f);
          return existsSync(full) ? `/${dir}/${name}/${f}?v=${Math.floor(statSync(full).mtimeMs)}` : null;
        };
        const small = (f) => {
          const full = join(root, 'public', 'video', f);
          return existsSync(full) ? `/video/${f}?v=${Math.floor(statSync(full).mtimeMs)}` : null;
        };
        const frames = readFileSync(join(run, 'pose_timeseries.csv'), 'utf8').split('\n').length - 2;
        const prev = found.get(name);
        found.set(name, {
          name,
          base: `${dir}/${name}`,
          seconds: Math.max(1, Math.round(frames / 30)),
          processed: statSync(run).mtime.toISOString(),
          camera: existsSync(join(run, 'camera.json')) ? JSON.parse(readFileSync(join(run, 'camera.json'), 'utf8')) : null,
          pov: url('input.mp4') ?? small(`input/${name}.mp4`) ?? prev?.pov ?? null,
          body: (dir === 'runs' ? url('mesh_exo.mp4') : null) ?? small(`${name}-body.mp4`) ?? url('mesh_exo.mp4'),
          graph: (dir === 'runs' ? url('pose_graph.mp4') : null) ?? small(`${name}-graph.mp4`) ?? url('pose_graph.mp4'),
          files: Object.fromEntries(['pose_timeseries.csv', 'activity.csv', 'insights.json', 'postures.json',
            'narration_muse.json', 'kinematics/joints_world.csv', 'mesh_exo.mp4', 'gym.json', 'stage.json',
            'stage_cues.csv', 'stage_show.webm'].map((f) => [f, url(f)])),
        });
      }
    }
    const raw = existsSync(join(root, 'recordings')) ? readdirSync(join(root, 'recordings'))
      .filter((f) => VIDEO.test(f) && !found.has(basename(f, extname(f))))
      .map((f) => ({ file: `recordings/${f}`, name: basename(f, extname(f)), size: statSync(join(root, 'recordings', f)).size })) : [];
    return { processed: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)), raw };
  }

  // the wearer from the start page: height (cm) sets the 3D body's scale; weight and age only reach Muse's coaching.
  // Numbers only, range-checked: the text built here goes into shell commands.
  const profileOf = ({ height, weight, age } = {}) => {
    const n = (v, lo, hi) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? Math.round(+v) : null);
    const [h, w, y] = [n(height, 100, 230), n(weight, 25, 300), n(age, 5, 110)];
    return { height: h && h / 100, person: [h && `${h} cm`, w && `${w} kg`, y && `${y} years old`].filter(Boolean).join(', ') };
  };

  function processSteps(file, name, camera = '', profile = {}) {
    const history = recordings().processed.filter((r) => r.name !== name).map((r) => r.base).join(' ');
    return [
      ['3D body & Meta Muse Spark narration', true, ...wsl(`PATH=${env('omniegocap')}:$PATH ${env('omniegocap')}/python pipeline/run.py '${file}' '${name}'${camera ? ` --camera ${camera}` : ''}${profile.height ? ` --height ${profile.height}` : ''}`)],
      ['3D body frames', false, ...wsl(`${env('vlm')}/python pipeline/body_frames.py --run runs/${name}`)],   // what Muse sees
      ['Meta Muse Spark posture', false, python(), ['-m', 'director.posture_muse', `runs/${name}`]],
      ['Posture sources', false, ...wsl(`${env('mhr')}/python bench/posture_sources.py runs/${name}`)],
      ['Meta Muse Spark routine coaching', false, python(), ['-m', 'director.routine_tips', `runs/${name}`, '--history', ...history.split(' ').filter(Boolean),
      ...(profile.person ? ['--person', profile.person] : [])]],
    ];
  }

  function setStage(stageId) {
    if (!job) return;
    const idx = PIPELINE_STAGES.findIndex((s) => s.id === stageId);
    if (idx === -1 || idx < job.stageIndex) return;
    job.stageIndex = idx;
    job.stageAt = Date.now();
    job.step = PIPELINE_STAGES[idx].label;
    job.percent = Math.max(job.percent, PIPELINE_STAGES[idx].pct);
  }

  function parseStageFromOutput(chunk) {
    const text = String(chunk);
    if (/==\s*ingest/i.test(text)) setStage('ingest');
    if (/==\s*hawor/i.test(text)) setStage('hawor');
    if (/==\s*build_input/i.test(text)) setStage('build_input');
    if (/==\s*omniegocap/i.test(text)) setStage('omniegocap');
    if (/==\s*render/i.test(text)) setStage('render');
    if (/==\s*describe_muse/i.test(text)) setStage('describe_muse');
    if (/describe_muse warning/i.test(text)) job.failed.add('describe_muse');
    if (/==\s*insights/i.test(text)) setStage('posture_muse');
  }

  // Clips waiting for the pipeline, in order: the next starts when a job finishes or fails.
  const queue = [];
  const busy = () => job && !job.done && !job.error;
  function startJob(file, name, camera, profile) {
    const now = Date.now();
    job = {
      file, name, step: PIPELINE_STAGES[0].label, index: 0, stageIndex: 0, stageAt: now, startedAt: now, percent: 0,
      steps: PIPELINE_STAGES.map((s) => s.label), log: '', error: '',
      failed: new Set(), // optional stages that failed or were skipped
      done: false,
    };
    runSteps(processSteps(file, name, camera, profile));
  }
  const nextJob = () => { const q = queue.shift(); if (q) startJob(q.file, q.name, q.camera, q.profile); };

  function runSteps(steps, i = 0) {
    if (i === steps.length) {
      job.done = true;
      job.percent = 100;
      job.stageIndex = PIPELINE_STAGES.length;
      job.step = 'Complete';
      nextJob();
      return;
    }
    const [label, critical, cmd, args] = steps[i];
    const stageOf = ['', 'posture_muse', 'posture_muse', 'posture_muse', 'routine_tips'][i];
    job.index = i;
    if (i === 0) setStage('ingest');
    else if (i >= 1 && i <= 3) setStage('posture_muse');
    else if (i === 4) setStage('routine_tips');
    job.step = PIPELINE_STAGES[job.stageIndex]?.label || label;

    const proc = spawn(cmd, args, { cwd: root, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } });
    const keep = (d) => {
      parseStageFromOutput(d);
      job.log = (job.log + d).slice(-2400);
    };
    proc.stdout.on('data', keep);
    proc.stderr.on('data', keep);
    proc.on('error', (err) => {
      if (critical) { job.error = `${label}: ${err.message}`; nextJob(); }
      else { job.failed.add(stageOf); runSteps(steps, i + 1); }
    });
    proc.on('exit', (code) => {
      if (code !== 0 && critical) { job.error = `${label} stopped (exit ${code})`; nextJob(); }
      else { if (code !== 0) job.failed.add(stageOf); runSteps(steps, i + 1); } // optional step failed: shown, not ticked
    });
  }

  function statusPayload() {
    refreshHardware();
    if (!job) return { idle: true, hardware: hwCache, queue: [] };
    const elapsedMs = Date.now() - job.startedAt;
    // The share of the pipeline whose stages have started (fixed weights per stage); no timer moves it in between.
    const percent = job.percent;
    const stages = PIPELINE_STAGES.map((s, idx) => ({
      id: s.id,
      label: s.label,
      state: job.failed.has(s.id) ? 'error'
        : job.done || idx < job.stageIndex ? 'done' : idx === job.stageIndex ? (job.error ? 'error' : 'active') : 'pending',
    }));
    return {
      ...job,
      percent: job.done ? 100 : percent,
      elapsedMs,
      stages,
      hardware: hwCache,
      queue: queue.map((q) => q.name),
    };
  }

  return {
    name: 'lifelens-api',
    configureServer(server) {
      root = server.config.root;
      server.middlewares.use('/api/', (req, res, next) => (local(req) ? next() : send(res, 403, { error: 'Local only.' })));

      server.middlewares.use('/api/hardware', (req, res) => {
        refreshHardware();
        send(res, 200, hwCache);
      });

      server.middlewares.use('/api/recordings', (req, res) => {
        if (req.method === 'GET') return send(res, 200, recordings());
        const params = new URL(req.url, 'http://local').searchParams;
        if (req.method === 'DELETE') {
          const file = params.get('file') || '';
          const name = basename(file, extname(file));
          if (!file.startsWith('recordings/') || file.includes('..') || !VIDEO.test(file) || !NAME.test(name)
            || !existsSync(join(root, file))) return send(res, 400, { error: 'Pick a saved clip in recordings/.' });
          if ((busy() && job.file === file) || queue.some((q) => q.file === file)) {
            return send(res, 409, { error: 'That clip is being processed.' });
          }
          unlinkSync(join(root, file));
          return send(res, 200, { ok: true });
        }
        if (req.method !== 'POST') return send(res, 405, { error: 'Use GET, POST or DELETE.' });
        // the name the user typed, made safe for a file name; the time is added when it is taken or empty
        const wanted = (params.get('name') || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
          size += c.length;
          if (size > MAX_RECORDING_BYTES) req.destroy();
          else chunks.push(c);
        });
        req.on('end', () => {
          if (!size) return send(res, 400, { error: 'The recording is empty.' });
          mkdirSync(join(root, 'recordings'), { recursive: true });
          const ext = (req.headers['content-type'] || '').includes('mp4') ? 'mp4' : 'webm';
          const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
          const taken = (n) => ['webm', 'mp4'].some((e) => existsSync(join(root, 'recordings', `${n}.${e}`))) || existsSync(join(root, 'runs', n));
          const name = wanted && !taken(wanted) ? wanted : `${wanted || 'live'}-${stamp}`;
          writeFileSync(join(root, 'recordings', `${name}.${ext}`), Buffer.concat(chunks));
          send(res, 200, { file: `recordings/${name}.${ext}`, name });
        });
      });

      server.middlewares.use('/api/process/status', (req, res) => send(res, 200, statusPayload()));

      server.middlewares.use('/api/process', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
        const body = await readBody(req);
        const { file, camera = '' } = body;
        const profile = profileOf(body);
        if (camera && !CAMERAS.includes(camera)) return send(res, 400, { error: 'Unknown camera.' });
        const name = typeof file === 'string' ? basename(file, extname(file)) : '';
        if (!file?.startsWith('recordings/') || !VIDEO.test(file) || !NAME.test(name) || !existsSync(join(root, file))) {
          return send(res, 400, { error: 'Pick a video from recordings/.' });
        }
        if (busy()) {                                       // the pipeline is busy: wait in the queue
          if (job.file !== file && !queue.some((q) => q.file === file)) queue.push({ file, name, camera, profile });
          return send(res, 202, { queued: queue.findIndex((q) => q.file === file) + 1, running: job.name });
        }
        startJob(file, name, camera, profile);
        send(res, 200, statusPayload());
      });

      server.middlewares.use('/api/live/status', (req, res) => send(res, 200, { running: Boolean(director) }));

      server.middlewares.use('/api/live/stop', (req, res) => {
        director?.kill();
        director = null;
        send(res, 200, { ok: true });
      });

      server.middlewares.use('/api/live/start', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
        const { run, start } = await readBody(req);
        const known = recordings().processed.find((r) => r.base === run);
        if (!known) return send(res, 400, { error: 'Unknown recording.' });
        director?.kill();
        const from = Math.max(0, Math.min(Number(start) || 0, known.seconds - 2));
        const args = ['-m', 'director.server', known.base, '--start', from.toFixed(2), '--captions', 'muse'];
        if (!existsSync(join(root, 'director', '.env'))) args.push('--no-model');
        let lastError = '';
        const proc = spawn(python(), args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
        director = proc;
        proc.stdout.on('data', (d) => process.stdout.write(`[director] ${d}`));
        proc.stderr.on('data', (d) => { process.stderr.write(`[director] ${d}`); lastError = (lastError + d).slice(-400); });
        proc.on('spawn', () => send(res, 200, { ok: true, model: !args.includes('--no-model') }));
        proc.on('error', (err) => {
          director = null;
          send(res, 500, { error: `Could not start ${python()}: ${err.message}. Set DIRECTOR_PYTHON.` });
        });
        proc.on('exit', () => { if (director === proc) director = null; });
      });

      server.middlewares.use('/api/live/caption', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
        const key = museKey();
        if (!key) return send(res, 503, { error: 'live captions need a Muse key (MUSE_API_KEY in director/.env)' });
        const { images } = await readBody(req);
        const ok = Array.isArray(images) && images.length >= 1 && images.length <= 2
          && images.every((i) => typeof i === 'string' && i.startsWith('data:image/jpeg;base64,') && i.length < 600000);
        if (!ok) return send(res, 400, { error: 'Send 1-2 JPEG frames.' });
        const t0 = Date.now();
        try {
          const answer = await askMuse(key, [{ type: 'input_text', text: LIVE_PROMPT },
            ...images.map((image_url) => ({ type: 'input_image', image_url }))]);
          const posture = POSTURES.includes(answer.posture) ? answer.posture : '';
          send(res, 200, { caption: String(answer.caption ?? '').slice(0, 200), posture, ms: Date.now() - t0 });
        } catch (err) {
          send(res, 502, { error: museError(err) });
        }
      });

      // Muse Spark as lighting designer. The page sends numbers only (the body's last 8 s, the song, the mood).
      server.middlewares.use('/api/stage/scene', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
        const key = museKey();
        if (!key) return send(res, 503, { error: 'scenes need a Muse key (MUSE_API_KEY in director/.env)' });
        const { facts, image } = await readBody(req);
        if (typeof facts !== 'string' || !facts.trim() || facts.length > 1500) return send(res, 400, { error: 'Send facts.' });
        const frame = typeof image === 'string' && image.startsWith('data:image/jpeg;base64,') && image.length < 400000 ? image : null;
        const t0 = Date.now();
        try {
          const a = await askMuse(key, [{ type: 'input_text', text: SCENE_PROMPT.replace('{facts}', facts) },
            ...(frame ? [{ type: 'input_image', image_url: frame }] : [])], 40000);
          const palette = (Array.isArray(a.palette) ? a.palette : []).filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c)).slice(0, 3);
          if (palette.length < 2 || !PATTERNS.includes(a.pattern)) return send(res, 502, { error: 'Muse gave no usable scene' });
          send(res, 200, {
            name: String(a.name ?? 'Scene').slice(0, 40), palette, pattern: a.pattern,
            focus: FOCUS.includes(a.focus) ? a.focus : 'all', strobe_on_hits: a.strobe_on_hits !== false,
            intensity: Math.min(1, Math.max(0.3, Number(a.intensity) || 0.8)), reason: String(a.reason ?? '').slice(0, 240),
            ms: Date.now() - t0,
          });
        } catch (err) {
          send(res, 502, { error: museError(err) });
        }
      });

      // Gymify: one job at a time; Muse Spark sees 3D body frames (and POV frames), the rest is measured.
      server.middlewares.use('/api/gymify/status', (req, res) => send(res, 200, gym ?? { idle: true }));
      server.middlewares.use('/api/gymify', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
        if (gym && !gym.done && !gym.error) return send(res, 409, { error: `Gymify is running on ${gym.run}.` });
        const body = await readBody(req);
        const { run, exercise = '' } = body;
        const { person } = profileOf(body);
        const known = recordings().processed.find((r) => r.base === run);
        if (!known) return send(res, 400, { error: 'Unknown recording.' });
        if (exercise && !GYM_EXERCISES.includes(exercise)) return send(res, 400, { error: 'Unknown exercise.' });
        if (!existsSync(join(root, 'director', '.env'))) return send(res, 503, { error: 'Gymify needs a Muse key (director/.env).' });
        gym = { run, exercise, log: '', error: '', done: false, startedAt: Date.now() };
        const [cmd, args] = wsl(`${env('vlm')}/python pipeline/gymify.py --run '${run}'${exercise ? ` --exercise '${exercise}'` : ''}${person ? ` --person '${person}'` : ''}`);
        const proc = spawn(cmd, args, { cwd: root, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
        const job = gym;
        const keep = (d) => { job.log = (job.log + d).slice(-1200); };
        proc.stdout.on('data', keep);
        proc.stderr.on('data', keep);
        proc.on('error', (err) => { job.error = err.message; });
        proc.on('exit', (code) => { if (code === 0) job.done = true; else job.error = job.log.trim().split('\n').pop() || `exit ${code}`; });
        send(res, 200, { ok: true });
      });

      // Stagify: Muse Spark plans the whole show at once from every segment's numbers and a 3D body frame of each.
      server.middlewares.use('/api/stage/plan', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
        const key = museKey();
        if (!key) return send(res, 503, { error: 'Stagify needs a Muse key (MUSE_API_KEY in director/.env)' });
        const { segments, images } = await readBody(req);
        if (!Array.isArray(segments) || !segments.length || segments.length > 40
          || !segments.every((g) => typeof g === 'string' && g.length < 600)) return send(res, 400, { error: 'Send segments.' });
        const frames = (Array.isArray(images) ? images : []).filter((i) => typeof i === 'string'
          && i.startsWith('data:image/jpeg;base64,') && i.length < 200000).slice(0, segments.length);
        const t0 = Date.now();
        try {
          const prompt = PLAN_PROMPT.replaceAll('{n}', String(segments.length))
            .replace('{segments}', segments.map((g, k) => `${k + 1}. ${g}`).join('\n'));
          const a = await askMuse(key, [{ type: 'input_text', text: prompt }, ...frames.map((image_url) => ({ type: 'input_image', image_url }))],
            180000, 'medium');
          const scenes = segments.map((_, k) => {
            const c = (a.scenes ?? [])[k] ?? (a.scenes ?? [])[(a.scenes ?? []).length - 1] ?? {};
            const palette = (Array.isArray(c.palette) ? c.palette : []).filter((x) => /^#[0-9A-Fa-f]{6}$/.test(x)).slice(0, 3);
            return { name: String(c.name ?? 'Scene').slice(0, 40), palette: palette.length >= 2 ? palette : ['#3977FF', '#FF5A36'],
              pattern: PATTERNS.includes(c.pattern) ? c.pattern : 'pulse', focus: FOCUS.includes(c.focus) ? c.focus : 'all',
              strobe_on_hits: c.strobe_on_hits !== false, intensity: Math.min(1, Math.max(0.3, Number(c.intensity) || 0.8)),
              reason: String(c.reason ?? '').slice(0, 240) };
          });
          const num = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : d));
          const music = (Array.isArray(a.music) ? a.music : []).slice(0, 4).map((m) => ({ start_s: num(m.start_s, 0, 36000, 0),
            search: String(m.search ?? 'energetic').slice(0, 60), energy: num(m.energy, 0, 1, 0.6), tempo: num(m.tempo, 50, 200, 110),
            valence: num(m.valence, 0, 1, 0.5), danceability: num(m.danceability, 0, 1, 0.5),
            instrumentalness: num(m.instrumentalness, 0, 1, 0.2), reason: String(m.reason ?? '').slice(0, 240) }));
          send(res, 200, { scenes, music, prompt, ms: Date.now() - t0 });
        } catch (err) {
          send(res, 502, { error: museError(err) });
        }
      });

      // Stagify's outputs, saved next to the recording: only these files, only into a known processed recording.
      server.middlewares.use('/api/stage/save', (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
        const params = new URL(req.url, 'http://local').searchParams;
        const known = recordings().processed.find((r) => r.base === params.get('run'));
        const file = params.get('file');
        if (!known || !Object.hasOwn(STAGE_FILES, file)) return send(res, 400, { error: 'Unknown recording or file.' });
        const chunks = [];
        let size = 0;
        req.on('data', (c) => { size += c.length; if (size > STAGE_FILES[file]) req.destroy(); else chunks.push(c); });
        req.on('end', () => {
          if (!size) return send(res, 400, { error: 'Empty file.' });
          writeFileSync(join(root, known.base, file), Buffer.concat(chunks));
          send(res, 200, { ok: true, url: `/${known.base}/${file}` });
        });
      });

      server.middlewares.use('/api/lights', async (req, res) => {
        if (req.method === 'GET') return send(res, 200, lightsStatus());
        if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });
        const { fixtures } = await readBody(req);
        send(res, 200, lightsOutput(fixtures));
      });
    },
  };
}

export default defineConfig({
  plugins: [lifelensApi()],
  // recordings/ and runs/ hold big videos the pipeline writes: watching them crashes the server (EBUSY) mid-copy
  server: { port: 8000, strictPort: true, watch: { ignored: ['**/recordings/**', '**/runs/**'] } },
  preview: { port: 8000, strictPort: true },
});
