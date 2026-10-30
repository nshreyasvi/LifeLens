# LifeLens: ego video → 3D body motion, pose graph and scene descriptions

A head-mounted **phone or GoPro** video goes in. Out come the wearer's full-body 3D motion (SMPL-H, fingers included),
a third-person mesh video with a live pose graph, a one-sentence narration every 5 s (Qwen3-VL-2B), detailed region
descriptions (NVIDIA Describe Anything) and the motion as plain `.npy` / `.csv` tables. Everything shares one 30 fps
frame clock and lands in one folder, `runs/<name>/`.

Built on [OmniEgoCap](https://github.com/KyungWonCho/OmniEgoCap) (full-body motion from head + wrist poses) and
[HaWoR](https://github.com/ThunderVVV/HaWoR) (hands and camera from the video), the hand estimator OmniEgoCap's GoPro
inputs used.

```
video ─ ingest ─ hawor ─────────────────── build_input ─── omniegocap ─── render ──────────── describe ─── describe_anything
        30 fps   HaWoR hands (wrists +     floor plane in   diffusion:     mesh_exo.mp4       Qwen3-VL-2B   DAM-3B-Video
        ≤1920px  fingers) + masked         the SLAM points  head+wrists    pose_graph.mp4     narration     on ego / pose /
                 DROID-SLAM + Metric3D     → z up, floor    → SMPL-H       side_by_side.mp4                 both (optional)
```

| Stage | Env | What it does |
|---|---|---|
| `ingest` | omniegocap | ffmpeg to 30 fps CFR (OmniEgoCap's rate), at most 1920 px wide |
| `hawor` | hawor | HaWoR: camera-frame wrists and finger poses; its masked DROID-SLAM camera path with Metric3D scale and the scene points. SLAM runs on 30 s pieces (it holds at most 512 keyframes), joined on 3 s overlaps |
| `build_input` | omniegocap | OmniEgoCap's `trajectory` adapter needs a z-up world and the floor height and leaves both to the user: both come from the floor plane fitted in HaWoR's SLAM points. Head mount from the first 3 s |
| `omniegocap` | omniegocap | OmniEgoCap sequence diffusion → SMPL-H body (22 joints); fingers from HaWoR where a hand was seen; motion exported as `.npy` / `.csv` |
| `render` | mhr | pyrender third-person follow camera; scrolling 10 s pose graph under the ego and mesh videos; manifest |
| `describe` | vlm | [Qwen3-VL-2B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct): what the wearer is doing, one sentence per 5 s |
| `describe_anything` | dam | `--dam` only. [DAM-3B-Video](https://github.com/NVlabs/describe-anything) per 5 s, on three inputs: **ego** (SAM 2.1 tracks the object below the image center), **pose** (the rendered body) and **both** side by side |

Two ways in:

* **Your own video**: everything is estimated from the video (`hawor` with SLAM, then `build_input`).
* **A ready OmniEgoCap input** (`--input_npz`), e.g. an [OmniEgoDB](https://huggingface.co/datasets/cscandkswon/OmniEgoDB)
  sequence's `input.npz`: the authors' own camera path and wrists, as in the paper. HaWoR then runs without SLAM, only
  for the finger poses, and the video is cut to the input's frames (`raw_time_s`).

## Setup (WSL2 Ubuntu or Linux, NVIDIA GPU, CUDA 12.6)

```bash
cd /mnt/d/Projects/metahack_project
bash setup.sh          # envs omniegocap, hawor, mhr, vlm: clones pinned upstream commits, builds, downloads weights
bash setup.sh dam      # optional: Describe Anything + SAM 2.1 (NVIDIA Noncommercial License)
```

Five conda envs because the upstream projects pin conflicting Python and library versions. Each step of `setup.sh`
was run on the machine below; the script as a whole was not re-run from scratch.

Licensed body models, free registration at https://mano.is.tue.mpg.de:

| File | Put it at |
|---|---|
| SMPL-H "Extended SMPL+H model" `smplh.tar.xz` | `tar -xJf smplh.tar.xz -O neutral/model.npz > third_party/OmniEgoCap/data/smplh/SMPLH_NEUTRAL.npz` |
| MANO "Models & Code" `mano_v1_2.zip` → `models/MANO_RIGHT.pkl` | `third_party/HaWoR/_DATA/data/mano/` |
| same zip → `models/MANO_LEFT.pkl` | `third_party/HaWoR/_DATA/data_left/mano_left/` |

`setup.sh` also patches one line of HaWoR: it allocates every hand mask of a video as float64 (52 GB for 105 s of
1080p); booleans give the same masks in 6.5 GB.

## Recording your own video

The method needs a camera that is rigid with the head: it reconstructs the body from **head motion + wrists seen in
the camera**. Chest or handheld footage won't work.

* **Phone**: head mount in landscape, main 1× lens, stabilization off, 30 or 60 fps. **GoPro**: Linear lens,
  HyperSmooth and Horizon Leveling off.
* Tilt the camera down 20–30° so your hands are in view most of the time, and keep some floor in view (the floor fit
  needs it).
* For the first 3 seconds stand upright, look straight ahead and keep still (this gives the head mount).
* **Pass the focal length** with `--focal`, in pixels of the 1920-px-wide working video: `focal = 960 / tan(hfov / 2)`
  for a lens with horizontal field of view `hfov`. Without it HaWoR assumes 600 px (a ~116° lens), and a wrong focal
  length is what breaks SLAM (see Known limits).

## Run

```bash
python pipeline/run.py walk01.mp4 walk01 --focal 1500                       # your own video
python pipeline/run.py S04_outdoor_1.MP4 outdoor --focal 929.5 --device gopro \
    --input_npz omniegodb/gopro/S04_outdoor_1/input.npz --dam               # a ready OmniEgoCap input, with DAM
```

| Flag | Meaning |
|---|---|
| `--focal` | focal length (px) of the 1920-px-wide working video; default HaWoR's 600 |
| `--input_npz` | ready OmniEgoCap input: no SLAM, no `build_input`; HaWoR only for the fingers |
| `--dam` | also run Describe Anything on ego, pose and both |
| `--opt` | OmniEgoCap's wrist guidance optimization, off by default: on the paper's GoPro track (Table 3) it left body error unchanged (111.7 → 112.2 mm) and raised jerk 71% |
| `--device gopro` | draws the GoPro in OmniEgoCap's viewer |

Every stage is skipped when its output already exists: delete a file to redo that stage.

### Demos (OmniEgoDB office, robot home, outdoor)

Download the three GoPro sequences' videos and inputs (log in to Hugging Face and accept the dataset terms first),
put the videos in the project folder as `S03_office_1.MP4`, `S03_robothome_1.MP4`, `S04_outdoor_1.MP4`, then:

```bash
for s in S03_office_1 S03_robothome_1 S04_outdoor_1; do
  hf download cscandkswon/OmniEgoDB --repo-type dataset --local-dir omniegodb \
    --include "gopro/$s/input.npz" "gopro/$s/camera.json" "gopro/$s/gt.npz"
done
bash demos.sh          # runs/outdoor, runs/office, runs/robothome; the focal length comes from camera.json
```

## Output: `runs/<name>/`

| File | Content |
|---|---|
| `input.mp4` | ego video, 30 fps CFR |
| `mesh_exo.mp4` | body mesh, third-person follow camera; frame *i* = `input.mp4` frame *i* |
| `pose_graph.mp4` | scrolling pose graph |
| `side_by_side.mp4` | ego \| mesh, pose graph underneath |
| `kinematics/joints_world.csv`, `.npy` | (L, 22, 3) joint positions in meters, z up, floor at z = 0; CSV columns `pelvis_x … right_wrist_z` |
| `kinematics/joint_rotations.csv`, `.npy` | (L, 52, 3) SMPL-H axis-angle rotations, parent-relative: root, 21 body joints, 30 finger joints |
| `kinematics/root_trans.npy`, `betas.npy` | root translation (L, 3), body shape (16) |
| `kinematics/head_world.npy`, `wrist_world.npy`, `wrist_visible.npy` | model input: head (L, 4, 4), wrists (L, 2, 4, 4), which wrists were seen (L, 2) |
| `kinematics/time_s.npy`, `frame_valid.npy` | frame times, frames OmniEgoCap considers valid |
| `pose_timeseries.csv` | knee, hip, elbow flexion (L/R), trunk lean (deg), pelvis height (m), walking speed (m/s) per frame |
| `narration.json`, `narration.srt` | Qwen3-VL-2B: one sentence per 5 s (load the `.srt` as subtitles) |
| `dam_ego/pose/both.json`, `.srt` | DAM region descriptions per 5 s (`--dam`) |
| `calibration.json` | floor fit, camera height above it, mount tilt, path length (own-video mode): **check these first** |
| `manifest.json` | file index, per-stage wall time, real-time factor, narration and DAM timing |
| `smplh.npz`, `omniegocap_input.npz` | OmniEgoCap's own formats, kept as `.npz` for its viewer and evaluator |

Angles in the graph are unsigned (0 = straight / upright): a leg behind the body also reads as flexion.

Interactive 3D check (input poses, prediction, scene points, video in sync):

```bash
conda activate omniegocap
python third_party/OmniEgoCap/scripts/visualize.py --input runs/outdoor/omniegocap_input.npz \
    --pred runs/outdoor/smplh.npz --video runs/outdoor/input.mp4      # open http://localhost:8080
```

## Checks

```bash
conda activate omniegocap
python bench/smoke_test.py       # synthetic walk through build_input → describe: floor fit next to a wall and a
                                 # table, camera height and mount tilt recovered exactly, every output written
python bench/bench_latency.py    # OmniEgoCap model time per clip length
conda activate hawor && python bench/test_slam_align.py   # joining of the SLAM pieces
```

Pose accuracy against OmniEgoDB's Xsens ground truth, with OmniEgoCap's own evaluator (the paper's Table 3):

```bash
mkdir -p preds/gopro && cp runs/outdoor/smplh.npz preds/gopro/S04_outdoor_1.npz   # same for office, robothome
python third_party/OmniEgoCap/scripts/eval.py omniegodb --root omniegodb --track gopro --pred_dir preds/gopro --per_capture
```

## Speed (RTX 4060 Laptop 8 GB, i9-13900H, WSL2)

Own-video mode, 60 s of the OmniEgoDB outdoor GoPro clip:

| Stage | Time |
|---|---|
| ingest (4K HEVC → 1080p) | 39 s |
| hawor: hand poses + 3 SLAM pieces | 2076 s (35 min) |
| build_input | 7 s |
| omniegocap | 20 s |
| render + pose graph | 70 s |
| describe (13 sentences) | 25 s |
| **total** | **≈ 37 min per minute of video**, peak GPU memory 7.9 GB |

HaWoR is almost all of it; with `--input_npz` there is no SLAM. OmniEgoCap alone (`bench_latency.py`, model time):
3.3 s for 10 s, 5.0 s for 60 s, 18.2 s for 120 s of video. Qwen3-VL-2B needs ~4 GB and DAM-3B ~7 GB of VRAM: they run
after SLAM, never alongside it, and DAM runs SAM 2 for all windows before loading itself.

## Known limits

* **Focal length decides whether SLAM works.** With HaWoR's 600 px default on the OmniEgoDB outdoor clip (true focal
  930 px) SLAM read 30 s of walking as 1.7 m and the camera as tilted up 55°; the body then drifted and flipped.
  OmniEgoCap only turns the head path into a body: a wrong path gives a wrong body.
* **The floor fit needs floor.** It takes the plane with the most SLAM points that the camera sits 0.9–2.2 m above;
  `calibration.json` warns when the camera ends up outside 1.2–2.0 m above it.
* **Fingers** come from HaWoR only where a hand was detected, and stay flat elsewhere.
* **Offline.** OmniEgoCap is a non-causal sequence model (every frame sees ±2.1 s).
* **Accuracy.** The paper reports 111.7 mm mean joint error on its GoPro track. Legs and feet are inferred, not seen.
* **Licenses.** OmniEgoCap's checkpoint is CC BY-NC 4.0; SMPL-H, MANO, OmniEgoDB and DAM's weights are non-commercial.
  Fine for a hackathon demo, not for a product. None of them are in this repository.

## Next ideas

* **Music**: [ReccoBeats](https://reccobeats.com/docs/apis/get-recommendation)' recommendation endpoint takes seed
  tracks plus target `tempo`, `energy`, `valence`, `danceability`. Step cadence from `pose_timeseries.csv` gives the
  tempo, movement speed the energy, the narration the context.
* **Phone tracking**: ARKit / ARCore record metric, gravity-aligned camera poses with the video; importing them would
  replace SLAM, Metric3D and the floor fit.
