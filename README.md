<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-wordmark-on-dark.svg">
    <img alt="LifeLens" src="docs/brand/logo-wordmark.svg" width="360">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/nshreyasvi/LifeLens/releases/tag/demos-v1"><img alt="Release" src="https://img.shields.io/badge/release-demos--v1-2B44E8?style=flat-square&logo=github"></a>
  <a href="#quick-start"><img alt="Vite" src="https://img.shields.io/badge/app-Vite_6_%C2%B7_vanilla_JS-2B44E8?style=flat-square&logo=vite&logoColor=white"></a>
  <a href="#where-every-result-comes-from"><img alt="Meta Muse Spark" src="https://img.shields.io/badge/Meta-Muse_Spark_1.3-0467DF?style=flat-square&logo=meta&logoColor=white"></a>
  <a href="#how-it-works"><img alt="3D body" src="https://img.shields.io/badge/3D_body-OmniEgoCap_%2B_HaWoR-C83E1B?style=flat-square"></a>
  <a href="#music-and-stage"><img alt="Music" src="https://img.shields.io/badge/music-ReccoBeats_%C2%B7_Spotify-1DB954?style=flat-square&logo=spotify&logoColor=white"></a>
  <br>
  <a href="#platforms"><img alt="CUDA" src="https://img.shields.io/badge/CUDA-12.6-76B900?style=flat-square&logo=nvidia&logoColor=white"></a>
  <a href="#platforms"><img alt="Apple MPS" src="https://img.shields.io/badge/Apple_MPS-partial-555555?style=flat-square&logo=apple&logoColor=white"></a>
  <a href="#process-your-own-video"><img alt="Python" src="https://img.shields.io/badge/python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white"></a>
  <a href="#licenses"><img alt="License" src="https://img.shields.io/badge/weights_%26_data-CC_BY--NC_4.0-57554F?style=flat-square"></a>
</p>

LifeLens takes a video from a camera on your head (a phone on a strap, a GoPro or smart glasses) and rebuilds your
whole body in 3D, even though the camera never sees most of it. From that body and the video it tells you what you
did, how you moved and what you could change, counts your reps, and drives music and stage lights from your movement.

[![LifeLens demo: the head-camera POV with the 3D body window beside it, then the Routine, Music and Stage tabs](docs/demo.gif)](docs/demo.mp4)

*The demo at 2× speed ([full video, 94 s](docs/demo.mp4)), on the `office` recording.*
- *The head-camera POV fills the main window, with the 3D body window beside it (closed and reopened) and the
  kinematics underneath. Play starts the director live.*
- *Routine: icon tiles and a posture donut, the timeline (Muse's activities, numbered changes, posture, walking
  speed), the film strip, the Muse review, past routines and "vs. past" bars.*
- *Music picks songs from the body; Stage plays the Stagify plan and the Show view (the 3D body on a virtual stage).*
- *Gym: Gymify on office, where Muse Spark sees no exercise, so it counts no reps.*

