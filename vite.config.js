import { defineConfig } from 'vite';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { basename, extname, join } from 'node:path';

// Dev-server endpoints behind the page (npm run dev only), local requests only:
//   GET  /api/hardware            live GPU (nvidia-smi) and CPU processor telemetry
//   GET  /api/recordings          processed recordings (runs/, examples/) and raw videos waiting in recordings/
//   POST /api/recordings          save a camera clip from the page to recordings/<time>.webm (or .mp4)
//   POST /api/process {file}      run the 3D body + Meta Muse Spark pipeline on a raw video
//   GET  /api/process/status      live pipeline stage progress (0-100%), logs, and GPU/CPU telemetry
//   POST /api/live/start {run, start}   the director replays that recording from `start` s with Meta Muse Spark captions
//   POST /api/live/stop           stop the director
//   POST /api/live/caption {images}   live session: Meta Muse Spark captions 1-2 camera frames and names the posture
const MAX_RECORDING_BYTES = 500 * 2 ** 20;
const VIDEO = /\.(mp4|mov|webm|mkv)$/i;
const SKIP = new Set(['day', '_smoke']);
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const POSTURES = ['walking', 'standing', 'sitting', 'crouching', 'bending', 'arms raised'];
const LIVE_PROMPT = 'These are frames, 1 s apart, from a camera on a person\'s head. Answer with one JSON object only: '
  + '{"caption": what the person is doing, one short sentence starting with a verb, "posture": one of '
  + `${POSTURES.join(', ')}}.`;

const PIPELINE_STAGES = [
  { id: 'ingest', label: 'Video ingest & 30 fps normalization', pct: 8 },
  { id: 'hawor', label: 'HaWoR 3D hand tracking & DROID-SLAM', pct: 24 },
  { id: 'build_input', label: 'Floor plane & camera height calibration', pct: 42 },
  { id: 'omniegocap', label: 'OmniEgoCap 3D full-body SMPL-H reconstruction', pct: 60 },
  { id: 'render', label: '3D body mesh & kinematics stream rendering', pct: 74 },
  { id: 'describe_muse', label: 'Meta Muse Spark egocentric scene narration', pct: 84 },
  { id: 'posture_muse', label: 'Biomechanical & Meta Muse Spark posture analysis', pct: 92 },
  { id: 'routine_tips', label: 'Meta Muse Spark routine coaching & history review', pct: 97 },
];

