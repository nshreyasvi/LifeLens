# Meta AI Models, Use Cases & Open-Source Ecosystem

Back to [Main README](../README.md) · See also: [UI & Features Guide](UI_GUIDE.md) · [Usage & 3D Pipeline](USAGE_AND_PIPELINE.md) · [Technical Deep Dive](DEEP_DIVE.md)

---

## 1. How LifeLens Uses `sam-3d-body`, Meta MHR & Meta Muse Spark

LifeLens combines **Meta's 3D human perception & rigging models** with **Meta's multimodal reasoning models** so a single wearable camera can power four everyday use cases:

| Model / Technology | Role in LifeLens | Everyday Use Cases Powered |
|---|---|---|
| **[Meta SAM 3D Body (`sam-3d-body`)](https://ai.meta.com/sam2/)** | 3D human body perception, visual body segmentation, and monocular 3D human mesh foundation | Anchors 3D body reconstruction when limbs or hands enter the egocentric field of view during workouts, meals, or outdoor sports |
| **[Meta MHR (Momentum Human Rig)](https://github.com/facebookresearch/momentum)** | Articulated 3D human body & hand parameterization (22 body joints + 15 finger joints per hand) | Drives the 3D body mesh (`mesh_exo.mp4`), knee/hip/elbow joint angle streams (`pose_timeseries.csv`), Gymify rep depth gauges, and 6-light stage choreography |
| **[Meta Muse Spark 1.3 (`muse-spark-1.3`)](https://dev.meta.ai/docs/quickstart)** | Multimodal vision-language brain across **9 pipeline & live stages** (`https://api.meta.ai/v1/responses`) | Reads both first-person POV frames and 3D MHR body renders to produce posture timelines, habit coaching, Gymify form feedback, Day Vibe music picks, and stage lighting scenes |
| **[Meta Llama 3.2 (`llama3.2:3b`)](https://ai.meta.com/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/)** | Local open-weights language model via [Ollama](https://ollama.com/library/llama3.2) | Provides 100% local, offline reasoning fallback when running without cloud connectivity (`MODEL_PROVIDER=ollama`) |
| **[Meta Ray-Ban Smart Glasses](https://www.meta.com/ai-glasses/)** | Wearable first-person capture (`--camera glasses` optical preset) | Captures hands-free POV video during daily routines, gym sets, dance practice, and outdoor activities |

---

## 2. All 9 Meta Muse Spark Integrations

Every **Meta Muse Spark** call is validated against a strict JSON schema with automatic retry and deterministic kinematic fallback:

| # | Stage | Module | Multimodal Inputs | Structured Output |
|---|---|---|---|---|
| **1** | **5s Scene Narration** | [`pipeline/describe_muse.py`](../pipeline/describe_muse.py) | 3 POV frames per 5 s window | Concise caption of what the wearer is doing every 5 seconds |
| **2** | **3D MHR Posture Classification** | [`director/posture_muse.py`](../director/posture_muse.py) | 1 3D MHR body render + 1 POV frame per 5 s | Labels posture (`walking`, `standing`, `sitting`, `crouching`, `bending`, `arms raised`) |
| **3** | **Routine & Habit Coaching** | [`director/routine_tips.py`](../director/routine_tips.py) | Posture log + captions + stats + 8 3D MHR frames | Session takeaway, timestamped posture adjustments, and cross-session comparison |
| **4** | **Gymify Workout Coach** | [`pipeline/gymify.py`](../pipeline/gymify.py) | 3D MHR frames + POV frames + per-rep joint angles | Exercise identification, confidence, per-rep coaching cues, and workout music style |
| **5** | **Movement-Synced Music & Day Vibe** | [`pipeline/songs.py`](../pipeline/songs.py) | Captions + ~20 s movement metrics | Activity label, ~20 s window musical genres, **Day Vibe** track, and **Play Next Time** picks |
| **6** | **Stage Lighting Designer** | [`vite.config.js`](../vite.config.js) | Live 3D MHR frame + movement summary + song | 6-fixture lighting palette, beat pattern (`pulse`, `chase`, `strobe`), and body-part focus |
| **7** | **Stagify Full-Show Planner** | [`src/stagify.js`](../src/stagify.js) | Per-10 s 3D MHR frames + movement summaries | Multi-scene lighting cue sheet (`stage.json`, `stage_cues.csv`) and soundtrack arc |
| **8** | **Agentic Show Director (Slow Loop)** | [`director/server.py`](../director/server.py) | Rolling 6 s kinematic summary | Target mood, energy level, lighting action, and BPM target |
| **9** | **Live Camera Captions** | [`vite.config.js`](../vite.config.js) | 2 live webcam/glasses frames (1 s apart) | Real-time activity caption and posture pill during live recording |

---

## 3. Quantitative Benchmarks

Evaluated on an NVIDIA GeForce RTX 4060 Laptop GPU (8 GB VRAM).

### 3D Body Reconstruction Accuracy (vs. OmniEgoDB Motion Capture, 13,737 Frames)

| Metric | `office` | `outdoor` | `robothome` | **LifeLens Mean** | Prior Baseline (20 seq.) |
|---|---|---|---|---|---|
| **Full-Body MPJPE (mm)** | 93.9 | 101.7 | 105.6 | **102.6 mm** | 111.7 mm |
| **3D Hand Error (mm)** | 159.0 | 110.0 | 135.0 | **134.0 mm** | 166.2 mm |
| **Motion Smoothness / Jerk (km/s³)** | 0.02 | 0.03 | 0.01 | **0.016 km/s³** | 0.073 km/s³ |

---

## 4. Open-Source Models, Libraries & APIs Linked

- **Meta AI Stack:**
  - [Meta Muse Spark (`muse-spark-1.3`)](https://dev.meta.ai/docs/quickstart)
  - [Meta SAM 3D Body (`sam-3d-body`)](https://ai.meta.com/sam2/)
  - [Meta MHR (Momentum Human Rig)](https://github.com/facebookresearch/momentum)
  - [Meta Llama 3.2 (`llama3.2:3b`)](https://ai.meta.com/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/) via [Ollama](https://ollama.com/library/llama3.2)
  - [Meta Ray-Ban Smart Glasses](https://www.meta.com/ai-glasses/)
- **3D Vision, SLAM & Kinematics:**
  - [OmniEgoCap](https://github.com/MiroPsota/OmniEgoCap) ([arXiv:2512.01290](https://arxiv.org/abs/2512.01290))
  - [HaWoR](https://github.com/ThunderVVV/HaWoR) ([arXiv:2501.02973](https://arxiv.org/abs/2501.02973))
  - [DROID-SLAM](https://github.com/princeton-vl/DROID-SLAM) ([arXiv:2108.10869](https://arxiv.org/abs/2108.10869))
  - [Metric3D v2](https://github.com/YvanYin/Metric3D) ([arXiv:2404.15506](https://arxiv.org/abs/2404.15506))
- **Music, Stage Lighting & Web Application:**
  - [ReccoBeats API](https://reccobeats.com/) & [Spotify IFrame API](https://developer.spotify.com/documentation/embeds)
  - [Art-Net DMX](https://art-net.org.uk/) & [Philips Hue Developer API](https://developers.meethue.com/)
  - [Vite 6](https://vite.dev/), [Node.js](https://nodejs.org/), and [FFmpeg](https://ffmpeg.org/)

