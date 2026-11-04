# Graph Report - metahack_project  (2026-11-03)

## Corpus Check
- 104 files · ~448,099 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 64 file(s) not represented in the graph (top: .npy 18, .csv 17, .srt 12)

## Summary
- 723 nodes · 1382 edges · 74 communities (53 shown, 21 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.89)
- Token cost: 4,200 input · 850 output

## Community Hubs (Navigation)
- Live Panel UI (Vite)
- Legacy Front-End App
- Director Server & Summarizer
- Director Fast Loop & Freeze
- Kinematics & Stillness Rules
- Anticipation Predictors & Schemas
- 3D Mesh & Graph Renderer
- Node/Vite Package Config
- Pipeline Benchmarks & Tests
- Daily Routine UI Tab
- WebSocket Screen Publisher
- Director Slow Loop (Muse/Llama)
- POV Sync & Theme Extras
- Daily Posture Insights Engine
- Pipeline Orchestrator & Models
- Muse Spark Routine Tips
- HaWoR Hand & SLAM Export
- OmniEgoCap 3D Body Inference
- Music Tempo & Mood Mapping
- Qwen3-VL Video Narration
- Describe Anything (DAM) Runner
- Data & Artifacts (Cluster 21)
- Data & Artifacts (Cluster 22)
- Data & Artifacts (Cluster 23)
- Data & Artifacts (Cluster 24)
- Data & Artifacts (test_muse_request_uses)
- Data & Artifacts (.on_cancel())
- Data & Artifacts (describe_anything)
- Data & Artifacts (describe_anything)
- Data & Artifacts (describe_anything)
- SMPL-H to MHR Fitting
- Environment Setup Script
- Description Model Benchmark
- Data & Artifacts (streams)
- Data & Artifacts (streams)
- Data & Artifacts (streams)
- Floor Plane & Input Builder
- Data & Artifacts (narration)
- Data & Artifacts (narration)
- Data & Artifacts (narration)
- Data & Artifacts (stage_wall_s)
- Data & Artifacts (stage_wall_s)
- Data & Artifacts (stage_wall_s)
- Data & Artifacts (_extract_json())
- Data & Artifacts (manifest.json)
- Data & Artifacts (motion)
- Data & Artifacts (manifest.json)
- Data & Artifacts (motion)
- Data & Artifacts (manifest.json)
- Data & Artifacts (motion)
- Data & Artifacts (omniegocap)
- Data & Artifacts (omniegocap)
- Data & Artifacts (omniegocap)
- Data & Artifacts (demos.sh)
- Data & Artifacts (__init__.py)

