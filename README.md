<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-wordmark-on-dark.svg">
    <img alt="LifeLens" src="docs/brand/logo-wordmark.svg" width="360">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/nshreyasvi/LifeLens/releases/tag/demos-v1"><img alt="Release" src="https://img.shields.io/badge/release-demos--v1-2B44E8?style=flat-square&logo=github"></a>
  <a href="#run-the-app"><img alt="Vite" src="https://img.shields.io/badge/app-Vite_6_%C2%B7_vanilla_JS-2B44E8?style=flat-square&logo=vite&logoColor=white"></a>
  <a href="#where-every-result-comes-from"><img alt="Meta Muse Spark" src="https://img.shields.io/badge/Meta-Muse_Spark_1.3-0467DF?style=flat-square&logo=meta&logoColor=white"></a>
  <a href="#how-it-works"><img alt="3D body" src="https://img.shields.io/badge/3D_body-OmniEgoCap_%2B_HaWoR-C83E1B?style=flat-square"></a>
  <a href="#music-and-stage"><img alt="Music" src="https://img.shields.io/badge/music-ReccoBeats_%C2%B7_Spotify-1DB954?style=flat-square&logo=spotify&logoColor=white"></a>
  <br>
  <a href="#platforms"><img alt="CUDA" src="https://img.shields.io/badge/CUDA-12.6-76B900?style=flat-square&logo=nvidia&logoColor=white"></a>
  <a href="#platforms"><img alt="Apple MPS" src="https://img.shields.io/badge/Apple_MPS-partial-555555?style=flat-square&logo=apple&logoColor=white"></a>
  <a href="#set-up-the-pipeline"><img alt="Python" src="https://img.shields.io/badge/python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white"></a>
  <a href="director/TESTING.md"><img alt="Tests" src="https://img.shields.io/badge/tests-70_passed-16794B?style=flat-square&logo=pytest&logoColor=white"></a>
  <a href="#licenses"><img alt="License" src="https://img.shields.io/badge/weights_%26_data-CC_BY--NC_4.0-57554F?style=flat-square"></a>
</p>

LifeLens takes a video from a camera on your head (phone, smart glasses or GoPro) and rebuilds your whole body in 3D,
though the camera never sees it. From that body and the video it tells you what you did, how you moved and what you
could change, and it drives music and stage lights from your movement.

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

## What you get

| From | You get | Made by |
|---|---|---|
| The head-camera video | Your 3D body (with 30 finger joints, 30 fps) and its joint angles | HaWoR (hands, camera path) → OmniEgoCap (body) |
| The video, every 5 s | A caption of what you are doing | Meta Muse Spark, from 3 frames |
| A 3D body frame + the caption, every 5 s | A second posture label | Meta Muse Spark (sees the frame) |
| The 3D body, every second | Posture: walking, standing, sitting, crouching, bending, arms raised | Fixed rules on the body (below) |
| All of the above + 8 3D body frames | A review: what you did, what to change and why, compared with other recordings | Meta Muse Spark |
| **Gymify:** the 3D body's reps | The exercise, reps, sets and rests, range of motion, tempo, left-right difference; form coaching; music to train to | Measured on the joints; Muse Spark names the exercise and coaches from 3D body frames |
| **Stagify:** the whole recording | A planned show: a scene every 10 s, songs per section, the show video and a lighting cue file | Muse Spark plans from each segment's numbers and a 3D body frame; ReccoBeats |
| The 3D body, live | Mood (every ~6 s), light level and flashes (every frame) | Director: Muse Spark + speed rules |
| The body's own rhythm (last 8 s) | The tempo the songs and lights follow | Autocorrelation of all four limbs' speeds |
| The last 10 s of the body | 5 songs that fit your pace, rhythm and arm swing | ReccoBeats, Spotify |
| The body, every frame + Muse every 20–30 s | A stage show: 6 lights per body part, a scene (palette, beat pattern, focus) with Muse's reason, sound effects on hits, jumps and turns, the 3D body on a virtual stage, output to real lights | Rules + Muse Spark as lighting designer |

