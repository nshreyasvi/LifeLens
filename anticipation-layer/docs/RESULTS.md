# Results: S04_office_3 (OmniEgoDB), 2026-10-31

One head-mounted GoPro clip, 231 s, office walking/sitting/hand tasks. Video only (no pose for
this clip), processed exactly as the live system would: 2 s windows every ~0.5 s, V-JEPA 2 ViT-L
on a GTX 1650 (4 GB). Not dance: this tests the pipeline and the claims, not the show use case.

## Speed

| | |
|---|---|
| V-JEPA 2 ViT-L, 8 frames, fp32 | **511 ms median per window** (401 windows) |
| Kinematics (video motion) | ~1 ms |
| 4K HEVC decode (one-off proxy) | 25 sampled frames/s after the decoder-side resize |

## 1. Does V-JEPA help predict energy peaks 1 s ahead?

`scripts/compare_anticipation.py runs/office`: 4-fold blocked CV over time, 3 seeds, 73 peaks.
A window "fires" when it predicts a peak within 1 s.

| model | recall | precision | F1 | lead | false alarms/min |
|---|---|---|---|---|---|
| fire on every window (floor) | 1.00 | 0.27 | 0.43 | 683 ms | 77 |
| rhythm/trend rule (live default) | 0.64 | 0.38 | **0.48** | 667 ms | 24 |
| GRU, kinematics | 0.72 | 0.36 | **0.48** | 667 ms | 34 |
| GRU, V-JEPA appearance | 0.35 | 0.29 | 0.32 | 600 ms | 23 |
| GRU, kinematics + V-JEPA appearance | 0.44 | 0.35 | 0.39 | 600 ms | 23 |
| GRU, kinematics + V-JEPA motion | 0.39 | 0.35 | 0.37 | 600 ms | 17 |

**No.** On this clip V-JEPA features make 1-s peak timing worse, and every method is only a
little better than firing blindly. Video-motion peaks while walking an office are mostly head
turns, which are close to unpredictable. The test that matters needs rhythmic performance
footage and pose energy.

## 2. Does V-JEPA recognise the activity? (few-shot prototypes, no training)

`scripts/eval_activity.py`, labels by eye in `data/labels/S04_office_3.json` (6 classes, 332
scored windows, transitions left unlabelled).

| descriptor | strict (leave-segment-out)* | chunked (10 s blocks, 2 s guard) | balanced (chunked) |
|---|---|---|---|
| majority class ("walking") | | 69% | 17% |
| V-JEPA appearance (mean-pooled) | 75% | 72% | 43% |
| V-JEPA motion (per-patch token change) | 76% | 71% | 37% |
| both | 75% | 72% | 43% |

\* only walking / standing / hands_task occur in ≥ 2 segments.

**Weak.** Barely above always saying "walking". Gesturing scores 35/37, but it happens at the only
poster wall, so it is most likely scenery, not gesture. Hand tasks 0/24 (wiping a board vs typing on a
laptop look nothing alike). The motion descriptor was a pre-stated hypothesis and it failed:
those vectors are nearly identical across windows (mean cosine 0.994). A post-hoc try with
standardised features did worse (60%), so we stopped tuning. Meta's own V-JEPA 2 evaluations
train an attentive probe over all tokens; that needs more labelled clips than one 4-minute video.

## 3. Does V-JEPA catch activity changes?

12 label changes; `transition.is_change` caught 6 (4 in an identical earlier run: GPU
non-determinism moves the threshold), precision 35% vs ~20% for random firing at the same rate.
**Somewhat**, better than chance, not reliable yet.

## What Member B can rely on today

- `kinematics.energy` / `phase` / `cadence_hz`: cheap, smooth, good for intensity and mood.
- `anticipation.eta_ms`: rhythm-rule quality (precision ~0.4). Use `prob >= 0.6`, or treat as a hint.
- `transition.is_change`: better than chance; debounce or confirm with energy.
- `activity.label`: needs a prototype bank per venue/performer; do not drive cues from it yet.

## Next

1. Rhythmic footage with pose: dance / workout clips (Ego-Exo4D dance, or our own recording with
   the glasses) plus Shrey's OmniEgoCap joints. This is where peaks are predictable.
2. Attentive probe on V-JEPA tokens once there are ≥ 20 labelled minutes.
3. Try V-JEPA 2.1 (dense features), and check whether any probe checkpoints in
   facebookresearch/vjepa2 (e.g. the EK100 anticipation probe) load on our tokens.

Reproduce: `make_proxy.py` → `run.py` → `eval_activity.py` → `compare_anticipation.py` →
`render_show.py` (commands in README).
