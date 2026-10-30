from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from pathlib import Path

from .features import FrameFeatures, fit_zones, zone_for

TIMESTAMP_TOLERANCE_S = 0.001
ACTIVITY_REQUIRED_COLUMNS = {"second", "label", "narration"}


@dataclass(frozen=True)
class Clip:
    name: str
    fps: float
    frames: list[FrameFeatures]
    source_dir: Path


def load_clip(path: str | Path) -> Clip:
    """Read LifeLens processed CSV output; no pose pipeline or GPU is used."""
    target = Path(path)
    if target.is_file():
        pose_path = target
        clip_dir = target.parent
    else:
        clip_dir = target
        pose_path = clip_dir / "pose_timeseries.csv"
    world_path = clip_dir / "kinematics" / "joints_world.csv"
    activity_path = clip_dir / "activity.csv"
    for required in (pose_path, world_path, activity_path):
        if not required.is_file():
            raise FileNotFoundError(f"required processed output is missing: {required}")
    with pose_path.open(newline="", encoding="utf-8") as f:
        pose = list(csv.DictReader(f))
    with world_path.open(newline="", encoding="utf-8") as f:
        world = list(csv.DictReader(f))
    with activity_path.open(newline="", encoding="utf-8") as f:
        activity_reader = csv.DictReader(f)
        activity_columns = set(activity_reader.fieldnames or ())
        activity = list(activity_reader)
    if not pose or not world:
        raise ValueError("pose and world-position files must contain rows")
    if len(pose) != len(world):
        raise ValueError(f"frame count mismatch: pose={len(pose)} positions={len(world)}")
    required_pose = {"time_s", "trunk_lean", "pelvis_height_m", "speed_m_s"}
    required_world = {"time_s", "pelvis_x", "pelvis_y"}
    if not required_pose.issubset(pose[0]) or not required_world.issubset(world[0]):
        raise ValueError("CSV headers do not match the inspected LifeLens output format")
    missing_activity = ACTIVITY_REQUIRED_COLUMNS - activity_columns
    if missing_activity:
        missing = ", ".join(sorted(missing_activity))
        raise ValueError(f"activity.csv missing required columns: {missing}")

    if "clip" in activity_columns:
        activity = [row for row in activity if row.get("clip") == clip_dir.name]
        if not activity:
            raise ValueError(
                f"activity.csv has a clip column but no rows for current clip '{clip_dir.name}'"
            )

    times: list[float] = []
    for index, (pose_row, world_row) in enumerate(zip(pose, world), start=1):
        try:
            pose_time = float(pose_row["time_s"])
            world_time = float(world_row["time_s"])
        except (KeyError, TypeError, ValueError, OverflowError) as exc:
            raise ValueError(f"invalid time_s at pose/world data row {index}") from exc
        if not math.isfinite(pose_time) or not math.isfinite(world_time):
            raise ValueError(f"non-finite time_s at pose/world data row {index}")
        if abs(pose_time - world_time) > TIMESTAMP_TOLERANCE_S:
            raise ValueError(
                f"timestamp mismatch at pose/world data row {index}: "
                f"pose time_s={pose_time:g}, joints_world time_s={world_time:g}; "
                f"tolerance is {TIMESTAMP_TOLERANCE_S:g}s"
            )
        times.append(pose_time)

    points = [(float(r["pelvis_x"]), float(r["pelvis_y"])) for r in world]
    centers = fit_zones(points)
    speeds = [max(0.0, float(row["speed_m_s"])) for row in pose]
    p95 = sorted(speeds)[min(len(speeds) - 1, int((len(speeds) - 1) * 0.95))]
    scale = max(p95, 0.01)
    by_second: dict[int, dict[str, str]] = {}
    for row_number, row in enumerate(activity, start=2):
        try:
            second = int(row["second"])
        except (KeyError, TypeError, ValueError, OverflowError) as exc:
            raise ValueError(
                f"activity.csv has an invalid second value on data row {row_number}"
            ) from exc
        by_second[second] = row
    if not by_second:
        raise ValueError(f"activity.csv has no activity rows for clip '{clip_dir.name}'")

    frames: list[FrameFeatures] = []
    for pose_row, point, speed, t in zip(pose, points, speeds, times):
        label_row = by_second.get(int(t), {})
        frames.append(FrameFeatures(
            time_s=t,
            zone=zone_for(point, centers),
            energy=min(1.0, speed / scale),
            speed_m_s=speed,
            pelvis_height_m=float(pose_row["pelvis_height_m"]),
            trunk_lean=float(pose_row["trunk_lean"]),
            posture_label=label_row.get("label", "unknown"),
            narration=label_row.get("narration", ""),
            floor_x=point[0],
            floor_y=point[1],
        ))
    deltas = [b.time_s - a.time_s for a, b in zip(frames, frames[1:]) if b.time_s > a.time_s]
    fps = 1.0 / (sum(deltas) / len(deltas)) if deltas else 30.0
    return Clip(name=clip_dir.name, fps=fps, frames=frames, source_dir=clip_dir)