> **POV footage:** [OmniEgoDB](https://huggingface.co/datasets/cscandkswon/OmniEgoDB), sequence `S03_office_1`,
> CC BY-NC 4.0, shown here for non-commercial research. The person in it can ask for removal
> (cscandkswon@snu.ac.kr), and the video will then be replaced. Cho, Na, Joo, *OmniEgoCap: Device-Agnostic
> Sequence-Level Egocentric Motion Reconstruction*, NeurIPS 2026.

**Contents:** [Quick start](#quick-start) · [Using the app](#using-the-app) ·
[Recording a good video](#recording-a-good-video) · [Cameras and calibration](#cameras-and-calibration) ·
[Process your own video](#process-your-own-video) · [How it works](#how-it-works) ·
[Where every result comes from](#where-every-result-comes-from) · [Music and stage](#music-and-stage) ·
[Gym](#gym-gymify) · [Stagify](#stagify) · [Platforms](#platforms) · [Results](#results-rtx-4060-laptop-8-gb) ·
[Limits](#limits) · [Licenses](#licenses)

## What you get

| From | You get | Made by |
|---|---|---|
| The head-camera video | Your 3D body (with 30 finger joints, 30 fps) and its joint angles | HaWoR (hands, camera path) → OmniEgoCap (body) |
| The video, every 5 s | A caption of what you are doing | Meta Muse Spark, from 3 frames |
| The 3D body and the head camera, every 5 s | A posture label | Meta Muse Spark, from the two frames |
| The 3D body, every second | Posture: walking, standing, sitting, crouching, bending, arms raised | Fixed rules on the body (below) |
| All of the above + 8 3D body frames | A review: what you did, what to change and why, compared with your other recordings | Meta Muse Spark |
| **Gymify:** the 3D body's reps | The exercise, reps, sets and rests, range of motion, tempo, left-right difference; form coaching; music to train to | Measured on the joints; Muse Spark names the exercise and coaches from 3D body frames |
| **Stagify:** the whole recording | A planned show: a scene every 10 s, songs per section, the show video and a lighting cue file | Muse Spark plans from each segment's numbers and a 3D body frame; ReccoBeats |
| The 3D body, live | Mood (every ~6 s), light level and flashes (every frame) | Director: Muse Spark + speed rules |
| The last 10 s of the body | 5 songs that fit your pace, rhythm and arm swing | ReccoBeats, Spotify |
| The body, every frame + Muse every 20–30 s | A stage show: 6 lights per body part, scenes with Muse's reason, sound effects on hits, jumps and turns, output to real lights | Rules + Muse Spark as lighting designer |

## Quick start

The app opens processed recordings without a GPU. Building a 3D body from a new video needs the pipeline and an
NVIDIA GPU ([Process your own video](#process-your-own-video)).

You need [Node.js](https://nodejs.org) 18 or newer, Python 3.10 or newer and, for the Muse Spark features, a Meta
Muse Spark API key.

```sh
git clone https://github.com/nshreyasvi/LifeLens.git && cd LifeLens
npm install
python -m venv director/venv
director/venv/bin/pip install -r director/requirements.txt     # Windows: director\venv\Scripts\pip
cp director/.env.example director/.env                          # then set MUSE_API_KEY=...
DIRECTOR_PYTHON=director/venv/bin/python npm run dev            # open http://localhost:8000
```

`director/.env` is gitignored and the browser never sees the key. Without it the director runs on its speed rules
only, and the app shows no mood or songs rather than made-up ones. With an empty key it falls back to a local Llama
3.2 through Ollama, when one is running. On Windows the dev server finds `director\venv\Scripts\python.exe` by itself.

## Using the app

**1. Start page.** Enter your name and, optionally, your **height**, **weight** and **age**. They are kept in your
browser.

| Field | What it changes |
|---|---|
| Height (cm) | The real size of your 3D body: the world is scaled so the camera sits at your height while you stand at the start ([why](#cameras-and-calibration)) |
| Weight (kg), age | Only Muse Spark's coaching (the routine review and Gymify), as "About the person: 178 cm, 75 kg, 30 years old". The 3D body model has no input for them |

**2. Pick a session.**
- **Open a recording.** Processed sessions open at once. Saved clips in `recordings/` show the camera list,
  **Process** and **Delete**; several can be queued, and each row shows its progress.
- **New live session.** Your camera becomes the POV, and every 6 s Muse Spark captions two frames and names your
  posture. Name the recording, pick the camera, **Record**, then **Stop**: the clip is saved, not processed.
  **Process now** (or later, from Open a recording) builds the 3D body, the music and the stage show. A live 3D body
  would need about 1–2 fps: an NVIDIA GPU with 16 GB of VRAM or more (RTX 4080/4090 class, estimated; an RTX 4060
  Laptop measured 0.3–0.8 fps).

**3. Play** starts the director on the open recording. The tabs:

| Tab | Shows |
|---|---|
| **Routine** | The POV, 3D body and kinematics; the camera the body was made with. Icon tiles and a posture donut. A timeline with Muse's activities, its changes as numbered pins, the posture strip and walking speed. A film strip, the Muse review, past routines and "vs. past" bars |
| **Music** | The body's features, the song targets and 5 songs, playing through one Spotify player |
| **Stage** | Lights per body part; Muse's scene; **Show view** (the 3D body on a virtual stage); **Stagify** |
| **Gym** | **Gymify**: the exercise, rep chart, sets and rests, range, tempo, symmetry, Muse's coaching and gym music |

## Recording a good video

The 3D body is only as good as what the camera gives it. These matter most:

1. **Stand upright and still for the first 3 s, looking ahead.** That window calibrates how the camera sits on your
   head (its tilt and roll) and, with your height, the size of the world. Walking off straight away makes the mount
   tilt less exact; starting seated can't be calibrated as standing.
2. **Keep your hands in view.** Wrist positions drive the arms, and the fingers come from the frames where a hand is
   seen. In our GoPro clips the wrists were visible 55–62% of the time while walking and 88–92% while eating.
3. **Keep some floor in view.** Tilt the camera 20–30° down. The floor sets "up" and the floor height; with no floor
   the run stops.
4. **Prefer a rectilinear lens.** On a GoPro use **Linear**: straight lines stay straight, and the GoPro's own
   field-of-view metadata gives the exact focal length. Wide and SuperView are fisheye and only approximated.
5. **Move, and keep it short.** SLAM needs motion to track the camera: walk around, and keep clips under 2 minutes.
6. **Enter your height and pick the right camera** before you press Process.

## Cameras and calibration

Pick the camera in the list (or `--camera` on the command line). Each preset sets the field of view, where the lens
sits on your head, and a lens correction:

| In the list | `--camera` | Field of view across | Lens from the head joint (x left, y up, z forward) | Lens correction |
|---|---|---|---|---|
| Phone on a head strap | `phone` | 69.4° (main 1× lens) | 0, 0.14, 0.13 m | none |
| GoPro, Linear lens | `gopro-linear` | 92° | 0, 0.16, 0.12 m | none |
| GoPro, Wide lens | `gopro-wide` | 116° after correction | 0, 0.16, 0.12 m | barrel, k1 −0.227, k2 −0.022 |
| Meta Ray-Ban glasses | `glasses` | 80° | 0.07, 0.06, 0.10 m | none |

The focal length comes from the first of: `--focal`; an iPhone's lens metadata; a GoPro's own metadata (lens mode and
diagonal field of view, used when it filmed in Linear); the preset. The app shows what was used next to each session,
for example "GoPro, Linear lens · 88° across · focal from the GoPro's metadata (95.4 deg diagonal)" (from
`runs/<name>/camera.json`).

**Scale.** The camera path's real size comes from Metric3D depth inside HaWoR. On views that look down at a floor it
runs short: a GoPro gym clip came out at about 0.6×, with the camera 0.99 m above the floor. With your height, the
world is instead scaled so the camera sits at your height minus 7 cm (a head-strap lens) during the upright start.
`runs/<name>/calibration.json` records both:

| Field | Healthy |
|---|---|
| `cam_height_m` | 1.0–2.2 m; outside that the run stops, since a head camera can't be there |
| `slam_cam_height_m`, `scale_from_height` | Metric3D's height and the factor your height applied |
| `floor_inlier_fraction` | The share of SLAM points on the floor; higher is better |
| `calib_window_motion_m` | Under 0.3 m: you stood still for the first 3 s |
| `head_height_median_m`, `path_length_m` | A quick sanity check against what you did |

## Process your own video

**Set up the pipeline** (Linux or WSL2 with an NVIDIA GPU, CUDA 12.6, 8 GB of VRAM is enough):

```bash
bash archive/scripts/setup.sh     # conda envs omniegocap, hawor, mhr, vlm; upstream code; weights; HaWoR patch
```

The body models need a free registration at https://mano.is.tue.mpg.de:

| Download | Put it at |
|---|---|
| SMPL-H "Extended SMPL+H model" `smplh.tar.xz` | `tar -xJf smplh.tar.xz -O neutral/model.npz > third_party/OmniEgoCap/data/smplh/SMPLH_NEUTRAL.npz` |
| MANO `mano_v1_2.zip`: `models/MANO_RIGHT.pkl` | `third_party/HaWoR/_DATA/data/mano/` |
| MANO `mano_v1_2.zip`: `models/MANO_LEFT.pkl` | `third_party/HaWoR/_DATA/data_left/mano_left/` |

The dev server finds the conda envs in `CONDA_ROOT` (default `~/anaconda3`).

**Run it** from the app (Open a recording → **Process**), or from the command line:

```bash
conda activate omniegocap
python pipeline/run.py my_walk.mp4 my_walk --camera gopro-linear --height 1.78     # → runs/my_walk/
```

| Flag | Meaning |
|---|---|
| `--camera C` | `phone`, `gopro-linear`, `gopro-wide` or `glasses` ([presets](#cameras-and-calibration)) |
| `--height H` | Your height in meters: sets the world's scale from the upright start |
| `--focal F` | Focal length (px) of the 1920 px working video, when you know it: `960 / tan(hfov / 2)` |
| `--input_npz F` | A ready OmniEgoCap input (e.g. OmniEgoDB's `input.npz`): no SLAM; HaWoR runs only for the fingers |
| `--smooth S` | Body smoothing in frames (default 2; 0 is OmniEgoCap's raw output) |
| `--describe none` | Skip the Muse captions |
| `--opt` | OmniEgoCap's wrist optimization: same body error, 71% more jerk, 2–3× slower |

Each stage is skipped when its output exists; delete the file to redo it. A minute of video takes 40–90 minutes on
an RTX 4060 Laptop, mostly hand tracking and SLAM, which run at 30 fps and at most 1920 px wide.

**If a run stops:**

| Message | What to do |
|---|---|
| `Calibration failed: the camera is X m above the fitted floor` | Enter your height; stand upright and still for the first 3 s; check the camera preset |
| `No floor found 0.9-2.2 m below the camera` | Tilt the camera down so some floor is in view, and move around |
| `3D body failed ... SLAM` | The clip had too little motion: record 20 s or more while walking |

The pipeline never borrows another recording's body: if the 3D body fails, the run stops with the error.

## How it works

```mermaid
flowchart LR
  V[/head-camera video/] --> H[HaWoR<br/>wrists, fingers,<br/>camera path]
  H --> F[floor fit<br/>gravity, height]
  F --> O[OmniEgoCap<br/>full 3D body]
  O --> R[render<br/>body + kinematics]
  V --> M[Muse Spark<br/>captions / 5 s]
  R & M --> I[posture / s<br/>rules + Muse]
  M & I --> T[Muse Spark<br/>review]
  R & I --> D[director<br/>fast + slow loop]
  D -->|ws://127.0.0.1:8765| UI[app: Routine,<br/>Music, Stage]
  T --> UI
```

1. **Ingest:** ffmpeg makes a 30 fps working video, at most 1920 px wide, with the preset's lens correction.
2. **HaWoR** ([`hawor_export.py`](pipeline/hawor_export.py)) finds the wrists and 15 finger joints per hand. DROID-SLAM
   then tracks the camera in 30 s pieces, which are joined by aligning their overlaps.
3. **Floor fit** ([`build_input.py`](pipeline/build_input.py)): a plane through the SLAM points sets "up" and the
   floor; the first 3 s set the head mount and, with your height, the scale.
4. **OmniEgoCap** ([`run_omniegocap.py`](pipeline/run_omniegocap.py)) infers the 22-joint body from head and wrist
   motion. The legs are a learned estimate, not seen. The body is then smoothed and HaWoR's fingers are added.
5. **Render** ([`render.py`](pipeline/render.py)): the body from outside, plus a scrolling graph of knee, hip and
   elbow flexion, trunk lean and walking speed, side by side with the POV (`side_by_side.mp4`).
6. **Captions** ([`describe_muse.py`](pipeline/describe_muse.py)): Muse Spark gets 3 frames per 5 s.
7. **Insights** ([`insights.py`](pipeline/insights.py)): a posture every second, a time split and breaks. **Process**
   then runs the Muse posture labels ([`posture_muse.py`](director/posture_muse.py)), the posture sources
   ([`posture_sources.py`](bench/posture_sources.py)) and the review ([`routine_tips.py`](director/routine_tips.py)).
   The review saves its whole prompt, which the app shows under **View Meta Muse Spark prompt payload**.

## Where every result comes from

Nothing in the app is sample data. Each value comes from a model, from fixed rules applied to the 3D body, or from a
fixed formula, as listed here.

| Shown | Source | Fixed parts to know |
|---|---|---|
| 3D body, joint angles, speed | HaWoR + OmniEgoCap on your video | Smoothing σ = 2 frames; the lens offset from the head comes from the camera preset |
| Body scale | Your height (when given), else Metric3D | The lens sits 7 cm below the top of the head |
| Captions | Muse Spark, 3 frames per 5 s | Muse can misread a frame |
| Posture "Rules" | [`insights.py`](pipeline/insights.py) on the 3D body | Walking > 0.5 m/s; a low posture held 8 s or more counts as sitting |
| Posture "Muse Spark" | Muse, from two frames per 5 s: the 3D body and the head camera ([`posture_muse.py`](director/posture_muse.py)) | Frames only: no numbers and no text. Shows unknown where Muse gave no label |
| Posture "Both agree" | The seconds where the rules and Muse name the same posture | Grey where they differ |
| Review | Muse Spark, from the posture log, captions, totals, 8 3D body frames and your profile | Compares with every other processed recording |
| Mood | Muse Spark every ~6 s | |
| Tempo | The body's rhythm: the lag (60–180 BPM) at which all four limbs' speeds over the last 8 s best repeat ([`session.js`](src/session.js) `rhythmBpm`) | Used when the match is 0.3 or more; otherwise Muse's tempo for the mood ([`music_map.py`](director/music_map.py)) |
| Light level, flashes, freeze | Speed rules ([`fast_loop.py`](director/fast_loop.py)); freeze from the whole body ([`anticipation.py`](director/anticipation.py)) | Flash at ≥ 0.5 m/s and 0.3 m/s above the last 4 s; freeze is measured against your own last 4 s |
| Each light | Its body part plus poses, jumps, crouches, turns and arm hits ([`stage.js`](src/stage.js)) | Fixed scales and thresholds, listed under [Music and stage](#music-and-stage) |
| Scene (palette, beat pattern, focus, strobe) | Muse Spark, from the body's numbers, a 3D body frame and the song, with its reason ([`vite.config.js`](vite.config.js) `/api/stage/scene`) | Until the first answer, the rules run with the director's colour |
| Song targets | The last 10 s of the body | Fixed formulas in [`main.js`](src/main.js) (`musicTargets`) |
| Songs, BPM | ReccoBeats recommendations; BPM is each song's measured tempo | Spotify plays a 30 s preview unless you are logged in |
| Processing % | Which pipeline stages have started | Fixed weights per stage; no timer moves it |

## Music and stage

**Tempo** comes from the body's own rhythm. For the last 8 s, the speeds of both wrists and both ankles are summed,
and LifeLens finds the repeat time (60–180 BPM) at which that signal best matches itself. Walking reads about
106–120 steps/min; standing still gives no rhythm, and then Muse's tempo for the mood is used.

| Body (last 10 s) | Song target |
|---|---|
| Pace (m/s), arm swing (°) | Energy |
| How clear the rhythm is | Danceability |
| The rhythm, else Muse's tempo | Tempo |
| How upright, plus the mood | Valence |
| Share of time still | Acousticness |

ReccoBeats gets new targets at most every 15 s, and only when they changed. The player finishes the current song and
then plays the first song of the newest list.

**Stage lights**, every frame, by rule ([`stage.js`](src/stage.js)):

| Movement (from the 3D joints) | What the lights do |
|---|---|
| Each body part's speed: elbows, knees, trunk lean + turning, pace | Its own light (left/right arm, left/right leg, torso, pace) |
| Hands above the shoulders, arms spread wide | Open the arm lights and widen the beams |
| A jump (pelvis 6% above standing height) | Lifts every light, with a rising sound |
| A crouch (pelvis 12% or more below standing) | Dims every light toward a blackout |
| Turning (degrees per second) | Shifts the colours, up to 40°, with a whoosh above 120°/s |
| A sudden arm move (wrist 0.7 m/s above its last second) | A white strobe and an impact sound |
| Where you are on the floor | Steers the spotlight |
| The beat: the song's measured BPM, else the body's rhythm | The scene's pattern: pulse, chase, strobe or still |

Every body part has its own colour. 10 s after each answer, **Muse Spark, as lighting designer**, gets the last 30 s
(pace, rhythm, hands up, spread, turning, hits, jumps, crouches, the mood and the playing song) and returns the next
scene with its reason. The director sets the overall level and flashes from speed on top.

**Show view** (Stage tab): a full-screen stage where the 3D body, keyed out of its render, performs under six beams
that follow it around the floor, with Muse's scene and reason, the cue timeline and the POV. **Sound FX** switches the
effects (generated in the browser).

**Real lights:** the six fixtures go to the dev server five times a second ([`server/lights.js`](server/lights.js)).

| `LIGHTS_OUTPUT` | Sends to | Settings |
|---|---|---|
| `sim` (default) | nothing; the Show view shows what would go out | |
| `artnet` | DMX over Art-Net (UDP 6454), 4 channels per fixture: dimmer, red, green, blue | `ARTNET_HOST`, `ARTNET_UNIVERSE`, `ARTNET_START` |
| `hue` | A Philips Hue bridge, changed lights only, 2× a second (the bridge's limit) | `HUE_BRIDGE`, `HUE_KEY`, `HUE_LIGHTS` (ids in fixture order) |

Art-Net and Hue are written to their specs but not yet tested on hardware.

## Gym (Gymify)

Gymify (Gym tab, [`pipeline/gymify.py`](pipeline/gymify.py)) analyses an exercise in a processed recording:

1. **Exercise:** Muse Spark names it from 6 frames of the 3D body over the most active 20 s (plus 2 POV frames), or you
   pick it from the list. When Muse sees no exercise, no reps are counted.
2. **Reps** are measured on the exercise's main joint (knee, hip, elbow, or hand height): every bend of at least 15°,
   or 35% of the joint's range, is a rep. Reps more than 8 s apart start a new set.

   | Measure | How |
   |---|---|
   | Range of motion | The joint's angle at the bottom of each rep minus its resting angle |
   | Tempo | Seconds from leaving rest to the bottom, and back |
   | Left-right difference | Between the two sides at the bottom |
   | Fatigue | Change in range from the first to the last third of the reps |
3. **Coaching:** Muse sees the 3D body at the start and the bottom of the first, middle and last rep, plus a POV frame,
   with the measured numbers and your profile. It returns form observations, changes (what, why, how), what went
   well, and a music profile. **Play gym music** finds songs for that profile on ReccoBeats.

A public workout clip (WEAR, a wide-lens GoPro tilted 45° down, no still start) failed the camera calibration twice;
the pipeline stopped instead of making a body.

## Stagify

**Stagify** (Stage tab) plans and records a show for the whole recording:

- **Plan:** for every 10 s segment the page measures the body's numbers and takes a 3D body frame. Muse Spark plans a
  scene per segment and 2–4 music sections at once, and ReccoBeats picks each section's song. Saved as `stage.json`;
  the Stage tab and Show view then play the planned scenes and switch songs at the sections.
- **Show video:** the Show view is replayed from 0:00 and recorded with its sound effects (`stage_show.webm`, not
  committed). Spotify's audio can't be recorded from its embed.
- **Lighting cues:** the 6 lights are sampled 10 times a second into `stage_cues.csv` (time, fixture, red, green, blue,
  level). `node server/replay.js <recording>/stage_cues.csv` plays them to Art-Net or Hue.

## Platforms

| | Linux / WSL2 + NVIDIA (CUDA 12.6, 8 GB) | macOS, Apple Silicon (MPS) |
|---|---|---|
| App, director, live captions, reviews, songs | yes | yes |
| Your own video → 3D body | yes | **no**: DROID-SLAM (the camera path) only has CUDA kernels |
| A ready camera path (`--input_npz`) → 3D body | yes | OmniEgoCap on MPS, HaWoR's hands on the CPU (untested on a Mac) |

Every torch stage picks CUDA, then MPS, then the CPU ([`pipeline/device.py`](pipeline/device.py)). If a model hits an
operation MPS lacks, set `LIFELENS_DEVICE=cpu`. On macOS, rendering uses pyglet instead of EGL.

## Results (RTX 4060 Laptop, 8 GB)

**3D body vs OmniEgoDB's Xsens motion capture.** OmniEgoCap's evaluator, `--input_npz` mode, 13,737 frames:

| | office | outdoor | robothome | all three | paper (20 seq.) |
|---|---|---|---|---|---|
| MPJPE (mm) | 93.9 | 101.7 | 105.6 | **102.6** | 111.7 |
| Hand error (mm) | 159 | 110 | 135 | **134.0** | 166.2 |
| Jerk (km/s³) | 0.02 | 0.03 | 0.01 | **0.016** | 0.073 |

This covers three of the paper's 20 sequences, so it checks the pipeline; it does not rank it. Own-video mode (our
SLAM) is not measured against motion capture.

**Posture agreement with the motion-capture labels**, share of seconds:

| | Rules | Muse Spark | Both agree | Always "standing" |
|---|---|---|---|---|
| office (83 s) | 100% | 70% | 70% | 63% |
| outdoor (105 s) | 90% | 72% | 68% | 30% |

Muse Spark labelled posture here from one 3D body frame and the caption per 5 s. Reading the body's numbers instead
it agreed more (office 84%, outdoor 79%); from frames alone (3D body + head camera, no text) office fell to 43%. The
motion-capture labels come from the same rules run on the Xsens skeleton, so they favor the rules column: this is
agreement, not accuracy.

**Speed** ([`bench/live_fps.py`](bench/live_fps.py), a 10 s own-video clip):

| Stage | Seconds per video second |
|---|---|
| HaWoR: hands + DROID-SLAM | 30–77 (78–85% of the total) |
| OmniEgoCap | 2.2–3.5 |
| Render | 2.2–3.9 |
| Captions (Muse Spark, one call per 5 s) | 3.4–3.7 |
| Whole pipeline | **39–90**, i.e. 0.3–0.8 fps against the 30 fps of live video |
| Director fast loop | 0.06 ms per frame |

So the 3D body cannot be live on this laptop; it would need a machine 40–90× faster. The live session therefore shows
Muse's captions (about 7 s per reply) and builds the body after you stop.

## Limits

- **Legs** are OmniEgoCap's estimate from head and wrist motion; the camera never sees them. Uneven ground reads as
  bent knees.
- **Scale** without your height comes from Metric3D, which can be well off on top-down views (see above).
- **Fisheye lenses** (GoPro Wide, SuperView) are only approximated by one barrel correction.
- **Fingers** come from HaWoR only where it detects a hand. Gaps up to 0.5 s are interpolated; longer ones ease to the
  clip's average hand.
- **Feet** sink 2–4 cm into the floor in OmniEgoCap's output. The video lifts the drawn body; the exported motion
  doesn't.
- **Muse Spark** can misread a frame or time out (3 retries). Its mood updates stop after 30 calls per Play
  (`--max-muse-calls`).
- **Freeze** detection is a rule on the body (whole-body motion against your own recent movement), not a trained model.

## Director

[`director/server.py`](director/server.py) replays a processed recording and streams JSON cues over
`ws://127.0.0.1:8765`. The fast loop (every frame) sets brightness, zone colour and flashes from speed. The slow loop
(about every 6 s) asks Muse Spark for mood and tempo. The app starts and stops it with **Play** and **Pause**. More
in [director/README.md](director/README.md) and [director/TESTING.md](director/TESTING.md). There are no synthetic
tests: the checks run on the real recordings.

## Licenses

No license is set for this code yet. These are not included and are non-commercial:

- OmniEgoCap's checkpoint (CC BY-NC 4.0)
- SMPL-H and MANO (MPI)
- HaWoR (CC BY-NC-ND)
- OmniEgoDB (CC BY-NC, gated)

Even on your own footage, the 3D body comes from these models, so LifeLens is fine for research and demos but not
for a product. The example recordings and the demo video (whose POV is OmniEgoDB footage) are derived from OmniEgoDB
and inherit CC BY-NC. © 2026 LifeLens team.
