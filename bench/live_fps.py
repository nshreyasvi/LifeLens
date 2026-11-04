"""
How fast the own-video pipeline would run "live" on this machine: cut a short piece of a video, run pipeline/run.py on
it in own-video mode (SLAM included, no --input_npz) and turn each stage's wall time (runs/<name>/timings.tsv) into
seconds of processing per second of video and the equivalent frame rate. HaWoR's stage is split into its steps by the
time its log lines arrive, GPU memory and load are sampled with nvidia-smi. Separately times the director's fast loop
on a clip's precomputed kinematics, which only exists after the pipeline has made the 3D body.

WSL, omniegocap env:   python bench/live_fps.py pipeline runs/office/input.mp4 --start 23 --dur 10 --focal 929.5 --runs 2
Director's Python:     python bench/live_fps.py director runs/office runs/bench_live10

Each part updates its key in bench/live_fps.json. Every stage of run.py is its own process, so every run loads its
models again; a second run differs from the first only by warm file caches.
"""

import argparse
import json
import os
import platform
import shutil
import statistics
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'live_fps.json')
FPS = 30
# first log line after each HaWoR step (third_party/HaWoR/scripts/scripts_test_video), with the step it ends
HAWOR_STEPS = (('Running detect_track on', 'python + torch imports'), ('Detect and Track', 'extract frames to jpg'),
               ('100%|', 'hand detection + tracking (YOLO)'), ('Running hawor on', 'HaWoR checkpoint load'),
               ('Running slam on', 'HaWoR hand mesh + SLAM masks'), ('DBA errors', 'DROID-SLAM (load, track, BA)'),
               ('Predicting Metric Depth', 'Metric3D checkpoint load'),
               ('Estimating Metric Scale', 'Metric3D keyframe depth'))


def nvidia_smi(*query):
    exe = shutil.which('nvidia-smi') or '/usr/lib/wsl/lib/nvidia-smi'
    return [exe, f'--query-gpu={",".join(query)}', '--format=csv,noheader,nounits']


def run_logged(cmd, env, log_path):
    """Run cmd, timestamp each output line (and each tqdm update) as it arrives, sample the GPU every 0.5 s."""
    gpu, lines = [], []
    smi = subprocess.Popen(nvidia_smi('memory.used', 'utilization.gpu') + ['-lms', '500'], stdout=subprocess.PIPE,
                           text=True)
    threading.Thread(target=lambda: [gpu.append((time.time(), *map(float, l.split(',')))) for l in smi.stdout],
                     daemon=True).start()
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, cwd=ROOT, text=True,
                         errors='replace')
    for line in p.stdout:
        lines.append((time.time(), line.rstrip()))
        if line.startswith('== ') or line.startswith('Done'):
            print(line.rstrip(), flush=True)
    p.wait()
    lines.append((time.time(), '== end'))
    smi.terminate()
    with open(log_path, 'w') as f:
        f.writelines(f'{t:.3f}\t{l}\n' for t, l in lines)
    if p.returncode:
        raise subprocess.CalledProcessError(p.returncode, cmd)
    return lines, gpu


def one_run(a, name, env):
    run_dir = os.path.join(ROOT, 'runs', name)
    shutil.rmtree(run_dir, ignore_errors=True)     # run.py skips stages whose output exists: start clean
    os.makedirs(run_dir)
    clip = os.path.join(run_dir, 'clip.mp4')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(a.start), '-i', os.path.abspath(a.video),
                    '-frames:v', str(round(a.dur * FPS)), '-an', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
                    clip], check=True, env=env)
    load_before = round(os.getloadavg()[0], 1)      # other jobs on the machine slow the CPU-bound stages
    lines, gpu = run_logged([sys.executable, os.path.join(ROOT, 'pipeline', 'run.py'), clip, name,
                             '--focal', str(a.focal)], env, os.path.join(run_dir, 'live_fps.log'))
    man = json.load(open(os.path.join(run_dir, 'manifest.json')))
    frames, video_s = man['frames'], man['duration_s']
    rate = lambda s: {'wall_s': round(s, 2), 's_per_video_s': round(s / video_s, 2), 'equiv_fps': round(frames / s, 2)}

    starts = [(t, l[3:]) for t, l in lines if l.startswith('== ') and ': skip' not in l and not l.startswith('== focal')]
    span = {n: (t0, t1) for (t0, n), (t1, _) in zip(starts, starts[1:])}
    stages = []
    for row in open(os.path.join(run_dir, 'timings.tsv')).read().split('\n'):
        if row:
            n, s = row.split('\t')
            g = [x for x in gpu if span.get(n, (0, 0))[0] <= x[0] <= span.get(n, (0, 0))[1]]
            stages.append({'stage': n, **rate(float(s)),
                           'gpu_mem_peak_mb': max((x[1] for x in g), default=None),
                           'gpu_util_mean_pct': round(statistics.mean(x[2] for x in g)) if g else None})

    hawor, (t, end) = [], span['hawor']             # HaWoR's steps, from the time their first line arrived
    for marker, step in HAWOR_STEPS:
        hit = next((tl for tl, l in lines if t <= tl <= end and marker in l), None)
        if hit:
            hawor.append({'step': step, **rate(hit - t)})
            t = hit
    hawor.append({'step': 'metric scale + export', **rate(end - t)})

    total = sum(s['wall_s'] for s in stages)
    shutil.rmtree(os.path.join(run_dir, 'input'), ignore_errors=True)     # HaWoR's frame and mask cache
    return {'run': name, 'frames': frames, 'video_s': video_s, 'loadavg_1min_before': load_before,
            'stages': stages, 'hawor_steps': hawor,
            'model_only_s': {'omniegocap_load': man['omniegocap']['load_s'],
                             'omniegocap_predict': man['omniegocap']['runtime_s'],
                             'qwen_narration_load': man.get('narration', {}).get('load_s'),
                             'qwen_narration_run': man.get('narration', {}).get('run_s'),
                             'insights_total': json.load(open(os.path.join(run_dir, 'insights.json'))).get('runtime_s')},
            'end_to_end': {**rate(total), 'latency_for_video_s': round(total, 1)}}


