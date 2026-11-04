import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

// Dev-server endpoints behind the page (npm run dev only), local requests only:
//   GET  /api/recordings          processed recordings (runs/, examples/) and raw videos waiting in recordings/
//   POST /api/recordings          save a camera clip from the page to recordings/<time>.webm (or .mp4)
//   POST /api/process {file}      run the pipeline on a raw video, then the posture models and Muse's review
//   GET  /api/process/status      what the pipeline is doing
//   POST /api/live/start {run, start, captions}   the director replays that recording from `start` s with Qwen's or
//                                 Muse's captions; the page follows it
//   POST /api/live/stop           stop the director
//   POST /api/live/caption {images}   live session: Meta Muse Spark captions 1-2 camera frames and names the posture
// The pipeline runs in WSL on Windows (conda envs from setup.sh); DIRECTOR_PYTHON is a Python with
// director/requirements.txt (default director/venv, else "python"). Model calls need director/.env (Muse key).
const MAX_RECORDING_BYTES = 500 * 2 ** 20;
const VIDEO = /\.(mp4|mov|webm|mkv)$/i;
const SKIP = new Set(['day', '_smoke']);
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const POSTURES = ['walking', 'standing', 'sitting', 'crouching', 'bending', 'arms raised'];
const LIVE_PROMPT = 'These are frames, 1 s apart, from a camera on a person\'s head. Answer with one JSON object only: '
  + '{"caption": what the person is doing, one short sentence starting with a verb, "posture": one of '
  + `${POSTURES.join(', ')}}.`;