function lifelensApi() {
  let director = null;
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
          pov: url('input.mp4') ?? small(`input/${name}.mp4`) ?? prev?.pov ?? null,
          body: (dir === 'runs' ? url('mesh_exo.mp4') : null) ?? small(`${name}-body.mp4`) ?? url('mesh_exo.mp4'),
          graph: (dir === 'runs' ? url('pose_graph.mp4') : null) ?? small(`${name}-graph.mp4`) ?? url('pose_graph.mp4'),
          files: Object.fromEntries(['pose_timeseries.csv', 'activity.csv', 'insights.json', 'postures.json',
            'narration_muse.json'].map((f) => [f, url(f)])),
        });
      }
    }
    const raw = existsSync(join(root, 'recordings')) ? readdirSync(join(root, 'recordings'))
      .filter((f) => VIDEO.test(f) && !found.has(basename(f, extname(f))))
      .map((f) => ({ file: `recordings/${f}`, name: basename(f, extname(f)), size: statSync(join(root, 'recordings', f)).size })) : [];
    return { processed: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)), raw };
  }

  function processSteps(file, name) {
    const history = recordings().processed.filter((r) => r.name !== name).map((r) => r.base).join(' ');
    return [
      ['3D body & Meta Muse Spark narration', true, ...wsl(`PATH=${env('omniegocap')}:$PATH ${env('omniegocap')}/python pipeline/run.py '${file}' '${name}'`)],
      ['Meta Muse Spark posture', false, python(), ['-m', 'director.posture_muse', `runs/${name}`]],
      ['Posture sources', false, ...wsl(`${env('mhr')}/python bench/posture_sources.py runs/${name}`)],
      ['Meta Muse Spark routine coaching', false, python(), ['-m', 'director.routine_tips', `runs/${name}`, '--history', ...history.split(' ').filter(Boolean)]],
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

  function runSteps(steps, i = 0) {
    if (i === steps.length) {
      job.done = true;
      job.percent = 100;
      job.stageIndex = PIPELINE_STAGES.length;
      job.step = 'Complete';
      return;
    }
    const [label, critical, cmd, args] = steps[i];
    const stageOf = ['', 'posture_muse', 'posture_muse', 'routine_tips'][i];
    job.index = i;
    if (i === 0) setStage('ingest');
    else if (i === 1 || i === 2) setStage('posture_muse');
    else if (i === 3) setStage('routine_tips');
    job.step = PIPELINE_STAGES[job.stageIndex]?.label || label;

    const proc = spawn(cmd, args, { cwd: root, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } });
    const keep = (d) => {
      parseStageFromOutput(d);
      job.log = (job.log + d).slice(-2400);
    };
    proc.stdout.on('data', keep);
    proc.stderr.on('data', keep);
    proc.on('error', (err) => {
      if (critical) job.error = `${label}: ${err.message}`;
      else { job.failed.add(stageOf); runSteps(steps, i + 1); }
    });
    proc.on('exit', (code) => {
      if (code !== 0 && critical) job.error = `${label} stopped (exit ${code})`;
      else { if (code !== 0) job.failed.add(stageOf); runSteps(steps, i + 1); } // optional step failed: shown, not ticked
    });
  }

  function statusPayload() {
    refreshHardware();
    if (!job) return { idle: true, hardware: hwCache };
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
        if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });
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
          const name = `live-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}`;
          writeFileSync(join(root, 'recordings', `${name}.${ext}`), Buffer.concat(chunks));
          send(res, 200, { file: `recordings/${name}.${ext}`, name });
        });
      });

      server.middlewares.use('/api/process/status', (req, res) => send(res, 200, statusPayload()));

      server.middlewares.use('/api/process', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
        if (job && !job.done && !job.error) return send(res, 409, { error: `Already processing ${job.name}.` });
        const { file } = await readBody(req);
        const name = typeof file === 'string' ? basename(file, extname(file)) : '';
        if (!file?.startsWith('recordings/') || !VIDEO.test(file) || !NAME.test(name) || !existsSync(join(root, file))) {
          return send(res, 400, { error: 'Pick a video from recordings/.' });
        }
        const steps = processSteps(file, name);
        const now = Date.now();
        job = {
          file,
          name,
          step: PIPELINE_STAGES[0].label,
          index: 0,
          stageIndex: 0,
          stageAt: now,
          startedAt: now,
          percent: 0,
          steps: PIPELINE_STAGES.map((s) => s.label),
          log: '',
          error: '',
          failed: new Set(), // optional stages that failed or were skipped
          done: false,
        };
        runSteps(steps);
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
          const r = await fetch('https://api.meta.ai/v1/responses', {
            method: 'POST', signal: AbortSignal.timeout(30000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: process.env.MUSE_MODEL || 'muse-spark-1.3', input: [{ role: 'user', content: [
              { type: 'input_text', text: LIVE_PROMPT }, ...images.map((image_url) => ({ type: 'input_image', image_url }))] }] }),
          });
          if (!r.ok) return send(res, 502, { error: `Muse answered ${r.status}` });
          const p = await r.json();
          const text = p.output_text || (p.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('');
          const answer = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
          const posture = POSTURES.includes(answer.posture) ? answer.posture : '';
          send(res, 200, { caption: String(answer.caption ?? '').slice(0, 200), posture, ms: Date.now() - t0 });
        } catch (err) {
          send(res, 502, { error: err.name === 'TimeoutError' ? 'Muse did not answer in 30 s' : `Muse: ${err.message}` });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [lifelensApi()],
  server: { port: 8000, strictPort: true },
  preview: { port: 8000, strictPort: true },
});
