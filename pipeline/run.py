#!/usr/bin/env python3
"""
Ego video -> full-body 3D motion in SMPL-H (fingers from HaWoR), side-by-side video with pose graph, narration.
Pure-Python runner replacing pipeline/run.sh.

Usage:
    python pipeline/run.py <video> [run_name] [--focal FOCAL] [--input_npz input.npz] [--device DEVICE] [--opt]
                           [--describe qwen|dam|none ...]

Only OmniEgoCap's own tools: HaWoR for wrists and its SLAM for the camera path (focal: --focal, else HaWoR's default),
gravity and floor from the floor plane in that SLAM's points. No GeoCalib, no lens height to measure.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PIPELINE = os.path.join(ROOT, 'pipeline')
CONDA_ROOT = os.environ.get('CONDA_ROOT', os.path.expanduser('~/anaconda3'))


def get_python(env: str) -> str:
    path = os.path.join(CONDA_ROOT, 'envs', env, 'bin', 'python')
    if os.path.exists(path):
        return path
    win_path = os.path.join(CONDA_ROOT, 'envs', env, 'python.exe')
    if os.path.exists(win_path):
        return win_path
    return sys.executable


def iphone_focal(video: str, work_mp4: str):
    """Focal length (px) of the working video from the 35 mm-equivalent focal length iPhones write into their videos,
    or None. shortcut: ignores the few % of crop from video stabilization; pass --focal when it is known exactly."""
    probe = lambda *a: json.loads(subprocess.run(['ffprobe', '-v', 'error', *a, '-of', 'json'], capture_output=True,
                                                 text=True, check=True).stdout)
    tags = probe('-show_entries', 'format_tags', video).get('format', {}).get('tags', {})
    f35 = tags.get('com.apple.quicktime.camera.focal_length.35mm_equivalent')
    if not f35:
        return None
    s = probe('-select_streams', 'v:0', '-show_entries', 'stream=width,height', work_mp4)['streams'][0]
    return float(f35) / 36 * max(s['width'], s['height'])     # 35 mm film: 36 mm across the frame's long side


# Head cameras: horizontal field of view (deg; the focal length follows from the working video's width), the lens
# position in the head frame (m: x left, y up, z forward from the head joint) and an ingest lens filter.
# shortcut: only gopro-linear is measured (OmniEgoDB's GoPro HERO10, ~92 deg); the others are estimates from typical
# specs, check calibration.json (camera height) on your first recording and pass --focal when you know it.
CAMERAS = {
    'gopro-linear': (92.0, (0.0, 0.16, 0.12), ''),
    'gopro-wide': (116.0, (0.0, 0.16, 0.12), 'lenscorrection=cx=0.5:cy=0.5:k1=-0.227:k2=-0.022,'),
    'phone': (69.4, (0.0, 0.14, 0.13), ''),           # main 1x lens, ~26 mm equivalent; iPhone metadata wins
    'glasses': (80.0, (0.07, 0.06, 0.10), ''),        # Meta Ray-Ban: camera at the left temple, near the eyes
}


def run_stage(name: str, out_file: str, cmd: list, run_dir: str):
    target = os.path.join(run_dir, out_file)
    if os.path.exists(target):
        print(f"== {name}: skip ({out_file} exists)", flush=True)
        return
    print(f"== {name}", flush=True)
    t0 = time.time()
    subprocess.run(cmd, check=True)
    dt = round(time.time() - t0, 4)
    with open(os.path.join(run_dir, 'timings.tsv'), 'a') as f:
        f.write(f"{name}\t{dt}\n")


def main():
    parser = argparse.ArgumentParser(description="Process egocentric video into full-body SMPL-H motion.")
    parser.add_argument("video", help="Input video file path.")
    parser.add_argument("name", nargs="?", default=None, help="Run name (defaults to video basename).")
    parser.add_argument("--focal", type=float, default=None,
                        help="Focal length (px) of the 30 fps, <=1920 px wide working video; else HaWoR's default.")
    parser.add_argument("--device", default=None, help="Device name (e.g. gopro).")
    parser.add_argument("--camera", choices=sorted(CAMERAS), default=None,
                        help="Head camera preset: field of view (focal), lens position in the head, lens correction.")
    parser.add_argument("--opt", action="store_true", help="Enable OmniEgoCap wrist guidance optimization.")
    parser.add_argument("--smooth", type=float, default=2.0,
                        help="Body smoothing sigma in frames; 0 keeps OmniEgoCap's raw output (paper-comparable).")
    parser.add_argument("--input_npz", default=None,
                        help="Ready OmniEgoCap input, e.g. OmniEgoDB's input.npz: no SLAM and no build_input (HaWoR "
                             "still runs for the finger poses), and the video is cut to its frames (raw_time_s).")
    parser.add_argument("--describe", nargs="+", default=["muse"], choices=["muse", "none"],
                        help="Video description model(s): muse = Meta Muse Spark narration of the activity; none = skip.")
    args = parser.parse_args()

    video_path = os.path.abspath(args.video)
    name = args.name or os.path.splitext(os.path.basename(video_path))[0]
    run_dir = os.path.join(ROOT, 'runs', name)
    os.makedirs(run_dir, exist_ok=True)

    py_omniego = get_python('omniegocap')
    py_hawor = get_python('hawor')
    py_mhr = get_python('mhr')

    # 1. Ingest (30 fps CFR, max 1920 width, no audio)
    input_mp4 = os.path.join(run_dir, 'input.mp4')
    tmp_mp4 = os.path.join(run_dir, 'tmp.mp4')
    if not os.path.exists(input_mp4):
        print("== ingest", flush=True)
        t0 = time.time()
        cut = []
        if args.input_npz:     # the input's frames: from raw_time_s[0] on the video's clock, one per input frame
            seq = np.load(args.input_npz)
            start = float(seq['raw_time_s'][0]) if 'raw_time_s' in seq else 0.0
            cut = ['-frames:v', str(len(seq['head']))]
        ffmpeg_cmd = [
            'ffmpeg', '-y', '-loglevel', 'error', '-ss', str(start if args.input_npz else 0), '-i', video_path,
            '-vf', f"{CAMERAS[args.camera][2] if args.camera else ''}fps=30,scale='min(1920,iw)':-2", '-an', *cut,
            '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', tmp_mp4
        ]
        subprocess.run(ffmpeg_cmd, check=True)
        os.replace(tmp_mp4, input_mp4)
        with open(os.path.join(run_dir, 'timings.tsv'), 'a') as f:
            f.write(f"ingest\t{round(time.time() - t0, 4)}\n")
    else:
        print("== ingest: skip (input.mp4 exists)", flush=True)

    try:
        # 2. HaWoR: wrists and finger poses, plus the SLAM camera path unless the input comes ready
        if not args.focal:
            args.focal = iphone_focal(video_path, input_mp4)
            if args.focal:
                print(f"== focal: {args.focal:.1f} px from the iPhone's lens metadata", flush=True)
        if not args.focal and args.camera:          # the preset's field of view at the working video's width
            w = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width',
                                           '-of', 'json', input_mp4], capture_output=True, text=True, check=True).stdout)['streams'][0]['width']
            args.focal = (w / 2) / np.tan(np.radians(CAMERAS[args.camera][0] / 2))
            print(f"== focal: {args.focal:.1f} px from the {args.camera} preset ({CAMERAS[args.camera][0]:g} deg)", flush=True)
        if not args.focal:
            print("== focal: unknown, HaWoR assumes 600 px. Pick the device or pass --focal, or SLAM may fail", flush=True)
        hawor_cmd = [py_hawor, os.path.join(PIPELINE, 'hawor_export.py'), '--video', input_mp4, '--out_dir', run_dir]
        if args.focal:
            hawor_cmd.extend(['--focal', str(args.focal)])
        if args.input_npz:
            hawor_cmd.append('--hands_only')
        run_stage('hawor', 'wrist.npz', hawor_cmd, run_dir)

        if args.input_npz:
            shutil.copy(args.input_npz, os.path.join(run_dir, 'omniegocap_input.npz'))
        else:
            # 3. Build Input (gravity and floor from the SLAM floor plane)
            build_cmd = [py_omniego, os.path.join(PIPELINE, 'build_input.py'), '--run', run_dir]
            if args.device:
                build_cmd.extend(['--device', args.device])
            if args.camera:
                build_cmd.extend(['--cam_in_head', *map(str, CAMERAS[args.camera][1])])
            run_stage('build_input', 'omniegocap_input.npz', build_cmd, run_dir)

        # 4. OmniEgoCap (SMPL-H generation with articulated hands)
        ego_cmd = [py_omniego, os.path.join(PIPELINE, 'run_omniegocap.py'), '--run', run_dir, '--smooth', str(args.smooth)]
        if args.opt:
            ego_cmd.append('--optimization')
        run_stage('omniegocap', 'smplh_canonical.npz', ego_cmd, run_dir)

        # 5. Render
        render_cmd = [py_mhr, os.path.join(PIPELINE, 'render.py'), '--run', run_dir]
        run_stage('render', 'side_by_side.mp4', render_cmd, run_dir)
    except subprocess.CalledProcessError as exc:
        # No stand-in body: a recording without its own 3D body stops here, with the stage's error above.
        sys.exit(f"== 3D body failed ({os.path.basename(exc.cmd[1])} exited with {exc.returncode}); see the error above. "
                 "Short or static clips can give SLAM too little motion: record 20 s or more while walking around.")

    # 6. Video captions by Meta Muse Spark (narration_muse.json)
    muse_env = os.path.join(ROOT, 'director', '.env')
    if 'none' not in args.describe and os.path.exists(muse_env):
        try:
            run_stage('describe_muse', 'narration_muse.json',
                      [get_python('vlm'), os.path.join(PIPELINE, 'describe_muse.py'), '--run', run_dir], run_dir)
        except subprocess.CalledProcessError as exc:
            print(f"== describe_muse warning: {exc}", flush=True)

    # 7. Activity insights: posture per second, time split, breaks, and summary metrics
    run_stage('insights', 'insights.json',
              [get_python('vlm'), os.path.join(PIPELINE, 'insights.py'), run_dir], run_dir)

    print(f"Done: {run_dir}", flush=True)


if __name__ == '__main__':
    main()

