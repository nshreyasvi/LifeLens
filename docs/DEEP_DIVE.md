# LifeLens deep dive

Everything below is the full detail: how to record, calibrate and process your own video, where every number comes from, and how the music, lights, Gymify and Stagify work.

Back to the [Main README](../README.md) · See also: [UI & Features Guide](UI_GUIDE.md) · [Usage & 3D Pipeline](USAGE_AND_PIPELINE.md) · [Meta AI Models & Ecosystem](MODELS_AND_ECOSYSTEM.md).

## Contents

- [Recording a good video](#recording-a-good-video)
- [Cameras and calibration](#cameras-and-calibration)
- [Process your own video](#process-your-own-video)
- [Every output at a glance](#every-output-at-a-glance)
- [Where every result comes from](#where-every-result-comes-from)
- [Music and stage](#music-and-stage)
- [Gym (Gymify)](#gym-gymify)
- [Stagify](#stagify)
- [Platforms](#platforms)
- [Director](#director)

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

The 3D human body and hand representation uses **[Meta MHR (Momentum Human Rig)](https://github.com/facebookresearch/momentum)** alongside [OmniEgoCap](https://github.com/MiroPsota/OmniEgoCap) and [HaWoR](https://github.com/ThunderVVV/HaWoR).

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

## Every output at a glance

| From | You get | Made by |
|---|---|---|
| The head-camera video | Your 3D MHR body (with 30 finger joints, 30 fps) and its joint angles | HaWoR (hands, camera path) → Meta MHR + OmniEgoCap (body) |
| The video, every 5 s | A caption of what you are doing | Meta Muse Spark, from 3 frames |
| The 3D body and the head camera, every 5 s | A posture label | Meta Muse Spark, from the two frames |
| Muse's labels, every second | Posture: walking, standing, sitting, crouching, bending, arms raised, and the time split | [`insights.py`](../pipeline/insights.py) from Muse's 5 s labels |
| The body's numbers per ~20 s + the captions | Songs per section, the activity and whether it is active | ReccoBeats; Muse Spark names the style ([`songs.py`](../pipeline/songs.py)) |
| All of the above + 8 3D body frames | A review: what you did, what to change and why, compared with your other recordings | Meta Muse Spark |
| **Gymify:** the 3D body's reps | The exercise, reps, sets and rests, range of motion, tempo, left-right difference; form feedback; the music for the reps (into the queue) | Measured on the joints; Muse Spark names the exercise and gives form feedback from 3D body frames |
| **Stagify:** the whole recording | A planned show: a scene every 10 s, songs per section, the show video and a lighting cue file | Muse Spark plans from each segment's numbers and a 3D body frame; ReccoBeats |
| The 3D body, live | Mood (every ~6 s), light level and flashes (every frame) | Director: Muse Spark + speed rules |
| The last 10 s of the body | 5 songs that fit your pace, rhythm and arm swing | ReccoBeats, Spotify |
| The body, every frame + Muse every 20–30 s | A stage show: 6 lights per body part, scenes with Muse's reason, sound effects on hits, jumps and turns, output to real lights | Rules + Muse Spark as lighting designer |

## Where every result comes from

Nothing in the app is sample data. Each value comes from a model, from fixed rules applied to the 3D body, or from a
fixed formula, as listed here.

| Shown | Source | Fixed parts to know |
|---|---|---|
| 3D body, joint angles, speed | HaWoR + OmniEgoCap on your video | Smoothing σ = 2 frames; the lens offset from the head comes from the camera preset |
| Body scale | Your height (when given), else Metric3D | The lens sits 7 cm below the top of the head |
| Captions | Muse Spark, 3 frames per 5 s | Muse can misread a frame |
| Posture | Muse, from two frames per 5 s: the 3D body and the head camera ([`posture_muse.py`](../director/posture_muse.py)) | Frames only: no numbers and no text. Shows unknown where Muse gave no label |
| Review | Muse Spark, from the posture log, captions, totals, 8 3D body frames and your profile | Compares with every other processed recording |
| Mood | Muse Spark every ~6 s | |
| Body rhythm (/min) | The lag (60–180 per minute) at which all four limbs' speeds over the last 8 s best repeat ([`session.js`](../src/session.js) `rhythmBpm`) | Used when the match is 0.3 or more; otherwise Muse's tempo for the mood ([`music_map.py`](../director/music_map.py)) |
| Light level, flashes, freeze | Speed rules ([`fast_loop.py`](../director/fast_loop.py)); freeze from the whole body ([`anticipation.py`](../director/anticipation.py)) | Flash at ≥ 0.5 m/s and 0.3 m/s above the last 4 s; freeze is measured against your own last 4 s |
| Each light | Its body part plus poses, jumps, crouches, turns and arm hits ([`stage.js`](../src/stage.js)) | Fixed scales and thresholds, listed under [Music and stage](#music-and-stage) |
| Scene (palette, beat pattern, focus, strobe) | Muse Spark, from the body's numbers, a 3D body frame and the song, with its reason ([`vite.config.js`](../vite.config.js) `/api/stage/scene`) | Until the first answer, the rules run with the director's colour |
| Song targets | The last 10 s of the body | Fixed formulas in [`main.js`](../src/main.js) (`musicTargets`) |
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

**Stage lights**, every frame, by rule ([`stage.js`](../src/stage.js)):

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

**The stage show** (the Stage tab's main view): the 3D body, keyed out of its render, performs centre stage with its
pelvis fixed, under six beams, with Muse's scene and reason and the POV; the stage rig sits underneath. **Sound FX** switches the
effects (generated in the browser).

**Real lights:** the six fixtures go to the dev server five times a second ([`server/lights.js`](../server/lights.js)).

| `LIGHTS_OUTPUT` | Sends to | Settings |
|---|---|---|
| `sim` (default) | nothing; the stage show shows what would go out | |
| `artnet` | DMX over Art-Net (UDP 6454), 4 channels per fixture: dimmer, red, green, blue | `ARTNET_HOST`, `ARTNET_UNIVERSE`, `ARTNET_START` |
| `hue` | A Philips Hue bridge, changed lights only, 2× a second (the bridge's limit) | `HUE_BRIDGE`, `HUE_KEY`, `HUE_LIGHTS` (ids in fixture order) |

Art-Net and Hue are written to their specs but not yet tested on hardware.

## Gym (Gymify)

Gymify (Gym tab, [`pipeline/gymify.py`](../pipeline/gymify.py)) analyses an exercise in a processed recording:

1. **Exercise:** Muse Spark names it from 6 frames of the 3D body over the most active 20 s plus 2 POV frames. When
   Muse sees no exercise, no reps are counted.
2. **Reps** are measured on the exercise's main joint (knee, hip, elbow, or hand height): every bend of at least 15°,
   or 35% of the joint's range, is a rep. Reps more than 8 s apart start a new set.

   | Measure | How |
   |---|---|
   | Range of motion | The joint's angle at the bottom of each rep minus its resting angle |
   | Tempo | Seconds from leaving rest to the bottom, and back |
   | Left-right difference | Between the two sides at the bottom |
   | Fatigue | Change in range from the first to the last third of the reps |
3. **Form feedback:** Muse sees the 3D body at the start and the bottom of the first, middle and last rep, plus a POV frame,
   with the measured numbers and your profile. It returns form observations, changes (what, why, how), what went
   well, and a music style, which replaces the queue's songs for the sections the reps fall in.

A public workout clip (WEAR, a wide-lens GoPro tilted 45° down, no still start) failed the camera calibration twice;
the pipeline stopped instead of making a body.

## Stagify

**Stagify** (Stage tab) plans and records a show for the whole recording:

- **Plan:** for every 10 s segment the page measures the body's numbers and takes a 3D body frame. Muse Spark plans a
  scene per segment and 2–4 music sections at once, and ReccoBeats picks each section's song. Saved as `stage.json`;
  the stage show then plays the planned scenes and switches songs at the sections.
- **Show video:** the stage show is replayed from 0:00 and recorded with its sound effects (`stage_show.webm`, not
  committed). Spotify's audio can't be recorded from its embed.
- **Lighting cues:** the 6 lights are sampled 10 times a second into `stage_cues.csv` (time, fixture, red, green, blue,
  level). `node server/replay.js <recording>/stage_cues.csv` plays them to Art-Net or Hue.

## Platforms

| | Linux / WSL2 + NVIDIA (CUDA 12.6, 8 GB) | macOS, Apple Silicon (MPS) |
|---|---|---|
| App, director, live captions, reviews, songs | yes | yes |
| Your own video → 3D body | yes | **no**: DROID-SLAM (the camera path) only has CUDA kernels |
| A ready camera path (`--input_npz`) → 3D body | yes | OmniEgoCap on MPS, HaWoR's hands on the CPU (untested on a Mac) |

Every torch stage picks CUDA, then MPS, then the CPU ([`pipeline/device.py`](../pipeline/device.py)). If a model hits an
operation MPS lacks, set `LIFELENS_DEVICE=cpu`. On macOS, rendering uses pyglet instead of EGL.

## Director

[`director/server.py`](../director/server.py) replays a processed recording and streams JSON cues over
`ws://127.0.0.1:8765`. The fast loop (every frame) sets brightness, zone colour and flashes from speed. The slow loop
(about every 6 s) asks Muse Spark for mood and tempo. The app starts and stops it with **Play** and **Pause**. More
in [director/README.md](../director/README.md) and [director/TESTING.md](../director/TESTING.md). There are no synthetic
tests: the checks run on the real recordings.