## God Nodes (most connected - your core abstractions)
1. `frame()` - 32 edges
2. `FastLoop` - 31 edges
3. `StubPredictor` - 28 edges
4. `SlowLoop` - 27 edges
5. `SlowSuggestion` - 21 edges
6. `load_clip()` - 18 edges
7. `FrameFeatures` - 16 edges
8. `replay()` - 13 edges
9. `make_message()` - 12 edges
10. `ScreenPublisher` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Activity Tab UI Screenshot` --references--> `Activity, Stage & Day Tabs UI`  [EXTRACTED]
  docs/avi-activity.png → index.html
- `Stage Tab UI Screenshot` --references--> `Activity, Stage & Day Tabs UI`  [EXTRACTED]
  docs/avi-stage.png → index.html
- `gt_seconds()` --calls--> `label_seconds()`  [INFERRED]
  bench/compare_descriptions.py → pipeline/insights.py
- `gt_seconds()` --calls--> `pose_series()`  [INFERRED]
  bench/compare_descriptions.py → pipeline/render.py
- `main()` --calls--> `label_seconds()`  [INFERRED]
  bench/compare_descriptions.py → pipeline/insights.py

## Import Cycles
- None detected.

## Communities (74 total, 21 thin omitted)

### Community 0 - "Live Panel UI (Vite)"
Cohesion: 0.13
Nodes (43): animateTempo(), applyLiveMessage(), buildBulbs(), buildTimeline(), colorName(), connectLive(), createTimelineItem(), drawSongs() (+35 more)

### Community 1 - "Legacy Front-End App"
Cohesion: 0.14
Nodes (39): animateTempo(), applyLiveMessage(), buildBulbs(), buildTimeline(), connectLive(), createTimelineItem(), drawSongs(), enterDemo() (+31 more)

### Community 2 - "Director Server & Summarizer"
Cohesion: 0.10
Nodes (27): ArgumentParser, energy_word(), Map normalized director energy to the screen's shared low/medium/high words., make_message(), Any, _arg_parser(), Build a text-only, under-80-word current view for the slow model., summarize() (+19 more)

### Community 3 - "Director Fast Loop & Freeze"
Cohesion: 0.15
Nodes (27): Local speed stand-in: report freeze detection after a sustained stop from…, StubPredictor, FastLoop, frame(), test_cancel_threshold_is_capped_at_point_eight(), test_director_has_one_shared_still_speed_rule(), test_fast_loop_step_is_under_30ms(), test_fast_zone_color_is_not_replaced_by_model_color() (+19 more)

### Community 4 - "Kinematics & Stillness Rules"
Cohesion: 0.20
Nodes (14): collections, dataclasses, datetime, is_still_speed(), Use one speed comparison for the director's stillness checks., StageSense Director Spec, The front-end's sample fields plus director fields., ScreenMessage (+6 more)

### Community 5 - "Anticipation Predictors & Schemas"
Cohesion: 0.15
Nodes (12): BaseModel, AnticipationWebSocketPredictor, EnergyOnlyPredictor, Predictor, Any, Conservative fallback for absent upstream fields; it never uses pose speed., Tolerant parser; missing or weak upstream output falls back to energy only., Prediction (+4 more)

### Community 6 - "3D Mesh & Graph Renderer"
Cohesion: 0.18
Nodes (17): imageio_ffmpeg, imageio_v2, angle(), checkerboard(), graph_frames(), look_at(), pose_series(), ndarray (+9 more)

### Community 7 - "Node/Vite Package Config"
Cohesion: 0.11
Nodes (17): dependencies, @fontsource-variable/geist, @fontsource-variable/geist-mono, description, devDependencies, vite, name, private (+9 more)

### Community 8 - "Pipeline Benchmarks & Tests"
Cohesion: 0.18
Nodes (13): main(), OmniEgoCap latency on this GPU: real checkpoint, stand-in SMPL-H (same sizes),…, walk(), make(), Stand-in SMPL-H file for smoke tests and latency benchmarks only, while the…, fill_fingers: short gaps interpolated, long gaps eased to the clip's average…, long_low_is_sitting: a short crouch stays a crouch, a low bout of SIT_S seconds…, Check of hawor_export.align, which joins the SLAM pieces: a known similarity… (+5 more)

### Community 9 - "Daily Routine UI Tab"
Cohesion: 0.22
Nodes (17): LifeLens Vite Live Panel, capitalize(), CLIP_NAMES, clipName(), formatClock(), formatMinutes(), load(), parseCsv() (+9 more)

### Community 10 - "WebSocket Screen Publisher"
Cohesion: 0.18
Nodes (8): Any, Change filtered WebSocket output with a one-second heartbeat., replay(), ScreenPublisher, send_screen(), test_screen_publisher_filters_the_actual_emitted_stream(), run(), test_slow_reply_after_the_last_frame_reaches_the_end_message()

### Community 11 - "Director Slow Loop (Muse/Llama)"
Cohesion: 0.18
Nodes (11): Any, SlowLoop, test_bad_model_output_retries_once_then_keeps_last_good(), invalid(), run(), test_bad_model_reason_is_sanitized_before_any_terminal_log(), run(), test_missing_muse_key_falls_back_to_ollama_once_with_one_log_line() (+3 more)

### Community 12 - "POV Sync & Theme Extras"
Cohesion: 0.14
Nodes (13): Activity Tab UI Screenshot, Stage Tab UI Screenshot, Activity, Stage & Day Tabs UI, aiBadge, aiState, clipSeconds(), onMessage(), onState() (+5 more)

### Community 13 - "Daily Posture Insights Engine"
Cohesion: 0.17
Nodes (16): Day Posture Timeline Figure, Multi-Clip Day Insights Report, itertools, bouts(), label_seconds(), long_low_is_sitting(), main(), narration_at() (+8 more)

### Community 14 - "Pipeline Orchestrator & Models"
Cohesion: 0.17
Nodes (16): pil, body_mask(), fill_empty(), main(), ndarray, Region descriptions by NVIDIA's Describe Anything Model (DAM-3B-Video), per…, [(start_s, frames)]: RGB frames at TRACK_FPS and WIDTH, grouped by window., SAM 2 masks (bool HxW) of the object under the normalized point on frames[0],… (+8 more)

### Community 15 - "Muse Spark Routine Tips"
Cohesion: 0.19
Nodes (13): DamDescription, DamSelection, load_dam_descriptions(), Path, Load only the inspected DAM list shape: [{start_s, end_s, text}, ...]., select_dam_description(), Suggested music targets by validated stage mood; no music service is called., test_dam_selector_skips_truncated_sentences() (+5 more)

### Community 16 - "HaWoR Hand & SLAM Export"
Cohesion: 0.20
Nodes (13): main(), make_T(), End-to-end smoke test without HaWoR: fakes what the ingest, calibrate and hawor…, synth(), json, get_python(), iphone_focal(), main() (+5 more)

### Community 17 - "OmniEgoCap 3D Body Inference"
Cohesion: 0.16
Nodes (13): certifi, call_model_raw(), _muse_api_key_from_file(), muse_call_count(), muse_key_configured(), _ollama(), _prompt(), Read the Muse credential only from director/.env; never log its value. (+5 more)

### Community 18 - "Music Tempo & Mood Mapping"
Cohesion: 0.18
Nodes (12): conversion, mhr_mhr, main(), Narration of the ego video by a small local video LLM (Qwen3-VL-2B-Instruct):…, sampled_frames(), srt_time(), Fit Meta's MHR body model to OmniEgoCap's SMPL-H bodies with the fitter of…, pytorch_fitting (+4 more)

### Community 19 - "Qwen3-VL Video Narration"
Cohesion: 0.21
Nodes (12): csv, _distance(), fit_zones(), FrameFeatures, Fit three deterministic k-means centers to pelvis floor positions., zone_for(), Clip, load_clip() (+4 more)

### Community 20 - "Describe Anything (DAM) Runner"
Cohesion: 0.21
Nodes (13): SlowSuggestion, test_bpm_moves_no_more_than_ten_per_slow_step(), run(), suggest(), test_garbled_reason_rejects_ansi_reset_character_only(), test_model_tempo_is_kept_inside_its_mood_range(), run(), suggest() (+5 more)

### Community 21 - "Data & Artifacts (Cluster 21)"
Cohesion: 0.21
Nodes (13): omniegocap_core_inference, omniegocap_io_sequence, omniegocap_utils_paths, export_kinematics(), fill_fingers(), main(), ndarray, OmniEgoCap inference -> SMPL-H motion with HaWoR's finger poses, plus the… (+5 more)

### Community 22 - "Data & Artifacts (Cluster 22)"
Cohesion: 0.19
Nodes (12): cv2, gc, align(), main(), piece_points(), ndarray, HaWoR on the ego video -> camera trajectory and wrist poses for OmniEgoCap.…, T_world_cam (b - a, 4, 4) of frames [a, b): HaWoR's hawor_slam run on a folder… (+4 more)

### Community 23 - "Data & Artifacts (Cluster 23)"
Cohesion: 0.24
Nodes (9): director, _muse(), build_prompt(), main(), Routine suggestions from Meta Muse Spark for a LifeLens day report, compared…, totals_line(), routine_tips: the prompt carries today's log and the earlier days, and Muse's…, test_suggestions_are_written_with_earlier_days() (+1 more)

### Community 24 - "Data & Artifacts (Cluster 24)"
Cohesion: 0.27
Nodes (8): asyncio, bar(), display(), main(), One-line live view of the StageSense WebSocket., render(), run(), websockets

### Community 25 - "Data & Artifacts (test_muse_request_uses)"
Cohesion: 0.18
Nodes (3): test_muse_request_uses_certifi_ca_context(), test_ollama_request_uses_small_context_and_new_default_model(), fake_urlopen()

### Community 26 - "Data & Artifacts (.on_cancel())"
Cohesion: 0.24
Nodes (4): PendingCheck, Any, Publish a validated slow update; throttle color scene changes to 4 seconds., Synchronous per-frame state step; no model, socket, or disk calls.

### Community 27 - "Data & Artifacts (describe_anything)"
Cohesion: 0.20
Nodes (10): describe_anything, dam_s, model, point, sam2_s, window_s, windows, both (+2 more)

### Community 28 - "Data & Artifacts (describe_anything)"
Cohesion: 0.20
Nodes (10): describe_anything, dam_s, model, point, sam2_s, window_s, windows, both (+2 more)

### Community 29 - "Data & Artifacts (describe_anything)"
Cohesion: 0.20
Nodes (10): describe_anything, dam_s, model, point, sam2_s, window_s, windows, both (+2 more)

### Community 30 - "SMPL-H to MHR Fitting"
Cohesion: 0.22
Nodes (8): fit_coarse_to_fine(), interp(), main(), ndarray, Stand-in for smplx.SMPL: the converter's vertex-input path only reads…, Linear interpolation of each column of fp (K, D) from frames xp to frames x., MHR parameters on frames key: from scratch on every COARSE-th frame, then warm-…, SMPLTopology

### Community 31 - "Environment Setup Script"
Cohesion: 0.38
Nodes (9): clone(), mkenv(), setup_dam(), setup_hawor(), setup_mhr(), setup_omniegocap(), setup_vlm(), setup.sh script (+1 more)

### Community 32 - "Description Model Benchmark"
Cohesion: 0.33
Nodes (8): first_named(), gt_seconds(), main(), majority(), named(), Compare the video descriptions (Qwen narration, Describe Anything on ego / pose…, Per-second posture labels from the Xsens skeleton, by the same rules…, The posture named first: a single answer, so naming several postures earns no…

### Community 33 - "Data & Artifacts (streams)"
Cohesion: 0.22
Nodes (9): streams, dam_both, dam_ego, dam_pose, ego_video, mesh_video, narration, pose_graph (+1 more)

### Community 34 - "Data & Artifacts (streams)"
Cohesion: 0.22
Nodes (9): streams, dam_both, dam_ego, dam_pose, ego_video, mesh_video, narration, pose_graph (+1 more)

### Community 35 - "Data & Artifacts (streams)"
Cohesion: 0.22
Nodes (9): streams, dam_both, dam_ego, dam_pose, ego_video, mesh_video, narration, pose_graph (+1 more)

### Community 36 - "Floor Plane & Input Builder"
Cohesion: 0.29
Nodes (7): argparse, omniegocap_adapters_trajectory, floor_plane(), main(), ndarray, SLAM trajectory + wrists -> OmniEgoCap input: gravity-aligned z-up world, floor…, RANSAC plane with the most points within tol (m) that the cameras sit 0.9-2.2 m…

### Community 37 - "Data & Artifacts (narration)"
Cohesion: 0.25
Nodes (8): narration, fps, load_s, model, peak_gpu_mb, run_s, window_s, windows

### Community 38 - "Data & Artifacts (narration)"
Cohesion: 0.25
Nodes (8): narration, fps, load_s, model, peak_gpu_mb, run_s, window_s, windows

### Community 39 - "Data & Artifacts (narration)"
Cohesion: 0.25
Nodes (8): narration, fps, load_s, model, peak_gpu_mb, run_s, window_s, windows

### Community 40 - "Data & Artifacts (stage_wall_s)"
Cohesion: 0.25
Nodes (8): stage_wall_s, describe, describe_anything, hawor, ingest, insights, omniegocap, render

### Community 41 - "Data & Artifacts (stage_wall_s)"
Cohesion: 0.29
Nodes (7): stage_wall_s, describe, describe_anything, hawor, ingest, omniegocap, render

### Community 42 - "Data & Artifacts (stage_wall_s)"
Cohesion: 0.29
Nodes (7): stage_wall_s, describe, describe_anything, hawor, ingest, omniegocap, render

### Community 43 - "Data & Artifacts (_extract_json())"
Cohesion: 0.33
Nodes (5): _extract_json(), Any, Remove terminal escape sequences and control/format characters from log text., _safe_log_text(), test_model_json_parser_normalizes_literal_control_chars_in_strings()

### Community 44 - "Data & Artifacts (manifest.json)"
Cohesion: 0.33
Nodes (5): calibration, duration_s, fps, frames, realtime_factor

### Community 45 - "Data & Artifacts (motion)"
Cohesion: 0.33
Nodes (6): motion, kinematics, omniegocap_input, pose_timeseries, smplh, smplh_canonical

### Community 46 - "Data & Artifacts (manifest.json)"
Cohesion: 0.33
Nodes (5): calibration, duration_s, fps, frames, realtime_factor

### Community 47 - "Data & Artifacts (motion)"
Cohesion: 0.33
Nodes (6): motion, kinematics, omniegocap_input, pose_timeseries, smplh, smplh_canonical

### Community 48 - "Data & Artifacts (manifest.json)"
Cohesion: 0.33
Nodes (5): calibration, duration_s, fps, frames, realtime_factor

### Community 49 - "Data & Artifacts (motion)"
Cohesion: 0.33
Nodes (6): motion, kinematics, omniegocap_input, pose_timeseries, smplh, smplh_canonical

### Community 50 - "Data & Artifacts (omniegocap)"
Cohesion: 0.40
Nodes (5): omniegocap, load_s, optimization, peak_gpu_mb, runtime_s

### Community 51 - "Data & Artifacts (omniegocap)"
Cohesion: 0.40
Nodes (5): omniegocap, load_s, optimization, peak_gpu_mb, runtime_s

### Community 52 - "Data & Artifacts (omniegocap)"
Cohesion: 0.40
Nodes (5): omniegocap, load_s, optimization, peak_gpu_mb, runtime_s

## Knowledge Gaps
- **161 isolated node(s):** `demos.sh script`, `frames`, `fps`, `duration_s`, `ego_video` (+156 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 309 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Activity, Stage & Day Tabs UI` connect `POV Sync & Theme Extras` to `Live Panel UI (Vite)`, `Daily Routine UI Tab`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `SlowLoop` connect `Director Slow Loop (Muse/Llama)` to `Director Server & Summarizer`, `Kinematics & Stillness Rules`, `WebSocket Screen Publisher`, `Data & Artifacts (_extract_json())`, `Muse Spark Routine Tips`, `OmniEgoCap 3D Body Inference`, `Qwen3-VL Video Narration`, `Describe Anything (DAM) Runner`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `FastLoop` connect `Director Fast Loop & Freeze` to `Director Server & Summarizer`, `Kinematics & Stillness Rules`, `Anticipation Predictors & Schemas`, `WebSocket Screen Publisher`, `Qwen3-VL Video Narration`, `Data & Artifacts (.on_cancel())`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `FastLoop` (e.g. with `FrameFeatures` and `Prediction`) actually correct?**
  _`FastLoop` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `SlowLoop` (e.g. with `DamDescription` and `DamSelection`) actually correct?**
  _`SlowLoop` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `SlowSuggestion` (e.g. with `_ollama()` and `SlowLoop`) actually correct?**
  _`SlowSuggestion` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `demos.sh script`, `frames`, `fps` to the rest of the system?**
  _161 weakly-connected nodes found - possible documentation gaps or missing edges._