# LifeLens

A head-mounted **phone or GoPro** video goes in. Out come:

* the wearer's **full-body 3D motion** (SMPL-H, fingers included) as `.npy` / `.csv`
* a **side-by-side video**: camera | 3D body, with a live pose graph underneath
* a **narration** of what the wearer does every 5 s (Qwen3-VL-2B) and, optionally, region descriptions (Describe Anything)
* **activity insights**: posture per second (walking, standing, sitting, crouching, bending, arms raised), time split,
  breaks, and a short summary with schedule and posture suggestions

**Example outputs** (the three OmniEgoDB demos, without the dataset's camera footage): [`examples/`](examples)
(`office`, `outdoor`, `robothome`, and `day`, a report over all three), also as zips in
[Releases → demos-v1](https://github.com/nshreyasvi/LifeLens/releases/tag/demos-v1). Start with
`examples/office/mesh_exo.mp4` and `examples/day/insights.md`.

```
video → ingest → hawor → build_input → omniegocap → render → describe → insights
        30 fps   hands +  floor plane   head + wrists  3D body   Qwen /    posture timeline,
                 SLAM     → z up        → SMPL-H       + graph   DAM       LLM summary
```

[HaWoR](https://github.com/ThunderVVV/HaWoR) finds the hands and the camera path in the video,
[OmniEgoCap](https://github.com/KyungWonCho/OmniEgoCap) turns head + wrist motion into a full body.

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
| `--focal F` | focal length in pixels of the ≤1920 px working video. iPhone videos: read from the file automatically |
| `--describe qwen dam` | description model(s): `qwen` (default, activity narration, ~1 s per 5 s), `dam` (Describe Anything on the camera view, the body and both, ~30 s per 5 s), `none` |
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
* **Focal length** matters most: a wrong one makes SLAM fail and the body drift. iPhone files carry it. For other
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
bash demos.sh            # runs/office, runs/outdoor, runs/robothome: ~2 h, +3 h for DAM (drop `dam` in demos.sh)
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

Pose error against OmniEgoDB's Xsens motion capture, OmniEgoCap's evaluator, 13,737 frames:

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
adds ~0.2, Describe Anything 16–31.

**Qwen or Describe Anything?** Qwen says what the wearer does ("opens the refrigerator"). DAM describes how a masked
region looks: on the camera view whatever lies under a fixed point (carpet, desk), on the rendered body the posture
("walks forward, right arm swinging"). Use Qwen for activity, DAM on the body only for posture in words.

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
* **Insights** labels come from fixed thresholds on the body pose (see `pipeline/insights.py`); the summary is a 2B
  model's reading of them, not advice.

## Licenses

No license is set for this code yet. Not included and non-commercial: OmniEgoCap's checkpoint (CC BY-NC 4.0), SMPL-H and MANO,
OmniEgoDB (CC BY-NC, gated), Describe Anything's weights. Fine for research and demos, not for a product. The release
demos are derived from OmniEgoDB and inherit CC BY-NC.