def pipeline(a):
    env = dict(os.environ, PYTHONUNBUFFERED='1', PATH=os.path.dirname(sys.executable) + os.pathsep + os.environ['PATH'])
    name, mem, drv = subprocess.run(nvidia_smi('name', 'memory.total', 'driver_version'), capture_output=True,
                                    text=True).stdout.strip().split(', ')
    cpu = next((l.split(':', 1)[1].strip() for l in open('/proc/cpuinfo') if l.startswith('model name')), '?')
    machine = {'gpu': name, 'gpu_mem_mb': int(mem), 'driver': drv, 'cpu': cpu, 'cpu_threads': os.cpu_count(),
               'ram_gb': round(os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES') / 2**30, 1),
               'os': platform.platform(), 'source': f'{a.video} {a.start}-{a.start + a.dur} s', 'focal_px': a.focal}
    runs = [one_run(a, a.name if r == 0 else f'{a.name}_r{r + 1}', env) for r in range(a.runs)]
    save('pipeline', {'machine': machine, 'runs': runs})
    for r in runs:
        print(f"\n{r['run']}: {r['frames']} frames, {r['video_s']} s\n{'stage':<34}{'wall s':>8}{'s/video s':>11}"
              f"{'fps':>8}{'GPU MB':>8}{'GPU %':>7}")
        for s in r['stages'] + [{'stage': '  ' + h['step'], **h} for h in r['hawor_steps']] + [
                {'stage': 'END TO END', **r['end_to_end']}]:
            print(f"{s['stage']:<34}{s['wall_s']:>8}{s['s_per_video_s']:>11}{s['equiv_fps']:>8}"
                  f"{str(s.get('gpu_mem_peak_mb') or ''):>8}{str(s.get('gpu_util_mean_pct') or ''):>7}")


def director(a):
    sys.path.insert(0, ROOT)
    from director.anticipation import FreezePredictor
    from director.fast_loop import FastLoop
    from director.replay import load_clip
    rows = []
    for path in a.clips:
        t0 = time.perf_counter()
        clip = load_clip(path)
        load_s = time.perf_counter() - t0
        steps = []
        for _ in range(a.passes):           # fresh loop per pass, as a new replay would start
            fast = FastLoop(FreezePredictor())
            for f in clip.frames:
                t = time.perf_counter()
                json.dumps(fast.step(f)[0])
                steps.append(time.perf_counter() - t)
        steps.sort()
        ms = lambda q: round(1000 * steps[min(len(steps) - 1, int(q * len(steps)))], 4)
        rows.append({'clip': path, 'frames': len(clip.frames), 'video_s': round(len(clip.frames) / clip.fps, 1),
                     'load_clip_s': round(load_s, 3), 'step_ms_mean': round(1000 * statistics.mean(steps), 4),
                     'step_ms_p50': ms(0.5), 'step_ms_p99': ms(0.99), 'step_ms_max': ms(1.0),
                     'equiv_fps': round(len(steps) / sum(steps)), 'budget_ms_at_30fps': round(1000 / FPS, 1)})
        print(json.dumps(rows[-1]))
    save('director', {'python': sys.version.split()[0], 'os': platform.platform(), 'passes': a.passes,
                      'note': 'FastLoop.step + JSON of its message per frame, on the 3D body the pipeline already '
                              'made (pose_timeseries.csv, joints_world.csv, activity.csv); no WebSocket send, no '
                              'slow loop / LLM call', 'clips': rows})


def save(key, value):
    data = json.load(open(OUT)) if os.path.exists(OUT) else {}
    data[key] = value
    with open(OUT, 'w') as f:
        json.dump(data, f, indent=2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='part', required=True)
    p = sub.add_parser('pipeline')
    p.add_argument('video')
    p.add_argument('--start', type=float, default=23.0)
    p.add_argument('--dur', type=float, default=10.0)
    p.add_argument('--focal', type=float, default=929.5)
    p.add_argument('--name', default='bench_live10')
    p.add_argument('--runs', type=int, default=2)
    d = sub.add_parser('director')
    d.add_argument('clips', nargs='+')
    d.add_argument('--passes', type=int, default=5)
    a = parser.parse_args()
    pipeline(a) if a.part == 'pipeline' else director(a)
