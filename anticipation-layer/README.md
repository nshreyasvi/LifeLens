# Anticipation Layer (Stream 2 · Member A)

Turns first-person video (+ optional 3D pose from OmniEgoCap) into a ~2 Hz stream of
**AnticipationFrames**: what the person is doing, how hard they are moving, whether the
activity just changed, and **when the next energy peak will land** — before it happens.

```
ego video ─► FrameRing (2 s window, 0.5 s stride, 8 fps)
               ├─► V-JEPA 2 ViT-L ─► pooled 1024-d ─► activity (prototypes) · transition · 64-d PCA
3D pose ─────► kinematics (Ek = ½Σv², velocity, cadence)  [video-motion fallback if no pose]
               └─► anticipation: rhythm → parabola trend → learned GRU (when trained)
                                   ─► AnticipationFrame JSON ─► WebSocket :8765 + frames.jsonl
```

## Setup (Windows, GTX 1650 / driver 462 → CUDA 11.8)

```powershell
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu118
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pytest
```

## Run

```powershell
# speed gate on this GPU
.venv\Scripts\python scripts\bench_latency.py

# demo video: left half of side_by_side.mp4 is the raw ego view
.venv\Scripts\python scripts\run.py --video ..\side_by_side.mp4 --crop 0 0 1120 720 --out runs\demo

# simulate live and stream to Member B
.venv\Scripts\python scripts\run.py --video ego.mp4 --realtime --ws 8765

# with Shrey's poses
.venv\Scripts\python scripts\run.py --video ego.mp4 --pose ego_pose.npz
```

Outputs per run: `frames.jsonl`, `extras.npz` (training data), `timeline.png`.

**Big camera files (4K GoPro etc.):** decode once into a small proxy, then run everything on it:
`scripts\make_proxy.py big.MP4 clip_640.mp4` (640 px, 15 fps).

## Evaluate and preview

```powershell
# does V-JEPA help predict peaks? rhythm rule vs GRU(kinematics) vs GRU(V-JEPA) vs GRU(both)
.venv\Scripts\python scripts\compare_anticipation.py runs\office --out runs\office\compare.json
# activity + scene-change accuracy against hand labels (held-out protocols, see script doc)
.venv\Scripts\python scripts\eval_activity.py runs\office data\labels\S04_office_3.json --bank models\office_bank.npz
# show preview: ego video | virtual stage driven by the frames | live JSON | timeline
.venv\Scripts\python scripts\render_show.py omniegodb\gopro\office_640.mp4 runs\office
# label a new clip by eye: 1 thumbnail per second
.venv\Scripts\python scripts\contact_sheet.py clip_640.mp4 --every 1 --offset 0.5 --cols 10 --width 192 --out sheet.png
```

**Few-shot activities:** list labelled clips in `labels.json`, then
`scripts\build_prototypes.py labels.json --out models` → pass `--prototypes models\prototypes.npz --projector models\projector.npz`.

**Learned anticipation:** `scripts\train_anticipation.py runs\a runs\b --out models\anticipation.pt`
(labels come from each run's own future energy; prints lead time), then `--learned models\anticipation.pt`.

## For Member B — consuming the stream

Mock stream (no GPU needed): `.venv\Scripts\python -m anticipation.service.mock_publisher --port 8765`

```python
import asyncio, json, websockets
from anticipation.schema import decode_embedding

async def main():
    async with websockets.connect("ws://localhost:8765") as ws:
        async for msg in ws:
            f = json.loads(msg)
            if f["anticipation"]["eta_ms"] is not None:
                print("peak in", f["anticipation"]["eta_ms"], "ms")  # schedule strobe / beat drop
            vec = decode_embedding(f["embedding"]) if f["embedding"] else None

asyncio.run(main())
```

| Field | Meaning |
|---|---|
| `t_start`, `t_end` | window covered (s, video time) |
| `latency_ms` | processing time for this window |
| `activity.label/conf/top3` | few-shot label (`unknown` until prototypes are built) |
| `kinematics.energy` | 0..1 movement energy, self-normalising per performer |
| `kinematics.velocity`, `cadence_hz` | mean speed, dominant rhythm |
| `kinematics.source` | `pose` (OmniEgoCap) or `video` (motion fallback) |
| `kinematics.phase` | show language for cues: `calm` · `build` · `peak` · `release` · `steady` (v1.1) |
| `transition.score/is_change` | 0..1 jump in V-JEPA space; `true` = activity changed |
| `anticipation.eta_ms/prob/method` | next energy peak in N ms (`null` = none within 1 s); `rhythm`/`trend`/`learned` |
| `embedding` | 64-d float16, base64 — use for similarity/retrieval, not for prompts |

## Pose input contract (from Shrey)

`.npz` with `joints` `(T, J, 3)` metres, plus `t` `(T,)` seconds **or** `fps`; optional
`joint_names` as a plain string array (no pickled objects — loaded with `allow_pickle=False`).
SMPL-X parameters must be converted to joint positions first.

## Honest limits

- V-JEPA runs in the **slow loop** (see `bench_latency.py` for this GPU's number); the
  fast <30 ms loop belongs to Member B using `kinematics.energy` directly.
- OmniEgoCap is sequence-level, so pose arrives late; live mode uses the video-motion fallback.
- "Anticipation" is reported with measured lead time (`train_anticipation.py`), not assumed.