## Run the app

```sh
npm install
python -m venv director/venv && director/venv/bin/pip install -r director/requirements.txt
cp director/.env.example director/.env     # then set MUSE_API_KEY=...
DIRECTOR_PYTHON=director/venv/bin/python npm run dev     # http://localhost:8000
```

On Windows the venv's Python is `director\venv\Scripts\python.exe`; the dev server finds either one by itself.

Enter your name, then pick one:

- **Open a recording.** The two examples ([`examples/office`](examples/office), 83 s indoors;
  [`examples/outdoor`](examples/outdoor), 105 s outside) work without a GPU. So does any run in `runs/`. Saved,
  unprocessed clips in `recordings/` have **Process** and **Delete**; several can be queued.
- **New live session.** Your camera becomes the POV, and every 6 s Muse Spark captions two frames and names your
  posture over it. Name the recording, **Record**, then **Stop**: the clip is saved, not processed. **Process now**
  (or later, from Open a recording) builds the 3D body, the music and the stage show at full quality, and the session
  is there next time. A live 3D body would need about 1–2 fps: an NVIDIA GPU with 16 GB of VRAM or more (RTX
  4080/4090 class, estimated; an RTX 4060 Laptop measured 0.3–0.8 fps).

**Play** starts the director on the open recording. The tabs:

| Tab | Shows |
|---|---|
| **Routine** | The POV, 3D body and kinematics. Icon tiles and a posture donut. A timeline with Muse's activities as spans, its changes as numbered pins, the posture strip (rules, Muse Spark, or where both agree) and walking speed. A film strip of POV thumbnails. The Muse review, past routines as one chart, and "vs. past" bars |
| **Music** | The body's features, the targets and 5 songs, playing through one Spotify player |
| **Stage** | Lights per body part; Muse's scene; **Show view** (the 3D body on a virtual stage); **Stagify** |
| **Gym** | **Gymify**: the exercise, rep chart, sets and rests, range, tempo, symmetry, Muse's coaching and gym music |

The `director/.env` file is gitignored; the browser never sees the key. Without `director/.env`, the director runs on
its speed rules only, and the app shows no mood or songs rather than defaults. With an empty key it falls back to a
local Llama 3.2 through Ollama, when one is running.

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

`python pipeline/run.py <video> <name>` runs steps 1–7 into `runs/<name>/`; **Process** in the app also runs the Muse
posture labels and the review. Each stage is skipped when its output exists; delete the file to redo it.

1. **Ingest:** ffmpeg makes a 30 fps working video, at most 1920 px wide.
2. **HaWoR** ([`hawor_export.py`](pipeline/hawor_export.py)) finds the wrists and 15 finger joints per hand. DROID-SLAM
   then tracks the camera in 30 s pieces, which are joined by aligning their overlaps.
3. **Floor fit** ([`build_input.py`](pipeline/build_input.py)): a plane through the SLAM points sets "up" and the
   floor.
4. **OmniEgoCap** ([`run_omniegocap.py`](pipeline/run_omniegocap.py)) infers the 22-joint body from head and wrist
   motion. The legs are a learned estimate, not seen. The body is then smoothed and HaWoR's fingers are added.
5. **Render** ([`render.py`](pipeline/render.py)): the body from outside, plus a scrolling graph of knee, hip and
   elbow flexion, trunk lean and walking speed.
6. **Captions** ([`describe_muse.py`](pipeline/describe_muse.py)): Muse Spark gets 3 frames per 5 s.
7. **Insights** ([`insights.py`](pipeline/insights.py)): a posture every second, a time split and breaks. Then the
   Muse posture labels ([`posture_muse.py`](director/posture_muse.py)), the posture sources
   ([`posture_sources.py`](bench/posture_sources.py)) and the review ([`routine_tips.py`](director/routine_tips.py)),
   which **Process** runs after `run.py`. The review saves its whole prompt, which the app shows under
   **View Meta Muse Spark prompt payload**.

