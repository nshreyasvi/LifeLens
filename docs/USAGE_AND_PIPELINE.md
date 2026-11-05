# Installation, Usage & 3D Pipeline Guide

Back to [Main README](../README.md) · See also: [UI & Features Guide](UI_GUIDE.md) · [Meta AI Models & Ecosystem](MODELS_AND_ECOSYSTEM.md) · [Technical Deep Dive](DEEP_DIVE.md)

---

## 1. Quick Start (Explore Included 3D Sessions — No GPU Needed)

The repository includes pre-processed first-person sessions (`eating`, `exercising`, `snowboard-strap-in`, `activities`) in [`examples/`](../examples) recorded on our head-mounted GoPro and processed into **3D Meta MHR body meshes**, joint kinematics, synced [ReccoBeats](https://reccobeats.com/) soundtracks, and **Meta Muse Spark** insights.

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- [Python](https://www.python.org/) 3.10+
- A [Meta Muse Spark API key](https://dev.meta.ai/docs/quickstart) (or local [Ollama](https://ollama.com/library/llama3.2) with **Meta Llama 3.2**)

### Setup Commands

```bash
git clone https://github.com/nshreyasvi/LifeLens.git
cd LifeLens
npm install

# Create the lightweight Python environment for the live director & Muse Spark tools
python -m venv director/venv
director/venv/bin/pip install -r director/requirements.txt   # Windows: director\venv\Scripts\pip install -r director/requirements.txt

# Configure your Meta Muse Spark API key
cp director/.env.example director/.env
```

Edit `director/.env`:

```ini
MUSE_API_KEY=your_meta_api_key_here
MUSE_MODEL=muse-spark-1.3
MUSE_REASONING=low
```

> [!TIP]
> Setting `MUSE_REASONING=low` reduces **Meta Muse Spark** latency from ~16 s to ~8 s while preserving structured JSON accuracy. For offline local inference with **Meta Llama 3.2**, set `MODEL_PROVIDER=ollama` and `OLLAMA_MODEL=llama3.2:3b`.

Start the studio server:

```bash
npm run dev
```

Open **`http://localhost:8000`** in your browser.

---

## 2. End-to-End Architecture (Meta MHR + Meta Muse Spark + ReccoBeats)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="architecture-pipeline-dark.svg">
    <img alt="LifeLens 3D Pipeline Architecture" src="architecture-pipeline.svg" width="920">
  </picture>
</p>

1. **Video Ingest & Lens Preset (`ingest`):** [FFmpeg](https://ffmpeg.org/) normalizes the input clip to 30 fps (up to 1920 px wide) and applies the optical profile for your wearable camera (`glasses`, `phone`, `gopro-linear`, or `gopro-wide`).
2. **3D Hands & Camera Trajectory ([`pipeline/hawor_export.py`](../pipeline/hawor_export.py)):** [HaWoR](https://github.com/ThunderVVV/HaWoR) recovers 3D wrists and 15 finger joints per hand in world space while [DROID-SLAM](https://github.com/princeton-vl/DROID-SLAM) tracks the 6-DoF head-camera path.
3. **Floor Plane & Metric Scale ([`pipeline/build_input.py`](../pipeline/build_input.py)):** Fits a gravity-aligned floor plane to the SLAM point cloud and scales the world using your height or [Metric3D v2](https://github.com/YvanYin/Metric3D) monocular depth.
4. **Full-Body 3D MHR Reconstruction ([`pipeline/run_omniegocap.py`](../pipeline/run_omniegocap.py)):** Combines **[Meta MHR (Momentum Human Rig)](https://github.com/facebookresearch/momentum)** and [OmniEgoCap](https://github.com/MiroPsota/OmniEgoCap) to reconstruct the full 22-joint 3D body and articulated 3D hands from first-person head and wrist trajectories.
5. **3D Mesh & Kinematics Stream Rendering ([`pipeline/render.py`](../pipeline/render.py)):** Produces the third-person **3D MHR body video** (`mesh_exo.mp4`), scrolling joint kinematics plot (`pose_graph.mp4`), side-by-side comparison (`side_by_side.mp4`), and per-frame joint CSV (`pose_timeseries.csv`).
6. **Multimodal Reasoning & Coaching:** **Meta Muse Spark 1.3** processes the POV frames, 3D MHR renders, and joint kinematics to generate 5 s scene narrations, posture classifications, Routine habit coaching, Gymify rep analysis, and 20 s movement-synced [ReccoBeats](https://reccobeats.com/) soundtracks.

---

## 3. Processing Your Own First-Person Videos (GPU Pipeline)

To reconstruct 3D MHR bodies from brand-new recordings, use Linux or Windows WSL2 with an NVIDIA GPU (8 GB+ VRAM, CUDA 12.6):

```bash
bash archive/scripts/setup.sh
```

### Recording Best Practices
- **Stand upright and still for the first 3 seconds** looking ahead so LifeLens can calibrate the head-mount tilt and metric floor height.
- **Keep some floor visible** (tilt 20–30° downward) and let your hands enter the frame naturally during movement.
- **Select the matching camera preset** in the UI or via `--camera`:

| Preset | CLI Flag | Horizontal FOV | Head-to-Lens Offset `(x, y, z)` | Best For |
|---|---|---|---|---|
| **Meta Ray-Ban Glasses** | `--camera glasses` | 80° | `(0.07, 0.06, 0.10)` m | Hands-free daily routines, meals, walks, workouts |
| **Phone on Head Strap** | `--camera phone` | 69.4° | `(0.00, 0.14, 0.13)` m | Smartphone head mounts (1× main lens) |
| **GoPro (Linear Lens)** | `--camera gopro-linear` | 92° | `(0.00, 0.16, 0.12)` m | Action sports, gym sessions, outdoor motion (used in our benchmark tests) |
| **GoPro (Wide Lens)** | `--camera gopro-wide` | 116° | `(0.00, 0.16, 0.12)` m | Wide-FOV action clips (automatic barrel undistortion) |

### Run from the Studio UI or CLI

From the web UI, place your video in `recordings/`, click **Open a recording → Process**, pick your camera preset, and watch the 8-stage progress tracker. Or run directly from the CLI:

```bash
conda activate omniegocap
python pipeline/run.py recordings/my_clip.mp4 my_clip --camera glasses --height 1.78
```
