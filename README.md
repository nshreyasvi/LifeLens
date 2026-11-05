<p align="center">
  <img alt="LifeLens Banner" src="docs/brand/lifelens-banner.jpg" width="100%">
</p>

<h1 align="center">LifeLens</h1>

<p align="center">
  <b>Your whole body in 3D from a head camera — feedback for routine, training, music &amp; stage.</b>
</p>

<p align="center">
  <a href="https://dev.meta.ai/docs/quickstart"><img alt="Meta Muse Spark 1.3" src="https://img.shields.io/badge/Meta_AI-Muse_Spark_1.3-2B44E8?style=for-the-badge&logo=meta&logoColor=white"></a>
  <a href="https://github.com/facebookresearch/momentum"><img alt="Meta MHR" src="https://img.shields.io/badge/Meta_AI-MHR_(Momentum_Human_Rig)-4F67FF?style=for-the-badge&logo=meta&logoColor=white"></a>
  <a href="https://ollama.com/library/llama3.2"><img alt="Meta Llama 3.2" src="https://img.shields.io/badge/Meta_AI-Llama_3.2-172554?style=for-the-badge&logo=meta&logoColor=white"></a>
  <a href="https://github.com/MiroPsota/OmniEgoCap"><img alt="OmniEgoCap Open Source" src="https://img.shields.io/badge/Open_Source-OmniEgoCap_3D_Body-E04826?style=for-the-badge"></a>
  <a href="https://github.com/ThunderVVV/HaWoR"><img alt="HaWoR + DROID-SLAM + Metric3D" src="https://img.shields.io/badge/Open_Source-HaWoR_%2B_DROID--SLAM_%2B_Metric3D-1E2230?style=for-the-badge"></a>
  <a href="https://reccobeats.com/"><img alt="ReccoBeats Open Source" src="https://img.shields.io/badge/Open_Source-ReccoBeats_Music_AI-2B44E8?style=for-the-badge"></a>
  <a href="https://www.meta.com/ai-glasses/"><img alt="Tested with GoPro Head-Mount for Meta Ray-Ban" src="https://img.shields.io/badge/Wearable_POV-GoPro_Head--Mount_%E2%86%92_Meta_Ray--Ban-4F67FF?style=for-the-badge&logo=meta&logoColor=white"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT_Open_Source-1E2230?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="#why-lifelens">Why LifeLens</a> ·
  <a href="#video-demo">Video Demo</a> ·
  <a href="#dashboard--feedback-systems-overview">Dashboard Tour</a> ·
  <a href="#everyday-use-cases">Use Cases</a> ·
  <a href="#full-end-to-end-pipeline-architecture">Full Pipeline</a> ·
  <a href="#project-structure">Project Structure</a> ·
  <a href="#installation--quick-start">Quick Start</a> ·
  <a href="#documentation-hub">Docs Hub</a>
</p>

---

## Why LifeLens