If the 3D body fails, for example because SLAM had too little motion, the run stops with the error. It never
borrows another recording's body.

## Where every result comes from

Nothing in the app is sample data. Each value comes from a model, from fixed rules applied to the 3D body, or from a
fixed formula, as listed here.

| Shown | Source | Fixed parts to know |
|---|---|---|
| 3D body, joint angles, speed | HaWoR + OmniEgoCap on your video | Smoothing σ = 2 frames; the camera's offset from the head is fixed at (0, 0.16, 0.12) m |
| Captions | Muse Spark, 3 frames per 5 s | Muse can misread a frame |
| Posture "Rules" | [`insights.py`](pipeline/insights.py) on the 3D body | Walking > 0.5 m/s; a low posture held 8 s or more counts as sitting; tuned on the demo clips |
| Posture "Muse Spark" | Muse, from a 3D body frame and the caption per 5 s ([`posture_muse.py`](director/posture_muse.py)) | No numbers: Muse looks at the body. Shows unknown where Muse gave no label |
| Posture "Both agree" | The seconds where the rules and Muse name the same posture | Grey where they differ |
| Agreement % (examples only) | Against the same rules run on OmniEgoDB's motion capture | It shares the rules' thresholds, so it favors the rules: agreement, not accuracy |
| Review | Muse Spark, from the posture log, captions, totals and 8 3D body frames | Other recordings may be other people (the two examples are different OmniEgoDB wearers) |
| Mood | Muse Spark every ~6 s | |
| Tempo | The body's rhythm: the lag (60–180 BPM) at which all four limbs' speeds over the last 8 s best repeat ([`session.js`](src/session.js) `rhythmBpm`) | Used when the match is 0.3 or more. Otherwise Muse's tempo for the mood, which moves toward the mood's range by at most 10 BPM per update ([`music_map.py`](director/music_map.py)) |
| Overall light level, flashes, freeze | Speed rules ([`fast_loop.py`](director/fast_loop.py)) | Flash at ≥ 0.5 m/s and 0.3 m/s above the last 4 s. The freeze "predictor" is a stand-in with a fixed score |
| Each light | Its body part plus poses, jumps, crouches, turns and arm hits ([`stage.js`](src/stage.js)) | Fixed scales and thresholds, listed under [Music and stage](#music-and-stage) |
| Scene (palette, beat pattern, focus, strobe) | Muse Spark, 10 s after its last answer, from the body's numbers, a 3D body frame and the song, with its reason ([`vite.config.js`](vite.config.js) `/api/stage/scene`) | Until the first answer, the rules run with the director's colour |
| Energy (low/medium/high) | Pelvis speed divided by the clip's own 95th percentile | Relative to the clip, not absolute |
| Song targets | The last 10 s of the body | Fixed formulas in [`main.js`](src/main.js) (`musicTargets`) |
| Songs, BPM | ReccoBeats recommendations, seeded by its top search result for the mood; BPM is each song's measured tempo | Spotify plays a 30 s preview unless you are logged in |
| Processing % | Which pipeline stages have started | Fixed weights per stage; no timer moves it |

## Music and stage

**Tempo** comes from the body's own rhythm. For the last 8 s, the speeds of both wrists and both ankles are summed,
and LifeLens finds the repeat time (60–180 BPM) at which that signal best matches itself. While walking in `office`
this reads 106–120 steps/min; standing still gives no rhythm, and then Muse's tempo for the mood is used.

| Body (last 10 s) | Song target |
|---|---|
| Pace (m/s), arm swing (°) | Energy |
| How clear the rhythm is | Danceability |
| The rhythm, else Muse's tempo | Tempo |
| How upright, plus the mood | Valence |
| Share of time still | Acousticness |

ReccoBeats gets new targets at most every 15 s, and only when they changed. The player finishes the current song and
then plays the first song of the newest list.

**Stage lights** mix several movements. Every frame, by rule ([`stage.js`](src/stage.js)):

| Movement (from the 3D joints) | What the lights do |
|---|---|
| Each body part's speed: elbows, knees, trunk lean + turning, pace | Its own light (left/right arm, left/right leg, torso, pace) |
| Hands above the shoulders, arms spread wide | Open the arm lights and widen the beams |
| A jump (pelvis 6% above standing height) | Lifts every light, with a rising sound |
| A crouch (pelvis 12% or more below standing) | Dims every light toward a blackout |
| Turning (degrees per second) | Shifts the colours, up to 40°, with a whoosh above 120°/s |
| A sudden arm move (wrist 0.7 m/s above its last second) | A white strobe and an impact sound |
| Where you are on the floor | Steers the spotlight |
| The beat: the song's measured BPM, else the body's rhythm | The scene's pattern: pulse, chase (one light after another), strobe or still |

Every body part has its own colour. With Muse's palette, arms, legs and torso each take one of its colours, with left
and right shifted apart. 10 s after each answer (it takes Muse 10–20 s to answer), **Muse Spark, as lighting designer**, gets those numbers: pace, rhythm, how often
the hands are up, spread, turning, hits, jumps and crouches in the last 30 s, the mood and the playing song. It returns
the next scene with its reason. On top of that, the director sets the overall level and flashes from speed.

**Show view** (Stage tab → *Show view*):
- **Stage:** a full-screen stage where the 3D body, keyed out of its render, performs under six beams that follow it
  around the floor. A backdrop and particles take the scene's colours and pulse to the beat.
- **Panels:** Muse's scene and reason, the cue timeline (hits, jumps, turns, scene changes) and the POV. **Sound FX**
  switches the effects (generated in the browser, no audio files).

**Real lights:** the same six fixtures go to the dev server five times a second ([`server/lights.js`](server/lights.js)).

| `LIGHTS_OUTPUT` | Sends to | Settings |
|---|---|---|
| `sim` (default) | nothing; the Show view shows what would go out | |
| `artnet` | DMX over Art-Net (UDP 6454), 4 channels per fixture: dimmer, red, green, blue | `ARTNET_HOST`, `ARTNET_UNIVERSE`, `ARTNET_START` |
| `hue` | A Philips Hue bridge, changed lights only, 2× a second (the bridge's limit) | `HUE_BRIDGE`, `HUE_KEY`, `HUE_LIGHTS` (ids in fixture order) |

Art-Net and Hue are written to their specs but not yet tested on hardware.

## Gym (Gymify)

Gymify (Gym tab, [`pipeline/gymify.py`](pipeline/gymify.py)) analyses an exercise in a processed recording:

1. **Exercise:** Muse Spark names it from 6 frames of the 3D body over the most active 20 s (plus 2 POV frames), or you
   pick it from the list. When Muse sees no exercise, no reps are counted. On `office` and `outdoor` it answers
   "no exercise" (walking, sitting), with 85–90% confidence.
2. **Reps** are measured on the exercise's main joint (knee, hip, elbow, or hand height): every bend of at least 15°,
   or 35% of the joint's range, is a rep. Reps more than 8 s apart start a new set.

   | Measure | How |
   |---|---|
   | Range of motion | The joint's angle at the bottom of each rep minus its resting angle |
   | Tempo | Seconds from leaving rest to the bottom, and back |
   | Left-right difference | Between the two sides at the bottom |
   | Fatigue | Change in range from the first to the last third of the reps |
3. **Coaching:** Muse sees the 3D body at the start and the bottom of the first, middle and last rep, plus a POV frame,
   with the measured numbers. It returns form observations, changes (what, why, how), what went well, and a music
   profile. **Play gym music** finds songs for that profile on ReccoBeats.

## Stagify

**Stagify** (Stage tab) plans and records a show for the whole recording:

- **Plan:** for every 10 s segment the page measures the body's numbers (pace, rhythm, arm hits, jumps, crouches,
  turns, hands up, spread) and takes a 3D body frame. Muse Spark plans a scene per segment and 2–4 music sections at
  once, and ReccoBeats picks each section's song. This is saved as `stage.json`; with it, the Stage tab and Show view
  play the planned scenes instantly and switch songs at the sections.
- **Show video:** the Show view is replayed from 0:00 and recorded with its sound effects (`stage_show.webm`, not
  committed). Spotify's audio can't be recorded from its embed.
- **Lighting cues:** the 6 lights are sampled 10 times a second into `stage_cues.csv` (time, fixture, red, green, blue,
  level). `node server/replay.js examples/office/stage_cues.csv` plays them to Art-Net or Hue.

On `office`, Muse planned 9 scenes and 4 music sections in 30 s, for example "Opening Stride Chase: matches pace 0.63
m/s, still 16%, rhythm 100 BPM and 12 arm moves".

## Platforms

| | Linux / WSL2 + NVIDIA (CUDA 12.6, 8 GB) | macOS, Apple Silicon (MPS) |
|---|---|---|
| App, director, live captions, reviews, songs | yes | yes |
| Your own video → 3D body | yes | **no**: DROID-SLAM (the camera path) only has CUDA kernels |
| A ready camera path (`--input_npz`) → 3D body | yes | OmniEgoCap on MPS, HaWoR's hands on the CPU (untested on a Mac) |

Every torch stage picks CUDA, then MPS, then the CPU ([`pipeline/device.py`](pipeline/device.py)). If a model hits an
operation MPS lacks, set `LIFELENS_DEVICE=cpu`. On macOS, rendering uses pyglet instead of EGL. The dev server reads
your conda folder from `CONDA_ROOT` (default `~/anaconda3`).

## Set up the pipeline

```bash
bash archive/scripts/setup.sh     # conda envs omniegocap, hawor, mhr, vlm; upstream code; weights; HaWoR patch
```

The body models need a free registration at https://mano.is.tue.mpg.de:

| Download | Put it at |
|---|---|
| SMPL-H "Extended SMPL+H model" `smplh.tar.xz` | `tar -xJf smplh.tar.xz -O neutral/model.npz > third_party/OmniEgoCap/data/smplh/SMPLH_NEUTRAL.npz` |
| MANO `mano_v1_2.zip`: `models/MANO_RIGHT.pkl` | `third_party/HaWoR/_DATA/data/mano/` |
| MANO `mano_v1_2.zip`: `models/MANO_LEFT.pkl` | `third_party/HaWoR/_DATA/data_left/mano_left/` |

```bash
conda activate omniegocap
python pipeline/run.py my_walk.mov my_walk        # → runs/my_walk/
```

| Flag | Meaning |
|---|---|
| `--focal F` | Focal length (px) of the 1920 px working video. iPhone videos carry it; for other cameras it is `960 / tan(hfov / 2)` |
| `--input_npz F` | A ready OmniEgoCap input (e.g. OmniEgoDB's `input.npz`): no SLAM; HaWoR runs only for the fingers |
| `--smooth S` | Body smoothing in frames (default 2; 0 is OmniEgoCap's raw output) |
| `--describe none` | Skip the Muse captions |
| `--opt` | OmniEgoCap's wrist optimization: same body error, 71% more jerk, 2–3× slower |

Recording your own video:
- Fix the camera to your head (strap or cap), tilted 20–30° down so your hands and some floor are in view.
- Stand still for the first 3 s.
- Keep clips under 2 min, and walk around: SLAM needs motion.

## Results (RTX 4060 Laptop, 8 GB)

**3D body vs OmniEgoDB's Xsens motion capture.** OmniEgoCap's evaluator, `--input_npz` mode, 13,737 frames:

| | office | outdoor | robothome | all three | paper (20 seq.) |
|---|---|---|---|---|---|
| MPJPE (mm) | 93.9 | 101.7 | 105.6 | **102.6** | 111.7 |
| Hand error (mm) | 159 | 110 | 135 | **134.0** | 166.2 |
| Jerk (km/s³) | 0.02 | 0.03 | 0.01 | **0.016** | 0.073 |

This covers three of the paper's 20 sequences, so it checks the pipeline; it does not rank it. Own-video mode (our
SLAM) is not measured.

**Posture agreement with the motion-capture labels**, share of seconds:

| | Rules | Muse Spark | Both agree | Always "standing" |
|---|---|---|---|---|
| office (83 s) | 100% | 70% | 70% | 63% |
| outdoor (105 s) | 90% | 72% | 68% | 30% |

Muse Spark labels posture from one 3D body frame and the caption per 5 s. When it read the body's numbers instead, it
agreed more (office 84%, outdoor 79%): a single frame is a weaker cue than speed, hip height and knee angle.

The motion-capture labels come from the same rules run on the Xsens skeleton, so they favor the rules column: this
is agreement, not accuracy.

**Speed** ([`bench/live_fps.py`](bench/live_fps.py), a 10 s own-video clip):

| Stage | Seconds per video second |
|---|---|
| HaWoR: hands + DROID-SLAM | 30–77 (78–85% of the total) |
| OmniEgoCap | 2.2–3.5 |
| Render | 2.2–3.9 |
| Captions | 1.3–1.6 with the local Qwen3-VL used when this was measured; Muse Spark now takes 3.4–3.7 (one call per 5 s, office and outdoor) |
| Whole pipeline | **39–90**, i.e. 0.3–0.8 fps against the 30 fps of live video |
| Director fast loop | 0.06 ms per frame |

The run was measured when captions and the summary still used the local Qwen3-VL (3.3–3.7 s per video second
together). Muse Spark's captions take about the same, 3.4–3.7, so the total is about the same.

So the 3D body cannot be live on this laptop; it would need a machine 40–90× faster. The live session therefore shows
Muse's captions (about 7 s per reply) and builds the body after you stop.

## Limits

- **Legs** are OmniEgoCap's estimate from head and wrist motion; the camera never sees them. Uneven ground outdoors
  reads as bent knees.
- **Fingers** come from HaWoR only where it detects a hand (24–46% of frames in the demos). Gaps up to 0.5 s are
  interpolated; longer ones ease to the clip's average hand.
- **Feet** sink 2–4 cm into the floor in OmniEgoCap's output. The video lifts the drawn body; the exported motion
  doesn't.
- **History:** the review compares recordings, but the two examples are different people. Record several sessions
  of yourself for a real history.
- **Muse Spark** can misread a frame or time out (3 retries). Its mood updates stop after 30 calls per Play
  (`--max-muse-calls`).
- **Freeze** detection is a stand-in (a fixed score after a sustained stop), not a trained model.

## Director

[`director/server.py`](director/server.py) replays a processed recording and streams JSON cues over
`ws://127.0.0.1:8765`. The fast loop (every frame) sets brightness, zone color and flashes from speed. The slow loop
(about every 6 s) asks Muse Spark for mood and tempo. The app starts and stops it with **Play** and **Pause**. More
in [director/README.md](director/README.md) and [director/TESTING.md](director/TESTING.md):
`python -m pytest director/tests -q`, 70 passed.

## Licenses

No license is set for this code yet. These are not included and are non-commercial:

- OmniEgoCap's checkpoint (CC BY-NC 4.0)
- SMPL-H and MANO
- OmniEgoDB (CC BY-NC, gated)

That's fine for research and demos, but not for a product. The example recordings and the demo video (whose POV is
OmniEgoDB footage) are derived from OmniEgoDB and inherit CC BY-NC. The raw POV videos themselves are not in the
repo. © 2026 LifeLens team.
