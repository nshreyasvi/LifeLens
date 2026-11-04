# LifeLens

[![Release](https://img.shields.io/badge/release-demos--v1-0866FF?style=flat-square&logo=github)](https://github.com/nshreyasvi/LifeLens/releases/tag/demos-v1)
[![Python](https://img.shields.io/badge/python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](#1-set-up-linux-or-wsl2-nvidia-gpu-with-8-gb-cuda-126)
[![CUDA](https://img.shields.io/badge/CUDA-12.6-76B900?style=flat-square&logo=nvidia&logoColor=white)](#1-set-up-linux-or-wsl2-nvidia-gpu-with-8-gb-cuda-126)
[![Vite](https://img.shields.io/badge/frontend-Vite_6_%7C_Vanilla_JS-646CFF?style=flat-square&logo=vite&logoColor=white)](#front-end-lifelens-live-panel)
[![Meta AI](https://img.shields.io/badge/Meta_AI-Muse_Spark_1.3_%7C_Llama_3.2-0467DF?style=flat-square&logo=meta&logoColor=white)](#director-stagesense)
[![3D Pose](https://img.shields.io/badge/3D_Motion-OmniEgoCap_+_HaWoR_(SMPL--H)-FF6F59?style=flat-square)](#how-the-end-to-end-workflow-operates)
[![Director Tests](https://img.shields.io/badge/tests-62_passed-2EA44F?style=flat-square&logo=pytest&logoColor=white)](director/TESTING.md)
[![Dataset & Weights](https://img.shields.io/badge/weights_%26_data-CC_BY--NC_4.0-6E7681?style=flat-square)](#licenses)

A head-mounted **phone, smart glasses, or GoPro** video goes in. The wearer's whole body comes out in 3D—even though the camera never sees it—together with what they do, how they move over the day, and live stage lighting and music cues driven by their movement.

![The 3D body sits down on a chair (not drawn) and stands up again; the pose graph underneath scrolls with it](docs/robothome_sit.gif)

*The `robothome` demo, 11–26 s: the wearer sits down on a chair and gets up. Body reconstructed from the head camera
alone. Graph underneath, left to right: knee, hip and elbow flexion (left / right), trunk lean, walking speed.
Full videos: [`examples/*/mesh_exo.mp4`](examples). The camera half of the side-by-side video is left out: the
dataset's footage can't be redistributed.*

| Output | What it is |
|---|---|
| **3D motion** | SMPL-H body with 30 articulated finger joints, 30 fps, as `.npy` / `.csv` / AMASS `.npz` |
| **Side-by-side video** | camera \| 3D body, live pose graph underneath |
| **Descriptions** | every 5 s: Qwen3-VL-2B narrates the activity; optionally Describe Anything describes a region |
| **Activity insights** | posture per second, time split, breaks, and daily routine coaching (Qwen3-VL + Meta Muse Spark) |
| **Live stage & music** | WebSocket director (`FastLoop` + `SlowLoop`) driving 6 virtual room lights, BPM tempo, and ReccoBeats/Spotify tracks |

![Posture per second over the three demo clips: mostly standing (gray) and walking (green), with sitting, bending and arms-raised bouts](examples/day/activity.png)

*Posture per second over the three demos ([`examples/day/insights.md`](examples/day/insights.md)), from fixed
thresholds on the reconstructed body. It matches the posture in the motion capture in 96% of 5 s windows (measured
on these same clips, which the sitting rule was tuned on).*

**Try it without installing:** [`examples/`](examples) holds the outputs of the three demos (`office`, `outdoor`,
`robothome`, and `day`, a report over all three), also as zips in
[Releases → demos-v1](https://github.com/nshreyasvi/LifeLens/releases/tag/demos-v1).

---

## How the End-to-End Workflow Operates

LifeLens is organized into **three connected layers**:
1. **3D Body & Activity Pipeline (`pipeline/`)** — Reconstructs 3D full-body + finger kinematics, renders videos, narrates 5 s windows, and classifies second-by-second posture.
2. **StageSense Director (`director/`)** — Replays or streams processed kinematics through a dual-speed architecture (**Fast Loop** for sub-30 ms reactive lighting + **Slow Loop** powered by **Meta Muse Spark 1.3** or **Llama 3.2 3B** for mood, tempo, and routine coaching).
3. **LifeLens Live Panel (`index.html`, `src/`)** — A Vite web application with **Activity**, **Stage**, and **Day** views that visualizes the 3D body, live director cues, reactive room lights, ReccoBeats/Spotify music recommendations, and multi-clip daily posture timelines.

```mermaid
flowchart TD
  subgraph P["1. Egocentric 3D Body & Routine Pipeline (pipeline/)"]
    V[/Head-mounted POV video/] --> ING[Ingest<br/>30 fps CFR, <=1920 px]
    ING --> H[HaWoR<br/>3D wrists, 30 finger joints,<br/>chunked SLAM camera path]
    H --> F[Floor fit & Calibration<br/>RANSAC ground plane,<br/>gravity +Z up, cam height]
    F --> O[OmniEgoCap + Finger Splice<br/>head + wrists -> 52-joint<br/>SMPL-H 3D body mesh]
    O --> R[Render & Kinematics<br/>side_by_side.mp4, mesh_exo.mp4,<br/>pose_timeseries.csv, joints_world.csv]
    ING --> Q[Qwen3-VL-2B<br/>5 s activity narration]
    ING & R -.-> D[Describe Anything DAM<br/>optional ego / body region captioning]
    R & Q --> I[Insights Engine<br/>per-second posture labels,<br/>activity.csv, insights.json]
  end

  subgraph DIR["2. StageSense AI Director (director/)"]
    R & I --> REP[Clip Replay & 3-Zone Floor K-Means]
    REP --> FL[Fast Loop <30 ms<br/>pelvis speed -> brightness, zone color,<br/>speed-jump flash, freeze blackout]
    REP --> SL[Slow Loop ~6 s<br/>Meta Muse Spark 1.3 / Llama 3.2 3B<br/>-> mood, clamped BPM tempo, scene]
    I --> RT[Routine Tips<br/>Meta Muse Spark 1.3<br/>multi-day coaching]
    FL & SL --> WS([WebSocket Server<br/>ws://127.0.0.1:8765])
  end

  subgraph UI["3. LifeLens Live Panel (src/ + index.html)"]
    WS --> ACT[Activity View<br/>synced 3D body video,<br/>energy meter, cue timeline]
    WS --> STG[Stage View<br/>6 reactive room lights,<br/>BPM beat meter, ReccoBeats + Spotify]
    I & RT --> DAY[Day View<br/>posture bars, 1 s interactive<br/>scrubber, AI routine suggestions]
  end
```

### Stage-by-Stage Pipeline Breakdown (`pipeline/run.py`)

When you run `python pipeline/run.py <video> <run_name>`, each stage writes to `runs/<run_name>/` and is automatically skipped on re-runs if its target output file already exists:

1. **Ingest (`input.mp4`)**: Transcodes the raw input video via `ffmpeg` to a constant 30 fps, `<=1920` px width, `yuv420p` working video (or slices exact frames matching `raw_time_s` when `--input_npz` is supplied).
2. **Hand & SLAM Tracking ([`pipeline/hawor_export.py`](pipeline/hawor_export.py) → `wrist.npz`, `slam.npz`)**: Runs [HaWoR](https://github.com/ThunderVVV/HaWoR) to detect 3D left/right wrists and 15-joint MANO finger rotations (`hand_pose` `(N, 90)`), and runs chunked DROID-SLAM (`hawor_slam`) stitched via Umeyama similarity alignment to recover the 6-DoF camera trajectory.
3. **Floor Plane & Gravity Alignment ([`pipeline/build_input.py`](pipeline/build_input.py) → `omniegocap_input.npz`, `calibration.json`)**: Fits a RANSAC ground plane to the SLAM point cloud so world $+Z$ points opposite gravity with the floor at $z = 0$, validating that the head camera sits 0.9–2.2 m above the floor.
4. **Full-Body 3D Reconstruction ([`pipeline/run_omniegocap.py`](pipeline/run_omniegocap.py) → `smplh_canonical.npz`, `smplh.npz`, `kinematics/`)**: Runs [OmniEgoCap](https://github.com/KyungWonCho/OmniEgoCap) to infer the 22-joint full-body trajectory from head + wrist motion (legs are a learned plausible estimate, not directly observed), applies Gaussian smoothing (`--smooth 2.0`), and splices in HaWoR's 30 finger joints (interpolating gaps $\le 0.5\text{ s}$ and easing longer gaps toward the clip mean).
5. **3D Mesh & Pose Graph Rendering ([`pipeline/render.py`](pipeline/render.py) → `side_by_side.mp4`, `mesh_exo.mp4`, `pose_timeseries.csv`)**: Renders the 3D SMPL-H body from a smooth exocentric camera on a 0.5 m checkerboard floor alongside a scrolling biomechanical telemetry graph (left/right knee, hip, and elbow flexion, trunk lean, and walking speed).
6. **Video Description ([`pipeline/describe.py`](pipeline/describe.py) & [`pipeline/describe_anything.py`](pipeline/describe_anything.py) → `narration.json`, `dam_*.json`)**: Runs `Qwen3-VL-2B-Instruct` over 5 s windows (8 frames/window) to narrate what the wearer is doing (`--describe qwen`, default), and optionally runs NVIDIA `DAM-3B-Video` + SAM 2.1 (`--describe dam`) on the ego view, 3D body render, and composite view.
7. **Posture & Daily Insights ([`pipeline/insights.py`](pipeline/insights.py) & [`director/routine_tips.py`](director/routine_tips.py) → `activity.csv`, `activity.png`, `insights.json`, `insights.md`)**: Applies biomechanical rules normalized by the wearer's leg length to label every second (`walking`, `standing`, `sitting`, `crouching`, `bending`, `arms raised`), pairs posture bouts with Qwen narrations, and generates routine coaching via Qwen3-VL-2B and **Meta Muse Spark 1.3**.

## 1. Set up (Linux or WSL2, NVIDIA GPU with 8 GB, CUDA 12.6)

```bash
bash setup.sh          # conda envs omniegocap, hawor, mhr, vlm: pinned upstream commits, weights, HaWoR patch
bash setup.sh dam      # optional: Describe Anything + SAM 2.1 (NVIDIA non-commercial license)
```

Then add the licensed body models (free registration at https://mano.is.tue.mpg.de):

| Download | Put it at |
|---|---|
| SMPL-H "Extended SMPL+H model" `smplh.tar.xz` | `tar -xJf smplh.tar.xz -O neutral/model.npz > third_party/OmniEgoCap/data/smplh/SMPLH_NEUTRAL.npz` |
| MANO `mano_v1_2.zip`: `models/MANO_RIGHT.pkl` | `third_party/HaWoR/_DATA/data/mano/` |
| MANO `mano_v1_2.zip`: `models/MANO_LEFT.pkl` | `third_party/HaWoR/_DATA/data_left/mano_left/` |

Check the install: `conda activate omniegocap && python bench/smoke_test.py` (a synthetic walk through every stage).

## 2. Run

```bash
conda activate omniegocap
python pipeline/run.py my_walk.mov my_walk                    # → runs/my_walk/
```

| Flag | Meaning |
|---|---|
| `--focal F` | focal length in pixels of the ≤1920 px working video. If omitted, read from an iPhone video's lens metadata (tested on synthetic files only so far) |
| `--describe qwen dam` | description model(s): `qwen` (default, activity narration, ~1 s per 5 s of video), `dam` (Describe Anything on the camera view, the body and both, ~2 min per 5 s), `none`. Compared under [Which description model?](#which-description-model) |
| `--smooth S` | body smoothing in frames (default 2); `0` = OmniEgoCap's raw output, as in the paper |
| `--input_npz F` | a ready OmniEgoCap input (e.g. OmniEgoDB's `input.npz`): no SLAM, HaWoR only for the fingers |
| `--opt` | OmniEgoCap's wrist optimization: same body error, 71% more jerk, 2–3× slower (paper, Table 3) |

Each stage is skipped when its output exists; delete the file to redo it. A day of clips gets one report:
`python pipeline/insights.py runs/morning runs/lunch runs/afternoon --out runs/day`.

## 3. Record your own video

* The camera must be **rigid with the head** (head strap or cap mount); chest or handheld footage won't work.
* Landscape, 1× or 0.5× lens, 30 or 60 fps. GoPro: Linear lens, HyperSmooth and Horizon Leveling off.
* Tilt it 20–30° down so the hands are in view, and keep some floor in view.
* Stand still and look ahead for the first 3 s.
* **Focal length** matters most: a wrong one makes SLAM fail and the body drift. Recent iPhones store it in the video,
  and the pipeline reads it (check the `== focal:` line it prints). For other
  cameras pass `--focal 960/tan(hfov/2)` for a lens with horizontal field of view `hfov` (1920 px working width).
* Keep clips under 2 min (OmniEgoCap slows down sharply beyond that); record several for a day.

## 4. Replicate the demos and the accuracy numbers

The demos are OmniEgoDB clips from a head-mounted GoPro HERO10 Black (3840×2160, ~92° horizontal view, nearly no
distortion; the pipeline works on 1920×1080 at 30 fps). Accept the
[OmniEgoDB](https://huggingface.co/datasets/cscandkswon/OmniEgoDB) terms on Hugging Face, put the three videos in this
folder as `S03_office_1.MP4`, `S03_robothome_1.MP4`, `S04_outdoor_1.MP4`, then:

```bash
for s in S03_office_1 S03_robothome_1 S04_outdoor_1; do
  hf download cscandkswon/OmniEgoDB --repo-type dataset --local-dir omniegodb \
    --include "gopro/$s/input.npz" "gopro/$s/camera.json" "gopro/$s/gt.npz"
done
bash demos.sh            # runs/office, runs/outdoor, runs/robothome: ~2 h, +4 h for DAM (drop `dam` in demos.sh)
mkdir -p preds/gopro && for p in office:S03_office_1 outdoor:S04_outdoor_1 robothome:S03_robothome_1; do
  cp runs/${p%%:*}/smplh.npz preds/gopro/${p#*:}.npz; done
python third_party/OmniEgoCap/scripts/eval.py omniegodb --root omniegodb --track gopro --pred_dir preds/gopro \
    --per_capture --device cpu
```

To see a release demo with its footage without recomputing HaWoR: unzip it into `runs/<name>/` and run the matching
`demos.sh` line. Only OmniEgoCap and the render run again (minutes).

## Outputs: `runs/<name>/`

| File | Content |
|---|---|
| `side_by_side.mp4` | camera \| 3D body, pose graph underneath (knee, hip, elbow flexion, trunk lean, speed) |
| `mesh_exo.mp4`, `pose_graph.mp4` | the body and the graph alone; frame *i* = `input.mp4` frame *i*, 30 fps |
| `kinematics/joints_world.csv` / `.npy` | (L, 22, 3) joint positions, meters, z up, floor at z = 0 |
| `kinematics/joint_rotations.csv` / `.npy` | (L, 52, 3) SMPL-H axis-angle: root, 21 body joints, 30 finger joints |
| `kinematics/root_trans.npy`, `betas.npy`, `time_s.npy` | root translation, body shape, frame times |
| `pose_timeseries.csv` | the graph's angles (deg), pelvis height (m), walking speed (m/s) per frame |
| `narration.json` / `.srt` | Qwen: one sentence per 5 s (load the `.srt` as subtitles) |
| `dam_ego/pose/both.json` / `.srt` | Describe Anything per 5 s (`--describe dam`) |
| `insights.md`, `insights.json`, `activity.csv`, `activity.png` | posture per second with narration, time split, summary |
| `smplh.npz` | AMASS SMPL-H layout (with fingers), for Blender / AMASS tools and OmniEgoCap's viewer and evaluator |
| `calibration.json` | own-video mode: floor fit and camera height. **Check it first** when the body looks wrong |
| `manifest.json` | file index and per-stage timings |

## Results (RTX 4060 Laptop 8 GB)

Pose error against OmniEgoDB's Xsens motion capture, OmniEgoCap's evaluator, 13,737 frames, in `--input_npz` mode
(the authors' camera path and wrists; own-video mode, with our SLAM, is not measured):

| | office | robothome | outdoor | all three | paper (20 seq.) |
|---|---|---|---|---|---|
| MPJPE (mm), smoothed (default) | 93.9 | 105.6 | 101.7 | **102.6** | 111.7 |
| MPJPE (mm), raw (`--smooth 0`) | 94.2 | 105.8 | 102.8 | 103.0 | |
| Hand error (mm), smoothed / raw | 159 / 160 | 135 / 136 | 110 / 115 | **134.0** / 135.7 | 166.2 |
| Jerk (km/s³), smoothed / raw | 0.02 / 0.07 | 0.01 / 0.07 | 0.03 / 0.08 | **0.016** / 0.075 | 0.073 |

Three of the paper's 20 sequences: this checks the pipeline, it does not rank it. Smoothing removes OmniEgoCap's
frame-to-frame shake without costing accuracy.

Speed, in processing seconds per video second: **11–16** with `--input_npz` (HaWoR's hand model is ~75% of it),
**~37** for own videos (SLAM on top). OmniEgoCap needs 26 s for 83 s of video but over 700 s for 270 s. Qwen narration
adds ~0.2, Describe Anything ~30 for its three inputs (~40 s per description).

### Which description model?

Every 5 s window of the three demos (92 windows) was described by Qwen and by Describe Anything (DAM) on three inputs,
then checked against the posture the motion capture shows in that window: `python bench/compare_descriptions.py`.

| | Qwen narration | DAM, camera view | DAM, 3D body | DAM, both | our posture labels | always "standing" |
|---|---|---|---|---|---|---|
| names the right posture (the first one it names) | 33% | 18% | 74% | 45% | **96%** | 63% |
| names any posture | 48% | 39% | 100% | 84% | 100% | 100% |
| names an activity (open, pour, pick up…) | 57% | 33% | 51% | 29% | – | – |
| describes looks (colour, material, shape) | 18% | 99% | 62% | 97% | – | – |
| same postures when run again | – | 65% | 59% | 63% | – | – |
| words, time per description | 8, ~1 s | 55, ~40 s | 55, ~40 s | 55, ~40 s | – | – |

What they say about the same moment (first words):

| Moment (motion capture) | Qwen | DAM, camera view | DAM, 3D body | DAM, both |
|---|---|---|---|---|
| office 30 s (standing) | The camera wearer turns on the water dispenser. | A light-colored wooden desk with a smooth, polished surface… | A humanoid figure… stands upright with a slight forward lean… | A sleek, modern microwave with a smooth, reflective surface… |
| robothome 130 s (sitting) | The camera wearer is sitting on a couch. | A smooth, light gray surface, likely a mat… | A slender, bald figure is depicted in a seated position… | A small, white, humanoid figure is depicted in a seated position… |
| robothome 210 s (standing) | The camera wearer is adjusting a wooden board. | A person is wearing a black jacket with a distinctive white stripe… | A humanoid figure… stands with a relaxed posture… | A person is lying down, wearing a black jacket… |

* **Qwen** is the only one that says what the wearer *does*, and it is 40× faster. It names a posture in half the
  windows and gets a third of those wrong ("walks around a room" while standing).
* **DAM on the 3D body** puts the body's posture into words. It cannot know more than the body it looks at, and is
  less right (74%) than the labels computed from that same body (96%), and less consistent: run again, it names
  other postures in 41% of the windows.
* **DAM on the camera view** describes how whatever lies under a fixed point in the image looks (a desk, a mat, the
  wearer's sleeve). It says next to nothing about the wearer's posture.
* **DAM on both** mixes the two and makes things up ("a person is lying down" while the wearer stands).

So: Qwen (the default) for activity, the posture labels for posture. DAM is there to compare, not needed.

How far to trust this: 92 windows from 3 clips, and neighbouring windows are not independent, so differences of
~10 points or less are noise. Most windows are "standing", hence the always-"standing" row. The reference posture
comes from fixed rules on the motion-capture skeleton, not from people labelling the video, and a window counts as its
majority posture: a 2 s walk inside a 5 s window counts as standing (6 of Qwen's 14 wrong postures are such windows;
in the other 8 the wearer doesn't walk at all). A description
"names" a posture or activity when it contains one of the script's keywords, so paraphrases are missed. Between the
two DAM runs the body renders also changed slightly (smoothing, floor lift), so "run again" is not pure sampling noise.

## Limits

* **Fingers** come from HaWoR where it detects a hand (24–46% of frames in the demos); gaps up to 0.5 s are
  interpolated, longer ones ease to the clip's average hand.
* **Legs** are inferred from head and wrist motion, not seen. OmniEgoCap is offline (each frame sees ±2.1 s).
* **Uneven ground** breaks OmniEgoCap's flat-floor assumption: outdoors, standing on lower ground reads as bent knees
  (knees > 40° while the wearer stands straight in 8% of the outdoor frames; under 0.2% indoors).
* **Feet sink into the floor** by 2–4 cm in OmniEgoCap's output (up to 20 cm outdoors, where the ground isn't flat).
  The video lifts the drawn body onto the floor; the exported motion keeps the predicted heights, because lifting it
  also moves the camera-pinned head (MPJPE 102.6 → 107.2 mm on the demos).
* **Floor fit** (own videos) needs floor in view; `calibration.json` warns when the camera ends up < 1.2 or > 2.0 m
  above it.
* **Insights** labels come from fixed thresholds on the body pose (see `pipeline/insights.py`). The reconstructed
  knees bend too far when the wearer sits, so a low posture held 8 s or longer counts as sitting, never crouching; a
  long real crouch will read as sitting. The summary is a 2B model's reading of the labels, not advice, and it mixes
  up numbers (the demo day report gives the day's 149 m walked as one walk).

## Front-end: LifeLens Live Panel

The interactive web interface runs on **Vite** (`index.html`, `src/main.js`, `src/day.js`, `src/extras.js`, `src/media.js`, `src/styles.css`, `src/day.css`, `src/extras.css`). See [`NODE-FRONTEND.md`](NODE-FRONTEND.md) for build details.

- **Run it:**
  ```sh
  npm install
  npm run dev     # opens http://localhost:8000 (legacy plain-HTML copy remains in legacy/)
  ```
- **Three Views:**
  - **Activity Tab:** Plays the 3D body video (`public/video/office-body.mp4`) time-synced to the director (`src/extras.js`), alongside a live energy meter (`low` / `medium` / `high`) and scrolling director cue log.
  - **Stage Tab:** Simulates 6 smart room/stage lights (`Living room`, `Kitchen`, `Desk`, `Hallway`, `Bedroom`, `Porch`) whose brightness and color follow performer energy, speed-jump flashes, and freeze blackouts; includes a live BPM beat indicator and dynamic song recommendations via **ReccoBeats** with embedded **Spotify** track players (`src/main.js`).
  - **Day Tab (`src/day.js`):** Reads `public/day/insights.json` and `public/day/activity.csv` to display whole-day and per-clip posture breakdowns, an interactive second-by-second scrubbable posture strip across `office`, `outdoor`, and `robothome`, and AI routine suggestions.
- **Connection modes:** Automatically connects to the StageSense Director at `ws://127.0.0.1:8765` (**Live** badge, retrying every 5 s); when no director is running, falls back to `public/sample-data.json` (**Demo** badge).
- **Models & Privacy:** No API keys or model calls reside in the browser. The AI badge reflects the state of the director's slow loop (**Meta Muse Spark 1.3** or **Llama 3.2 3B**).

**Screenshots and demo video (Avi)**

![Activity screen](docs/avi-activity.png)
![Stage screen](docs/avi-stage.png)

Short screen recording of the demo running on the Activity screen: [docs/avi-demo.mp4](docs/avi-demo.mp4)

## Director (StageSense)

The director ([`director/server.py`](director/server.py)) reads `pose_timeseries.csv`, `activity.csv`, and `kinematics/joints_world.csv` from a processed LifeLens clip and streams JSON stage & music cues over `ws://127.0.0.1:8765` to the front-end.

- **Dual-loop architecture:**
  - **Fast loop ([`director/fast_loop.py`](director/fast_loop.py), <30 ms/frame):** Maps pelvis speed and deterministic 3-zone floor `k-means` (`A`, `B`, `C`) to light intensity and zone color, triggers a white **flash** on sudden pelvis speed jumps ($\ge 0.5\text{ m/s}$ and $\ge 0.3\text{ m/s}$ above the prior 4 s mean), and pre-arms a **dim** $\to$ **blackout** when the wearer freezes (`StubPredictor` / `AnticipationWebSocketPredictor`).
  - **Slow loop ([`director/slow_loop.py`](director/slow_loop.py), every ~6 s):** Sends a compact (<80-word) biomechanical + narration summary to **Meta Muse Spark 1.3** (Meta Model API) or local **Llama 3.2 3B** (via Ollama) to update semantic `mood`, clamped `music_tempo` (bounded to the mood's BPM range in [`director/music_map.py`](director/music_map.py) and $\le 10\text{ BPM}$ change per step), and base color.
  - Muse reasoning effort is set with `MUSE_REASONING` (low/medium/high). In a 40-call benchmark on 5 real director prompts, low averaged 8.4 s vs 16.0 s at default, with 10/10 valid replies; the director clamps tempo to the mood's range.
- **Daily Routine Coaching with Meta Muse Spark ([`director/routine_tips.py`](director/routine_tips.py)):**
  ```sh
  python -m director.routine_tips public/day --history public/day/history.json
  ```
  Reads `<day>/insights.json` and optional multi-day history (`public/day/history.json`), queries **Meta Muse Spark**, and writes 3 concrete, data-grounded routine suggestions back into `insights.json`.
- **Run the live director from the repository root:**

  ```sh
  MODEL_PROVIDER=muse director/venv/bin/python -m director.server examples/office --start 42 --describe qwen
  ```

  This replays `office` from 42 s to the clip's end (83 s). The slow loop asks for a new mood every 6 s but waits for the previous reply; Muse replies took 9–22 s in two runs, so expect about 3 mood/tempo updates, the first 14–22 s in; the last can land after the final frame and arrives with the end message.
  Then run `npm run dev` and use **Live** mode in the front-end.
  Offline: use `MODEL_PROVIDER=ollama` (replies take about 2 s).
- **Message format:** JSON fields are `id`, `time`, `energy`, `action`, `music_tempo`, `phase`, `cue`, `intensity`, `color`, `zone`, `mood`, `source`, `reason`, `log`, `speed`, `posture_label`, `prediction_event`, `prediction_prob`, `scene`, `stem`, `shader`, `model_summary`, and `model_decision`. Example message:

  ```json
  {"id":1,"time":"0:00:42.000","energy":"medium","action":"dim","music_tempo":90,"phase":"set","cue":"dim","intensity":0.04,"color":"#3977FF","zone":"A","mood":"curious","source":"fast","reason":"Energy is medium; the level follows the performer.","log":"Energy is medium; the level follows the performer.","speed":0.4,"posture_label":"walking","prediction_event":"none","prediction_prob":0.0,"scene":"wash","stem":"ambient","shader":"soft_glow","model_summary":"","model_decision":"Holding a calm starting scene."}
  ```

- **Checklist:**
  - [x] Reactive flash
  - [x] Blackout on freeze
  - [x] Tempo from slow loop
  - [x] Meta Muse Spark daily routine tips (`director/routine_tips.py`)
  - [ ] Run on the real daily-routine recording
  - [ ] Swap the stand-in predictor for the real freeze model
- **Footnotes:** flashes use pelvis walking speed and can miss upper-body movement; replay smoothing can make them appear about 0.25 s early. The freeze predictor is a stand-in and the camera is not live. Tempo stays inside the chosen mood's range from `music_map.py` and moves at most 10 BPM per update. See [director/README.md](director/README.md) and [director/TESTING.md](director/TESTING.md) (62 passing unit tests) for details.

**Live run on `examples/office` (Muse, `--start 42`)**

![Director live on the Stage page](director/docs/director-live.png)

## Team checklist

- [x] Front-end on `main` (PR #2, merged)
- [x] Front-end README section (PR #3)
- [x] Front-end screenshots and a short screen recording
- [x] Node.js / Vite front-end (`index.html`, `src/`, `vite.config.js`)
- [x] Synchronized 3D body video & media switcher (`src/extras.js`, `src/media.js`)
- [x] Music recommendations (ReccoBeats) & embedded Spotify playback (`src/main.js`)
- [x] Daily routine analytics view (`src/day.js` + `director/routine_tips.py`)
- [ ] 3-minute demo video
- [ ] Final submission (Nov 4, 9 PM ET)

## Footnotes

1. Live mode needs the director running on `ws://127.0.0.1:8765`. Without it, the page shows sample data.
2. Lights: any brightness above 0 shows at least 25%. Brightness 0 is fully off (blackout).
3. The office clip produces 6 flashes; 4 fall in the 42–72 s demo window.
4. The director's slow loop uses Muse Spark and Llama. The front-end calls no models itself.

## Licenses

No license is set for this code yet. Not included and non-commercial: OmniEgoCap's checkpoint (CC BY-NC 4.0), SMPL-H and MANO,
OmniEgoDB (CC BY-NC, gated), Describe Anything's weights. Fine for research and demos, not for a product. The release
demos are derived from OmniEgoDB and inherit CC BY-NC.