Smart glasses like **[Meta Ray-Ban Glasses](https://www.meta.com/ai-glasses/)** and head-mounted cameras look *outward* at the world — they see your coffee cup, your desk, or the mountain ahead, **but they never see your own body**.

**LifeLens makes your unseen body visible and turns your daily motion into gentle, actionable feedback.**

- **Tested with a Head-Mounted GoPro to Replicate Meta Ray-Ban Smart Glasses:** Tested on real first-person recordings captured with a **head-mounted GoPro** configured to match the field of view and head motion of **Meta Ray-Ban Smart Glasses** (and compatible with phone head-mounts and wearable action cameras).
- **100% Open-Source 3D Body Reconstruction (`OmniEgoCap` + `Meta MHR`):** Uses open-source **[OmniEgoCap](https://github.com/MiroPsota/OmniEgoCap)**, **[HaWoR](https://github.com/ThunderVVV/HaWoR)**, **[DROID-SLAM](https://github.com/princeton-vl/DROID-SLAM)**, and **[Metric3D v2](https://github.com/YvanYin/Metric3D)** paired with **[Meta MHR (Momentum Human Rig)](https://github.com/facebookresearch/momentum)** to reconstruct your **full 22-joint 3D body and 30-joint hands** in world space from a single head-mounted camera.
- **Activity, Effectiveness & Mood Understanding (`Meta Muse Spark 1.3`):** **[Meta Muse Spark 1.3](https://dev.meta.ai/docs/quickstart)** (with **[Meta Llama 3.2](https://ollama.com/library/llama3.2)** for offline local mode) inspects **both your first-person activity images and your 3D MHR body renders** to understand **what activity you were doing**, **how effective your movement was**, and **how you feel** — powering **better daily routines and a more relaxed life**, **better training**, **mood-matched music via open-source [ReccoBeats](https://reccobeats.com/)**, and **dance choreography & stage performance**.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-wordmark-on-dark.svg">
    <img alt="LifeLens Logo" src="docs/brand/logo-wordmark.svg" width="240">
  </picture>
</p>

---

## Video Demo

<p align="center">
  <a href="docs/lifelens-demo.mp4">
    <img alt="Watch the full LifeLens Demo Video (with voiceover)" src="docs/lifelens-demo.gif" width="920">
  </a>
  <br/>
  <sub>🎬 Click the animated preview above to watch <a href="docs/lifelens-demo.mp4"><b>docs/lifelens-demo.mp4</b></a> (full 3-minute HD walkthrough with voiceover).</sub>
</p>

---

## Dashboard & Feedback Systems Overview

> Click any scrolling dashboard preview below to watch its `.mp4` video. Full walkthrough: **[`docs/UI_GUIDE.md`](docs/UI_GUIDE.md)**

| 🧭 Routine Feedback System Dashboard | 🏋️ Gymify Training Feedback System UI |
|---|---|
| <a href="docs/media/routine-feedback.mp4"><img alt="Routine Feedback System Dashboard" src="docs/media/routine-feedback.gif" width="460"></a> | <a href="docs/media/gym-feedback.mp4"><img alt="Gymify Training Feedback System Dashboard" src="docs/media/gym-feedback.gif" width="460"></a> |
| **[Watch `routine-feedback.mp4`](docs/media/routine-feedback.mp4)** — Synchronized camera view, 3D Meta MHR body, posture breakdown, clickable 5s photo timeline, and relaxed-life habit feedback. | **[Watch `gym-feedback.mp4`](docs/media/gym-feedback.mp4)** — Automatic exercise recognition, `136°` 3D MHR squat depth & symmetry bars, and clickable per-rep feedback cards. |

| 🎵 Open-Source ReccoBeats Music & Day Vibe Dashboard | 💃 Dance Choreography & 6-Light Stage Dashboard |
|---|---|
| <a href="docs/media/music-dayvibe.mp4"><img alt="ReccoBeats Music & Day Vibe Dashboard" src="docs/media/music-dayvibe.gif" width="460"></a> | <a href="docs/media/stage-choreography.mp4"><img alt="Dance Choreography & Stage Dashboard" src="docs/media/stage-choreography.gif" width="460"></a> |
| **[Watch `music-dayvibe.mp4`](docs/media/music-dayvibe.mp4)** — Video-synced song windows powered by open-source **ReccoBeats**, plus **Day Vibe in a Song** and **Play Next Time** picks. | **[Watch `stage-choreography.mp4`](docs/media/stage-choreography.mp4)** — 6 virtual stage lights driven by your 3D MHR limb velocities for dance choreography and DMX / Hue stage shows. |

---

## Everyday Use Cases

| Everyday Use Case | How Meta Muse Spark + Meta MHR + Open-Source Models Help You |
|---|---|
| 🌿 **Routine Feedback System & A More Relaxed Life** | **Meta Muse Spark** looks at your first-person activity images and your **3D Meta MHR body** every 5 seconds to recognize what you are doing, measure posture balance (`Sitting`, `Standing`, `Crouching`, `Reaching`), and advise you based on how you feel — helping you spot tension, take mindful breaks, and live a calmer, more relaxed life. |
| 🏋️ **Better Training (`Gymify` Feedback System)** | Evaluates **what exercise you are performing and how effective each rep is** directly from your 3D MHR joints and images — tracking `136°` squat knee flexion, hip hinge, rep tempo, and left–right symmetry with visual per-rep feedback cards. |
| 🎵 **Mood-Matched Music & Day Vibe (`ReccoBeats`)** | Uses open-source **[ReccoBeats](https://reccobeats.com/)** audio feature matching to lock your video and music player in sync across movement windows and curates **Your Day Vibe in a Song** plus tracks to **Play Next Time You're Doing Similar Tasks**. |
| 💃 **Dance Choreography & Stage Performance (`Stagify`)** | Places your **3D MHR body** on a 6-light virtual stage where each spotlight reacts to your left/right arms, legs, torso, and pace — letting dancers and performers rehearse choreography and export live cues to [Art-Net DMX](https://art-net.org.uk/) & [Philips Hue](https://developers.meethue.com/). |

---

## Full End-to-End Pipeline Architecture

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/architecture-pipeline-dark.svg">
    <img alt="LifeLens Full End-to-End Pipeline Architecture" src="docs/architecture-pipeline.svg" width="960">
  </picture>
  <br/>
  <sub>Mermaid source: <a href="figures/lifelens-full-pipeline.mmd"><code>figures/lifelens-full-pipeline.mmd</code></a> · High-res PNG: <a href="figures/lifelens-full-pipeline.png"><code>figures/lifelens-full-pipeline.png</code></a></sub>
</p>

---

## Included 3D MHR Sessions (`examples/`)

| Session | Activity | Duration | Highlights |
|---|---|---|---|
| **`eating`** | Seated Meal & Hand Gestures | 27 s | **[Watch `side_by_side.mp4`](examples/eating/side_by_side.mp4)** · High-visibility 3D hand & wrist reconstruction (`HaWoR` + `Meta MHR`) and relaxed seated posture feedback |
| **`exercising`** | Full-Body Bodyweight Squats | 35 s | **[Watch `side_by_side.mp4`](examples/exercising/side_by_side.mp4)** · **Gymify** automatic squat detection, `136°` peak knee flexion, and per-rep effectiveness feedback |
| **`snowboard-strap-in`** | Mountain Snowboard Binding Strap-In | 35 s | **[Watch `side_by_side.mp4`](examples/snowboard-strap-in/side_by_side.mp4)** · Ground-level crouch & forward reach reconstruction (`OmniEgoCap` + `Meta MHR`) |

---

## Project Structure

```text
LifeLens/
├── src/                  # Frontend Studio UI (Routine, Gymify, ReccoBeats Music, 6-Light Stage)
├── server/               # Hardware Art-Net DMX, Philips Hue & session replay backend
├── director/             # Agentic Director & Meta Muse Spark fast/slow loops + posture feedback
├── pipeline/             # 3D MHR + OmniEgoCap + HaWoR + DROID-SLAM + Metric3D + Muse Spark pipeline
├── scripts/              # One-command GPU environment setup (scripts/setup.sh)
├── examples/             # Pre-processed 3D MHR sessions (eating, exercising, snowboard-strap-in)
├── figures/              # Full-pipeline Mermaid diagrams (.mmd, .md, .png)
├── docs/                 # Documentation hub, brand assets, and scrolling dashboard previews
├── bench/                # Real-time FPS & latency benchmarks
├── index.html            # Studio entry point
└── vite.config.js        # Vite server & local API routes
```

---

## Installation & Quick Start

You can explore all three 3D MHR sessions (`eating`, `exercising`, `snowboard-strap-in`) **immediately on any laptop — no GPU required**.

### 1. Clone & Install

```bash
git clone https://github.com/nshreyasvi/LifeLens.git
cd LifeLens
npm install

# Set up the Python environment for the live director & Meta Muse Spark
python -m venv director/venv
director/venv/bin/pip install -r director/requirements.txt   # Windows: director\venv\Scripts\pip install -r director/requirements.txt
```

### 2. Configure Meta Muse Spark (or Local Meta Llama 3.2)

```bash
cp director/.env.example director/.env
```

Add your [Meta Muse Spark API key](https://dev.meta.ai/docs/quickstart) to `director/.env` (or set `MODEL_PROVIDER=ollama` to run **[Meta Llama 3.2](https://ollama.com/library/llama3.2)** locally offline):

```ini
MUSE_API_KEY=your_meta_api_key_here
MUSE_MODEL=muse-spark-1.3
MUSE_REASONING=low
```

### 3. Launch LifeLens Studio

```bash
npm run dev
```

Open **`http://localhost:8000`** in your browser.

> **Want to run the 3D GPU pipeline on your own GoPro or Meta Ray-Ban videos?** See **[`docs/USAGE_AND_PIPELINE.md`](docs/USAGE_AND_PIPELINE.md)** for one-command WSL2 / Linux CUDA setup (`bash scripts/setup.sh`) and camera presets (`glasses`, `gopro-linear`, `gopro-wide`, `phone`).

---

## Documentation Hub

| Guide | What It Covers |
|---|---|
| 🖥️ **[UI & Feedback Systems Guide (`docs/UI_GUIDE.md`)](docs/UI_GUIDE.md)** | Scrolling dashboard walkthrough of the **Routine Feedback System**, **Gymify Training Feedback System**, **ReccoBeats Music + Day Vibe**, and **Dance Choreography & Stage Show**. |
| ⚙️ **[Usage & 3D Pipeline Guide (`docs/USAGE_AND_PIPELINE.md`)](docs/USAGE_AND_PIPELINE.md)** | Step-by-step installation (`bash scripts/setup.sh`), camera calibration presets (**Head-Mounted GoPro** & **Meta Ray-Ban Glasses**), running `pipeline/run.py`, and hardware DMX / Hue lighting. |
| 🧠 **[Meta AI & Open-Source Models (`docs/MODELS_AND_ECOSYSTEM.md`)](docs/MODELS_AND_ECOSYSTEM.md)** | How **Meta MHR**, **Meta Muse Spark 1.3** (all 9 stages), **Meta Llama 3.2**, open-source **OmniEgoCap**, and open-source **ReccoBeats** work together, plus 3D MPJPE accuracy benchmarks (`102.6 mm`). |
| 🔬 **[Technical Deep Dive (`docs/DEEP_DIVE.md`)](docs/DEEP_DIVE.md)** | Calibration math, joint kinematics formulas, body-rhythm autocorrelation, and every output file schema. |

---

## Team

Built for the **Meta Global AI Developer Hackathon 2026**.

| Member | Role |
|---|---|
| **Shrey** ([@nshreyasvi](https://github.com/nshreyasvi)) | Lead · 3D pipeline (Meta MHR, OmniEgoCap, HaWoR) · Meta Muse Spark integrations · Studio UI & design |
| **Dhruv** ([@Dhruv-Patil-1720](https://github.com/Dhruv-Patil-1720)) | Agentic Director: fast & slow loops, freeze detection, reactive flash, Muse Spark reasoning tuning |
| **Avi** ([@avinashmantripragada](https://github.com/avinashmantripragada)) | Front-end architecture: Vite app, live director sync, stage lights & music (ReccoBeats), routine feedback view |
| **Yash** | Research, testing on real head-mounted GoPro recordings, demo & submission support |

---

## Open Source License

**LifeLens is 100% open source under the [MIT License](LICENSE)** — there are **no non-commercial restrictions** on this repository, its studio application, the agentic director, the pipeline scripts, or our included example recordings and 3D MHR outputs in [`examples/`](examples). No restricted third-party weights or gated datasets are bundled in this repository.