function lifelensApi() {
  let director = null;
  let job = null; // { file, name, step, steps, log, error, done }
  let root = '';
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
    req.on('data', (c) => { s += c; if (s.length > 2e6) req.destroy(); }); // JSON bodies only; videos stream separately
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } });
  });
  const wsl = (cmd) => (process.platform === 'win32'
    ? ['wsl', ['-e', 'bash', '-lc', `cd '/mnt/${root[0].toLowerCase()}${root.slice(2).replace(/\\/g, '/')}' && ${cmd}`]]
    : ['bash', ['-lc', `cd '${root}' && ${cmd}`]]);
  const env = (name) => `~/anaconda3/envs/${name}/bin`;
  // The Muse key, from director/.env only (gitignored); never sent to the page.
  const museKey = () => {
    const f = join(root, 'director', '.env');
    const line = existsSync(f) ? readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith('MUSE_API_KEY=')) : null;
    return line ? line.split('=').slice(1).join('=').trim() : '';
  };

  // A processed recording has the 3D body and its kinematics; runs/ wins over examples/ (it holds the POV).
  function recordings() {
    const found = new Map();
    for (const dir of ['examples', 'runs']) {
      const base = join(root, dir);
      if (!existsSync(base)) continue;
      for (const name of readdirSync(base)) {
        const run = join(base, name);
        if (SKIP.has(name) || name.startsWith('bench_') || !existsSync(join(run, 'pose_timeseries.csv'))
          || !existsSync(join(run, 'mesh_exo.mp4')) || !existsSync(join(run, 'insights.json'))) continue;
        const url = (f) => (existsSync(join(run, f)) ? `/${dir}/${name}/${f}` : null);
        const small = (f) => (existsSync(join(root, 'public', 'video', f)) ? `/video/${f}` : null);
        const frames = readFileSync(join(run, 'pose_timeseries.csv'), 'utf8').split('\n').length - 2;
        const prev = found.get(name);
        found.set(name, {
          name, base: `${dir}/${name}`, seconds: Math.round(frames / 30), processed: statSync(run).mtime.toISOString(),
          pov: small(`input/${name}.mp4`) ?? url('input.mp4') ?? prev?.pov ?? null,
          body: small(`${name}-body.mp4`) ?? url('mesh_exo.mp4'),
          graph: small(`${name}-graph.mp4`) ?? url('pose_graph.mp4'),
          files: Object.fromEntries(['pose_timeseries.csv', 'activity.csv', 'insights.json', 'postures.json',
            'narration.json', 'narration_muse.json'].map((f) => [f, url(f)])),
        });
      }
    }
    const raw = existsSync(join(root, 'recordings')) ? readdirSync(join(root, 'recordings'))
      .filter((f) => VIDEO.test(f) && !found.has(basename(f, extname(f))))
      .map((f) => ({ file: `recordings/${f}`, name: basename(f, extname(f)), size: statSync(join(root, 'recordings', f)).size })) : [];
    return { processed: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)), raw };
  }

  // The pipeline, then the posture models and Muse's review against the other recordings.
  function processSteps(file, name) {
    const history = recordings().processed.filter((r) => r.name !== name).map((r) => r.base).join(' ');
    return [
      ['3D body, narration, posture', ...wsl(`PATH=${env('omniegocap')}:$PATH ${env('omniegocap')}/python pipeline/run.py '${file}' '${name}'`)],
      ['Qwen3-VL posture', ...wsl(`${env('vlm')}/python pipeline/describe.py --run runs/${name} --ask posture`)],
      ['Muse captions', ...wsl(`${env('vlm')}/python pipeline/describe_muse.py --run runs/${name}`)],
      ['Muse posture', python(), ['-m', 'director.posture_muse', `runs/${name}`]],
      ['Posture sources', ...wsl(`${env('mhr')}/python bench/posture_sources.py runs/${name}`)],
      ['Muse review', python(), ['-m', 'director.routine_tips', `runs/${name}`, '--history', ...history.split(' ').filter(Boolean)]],
    ];
  }

  function runSteps(steps, i = 0) {
    if (i === steps.length) { job.done = true; job.step = 'Done'; return; }
    const [label, cmd, args] = steps[i];
    job.step = label;
    job.index = i;
    const proc = spawn(cmd, args, { cwd: root, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    const keep = (d) => { job.log = (job.log + d).slice(-1500); };
    proc.stdout.on('data', keep);
    proc.stderr.on('data', keep);
    proc.on('error', (err) => { job.error = `${label}: ${err.message}`; });
    proc.on('exit', (code) => {
      if (code !== 0) job.error = `${label} stopped (exit ${code})`;
      else runSteps(steps, i + 1);
    });
  }

  return {
    name: 'lifelens-api',
    configureServer(server) {
      root = server.config.root;
      server.middlewares.use('/api/', (req, res, next) => (local(req) ? next() : send(res, 403, { error: 'Local only.' })));

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
          const ext = (req.headers['content-type'] || '').includes('mp4') ? 'mp4' : 'webm'; // Safari records mp4
          const name = `live-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}`;
          writeFileSync(join(root, 'recordings', `${name}.${ext}`), Buffer.concat(chunks));
          send(res, 200, { file: `recordings/${name}.${ext}`, name });
        });
      });

      server.middlewares.use('/api/process/status', (req, res) => send(res, 200, job ?? { idle: true }));

      server.middlewares.use('/api/process', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
        if (job && !job.done && !job.error) return send(res, 409, { error: `Already processing ${job.name}.` });
        const { file } = await readBody(req);
        const name = typeof file === 'string' ? basename(file, extname(file)) : '';
        if (!file?.startsWith('recordings/') || !VIDEO.test(file) || !NAME.test(name) || !existsSync(join(root, file))) {
          return send(res, 400, { error: 'Pick a video from recordings/.' });
        }
        const steps = processSteps(file, name);
        job = { file, name, step: '', index: 0, steps: steps.map((s) => s[0]), log: '', error: '', done: false };
        runSteps(steps);
        send(res, 200, { ok: true, steps: job.steps });
      });

      server.middlewares.use('/api/live/status', (req, res) => send(res, 200, { running: Boolean(director) }));

      server.middlewares.use('/api/live/stop', (req, res) => {
        director?.kill();
        director = null;
        send(res, 200, { ok: true });
      });

      server.middlewares.use('/api/live/start', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
        const { run, start, captions } = await readBody(req);
        const known = recordings().processed.find((r) => r.base === run);
        if (!known) return send(res, 400, { error: 'Unknown recording.' });
        director?.kill();
        const from = Math.max(0, Math.min(Number(start) || 0, known.seconds - 2));
        const args = ['-m', 'director.server', known.base, '--start', from.toFixed(2)];
        if (!existsSync(join(root, 'director', '.env'))) args.push('--no-model');
        if (captions === 'muse' && known.files['narration_muse.json']) args.push('--captions', 'muse');
        let lastError = '';
        const proc = spawn(python(), args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
          // UTF-8: on Windows a piped Python stdout is cp1252 and crashes on a model reply with "→"
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
