"""Show preview: what a light rig would do if it listened only to the Anticipation Layer.

Layout (1280x720):
  top-left      ego video + HUD (activity, phase, energy, next-hit countdown)
  top-right     virtual stage: 6 moving-head beams driven *only* by AnticipationFrames
  bottom-left   the JSON frame Member B is receiving right now
  bottom-right  timeline: energy, predicted hits (ahead of "now"), real peaks, scene changes

Honest timing: a frame is shown from t_end + latency_ms (when it would actually arrive),
and real peaks appear only once they are in the past. This is a reference consumer for
Members B/C, not their lighting logic.

    python scripts/render_show.py omniegodb/gopro/office_640.mp4 runs/office --out runs/office/show.mp4
"""

from __future__ import annotations

import argparse
import colorsys
import json
import math
import sys
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import av
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

from anticipation.heads.anticipation import find_peaks
from anticipation.io.video_source import read_video

W, H = 1280, 720
PW, PH = 640, 360
BG = (10, 11, 16)
PHASE_COLORS = {"calm": (90, 140, 255), "build": (255, 190, 60), "peak": (255, 70, 90),
                "release": (170, 120, 255), "steady": (80, 220, 170)}
HUES = [0.58, 0.08, 0.83, 0.33, 0.0, 0.15, 0.48, 0.70]


def font(name: str, size: int):
    try:
        return ImageFont.truetype(name, size)
    except OSError:
        return ImageFont.load_default(size)


F_MONO = font("consola.ttf", 13)
F_SMALL = font("segoeui.ttf", 13)
F_UI = font("seguisb.ttf", 16)
F_BIG = font("seguisb.ttf", 26)


class Stage:
    """Turns the latest AnticipationFrame into beam colour, intensity, motion and strobes."""

    def __init__(self):
        self.hue_of: dict[str, float] = {}
        self.hue = 0.58
        self.target_hue = 0.58
        self.level = 0.2
        self.phase_angle = 0.0
        self.strobe = 0.0
        self.banner = 0.0
        self.banner_text = ""

    def hue_for(self, label: str) -> float:
        if label not in self.hue_of:
            self.hue_of[label] = HUES[len(self.hue_of) % len(HUES)]
        return self.hue_of[label]

    def update(self, fr: dict | None, dt: float, hit_now: bool, change_now: bool):
        energy = fr["kinematics"]["energy"] if fr else 0.1
        phase = fr["kinematics"]["phase"] if fr else "calm"
        cadence = fr["kinematics"]["cadence_hz"] if fr else 0.0
        if fr:
            self.target_hue = self.hue_for(fr["activity"]["label"])
        if change_now:
            self.banner, self.banner_text = 1.0, "SCENE CHANGE"
        if hit_now:
            self.strobe = 1.0
        # hue glides along the short way round the colour wheel
        dh = (self.target_hue - self.hue + 0.5) % 1.0 - 0.5
        self.hue = (self.hue + dh * min(1.0, dt * 1.5)) % 1.0
        target = {"calm": 0.18, "steady": 0.45, "build": 0.6, "peak": 1.0, "release": 0.35}[phase]
        target = 0.5 * target + 0.5 * energy
        self.level += (target - self.level) * min(1.0, dt * 4)
        speed = 0.15 + (cadence if cadence > 0 else 0.4) * (0.3 + energy)
        self.phase_angle += 2 * math.pi * speed * dt * 0.5
        self.strobe = max(0.0, self.strobe - dt * 5)
        self.banner = max(0.0, self.banner - dt * 0.8)
        self.phase = phase
        self.energy = energy

    def draw(self) -> Image.Image:
        beams = Image.new("RGB", (PW, PH), (0, 0, 0))
        d = ImageDraw.Draw(beams, "RGBA")
        sat = 0.55 if self.phase == "peak" else 0.85
        r, g, b = (int(255 * c) for c in colorsys.hsv_to_rgb(self.hue, sat, 1.0))
        n = 6
        spread = 0.25 + 0.45 * self.energy
        width = 0.13 - 0.05 * (self.phase in ("build", "peak"))
        for i in range(n):
            x0 = PW * (i + 0.5) / n
            y0 = 38
            ang = math.sin(self.phase_angle + i * 1.1) * spread + (i - (n - 1) / 2) * -0.08
            length = PH - 50
            a = int(40 + 150 * self.level)
            for w_mul, a_mul in ((2.2, 0.25), (1.0, 1.0)):
                hw = width * w_mul
                p1 = (x0 + length * math.sin(ang - hw), y0 + length * math.cos(ang - hw))
                p2 = (x0 + length * math.sin(ang + hw), y0 + length * math.cos(ang + hw))
                d.polygon([(x0, y0), p1, p2], fill=(r, g, b, int(a * a_mul)))
            fx = x0 + length * math.sin(ang)
            d.ellipse([fx - 40, PH - 26, fx + 40, PH - 6], fill=(r, g, b, int(a * 0.8)))
        glow = beams.filter(ImageFilter.GaussianBlur(10))
        stage = ImageChops.add(glow, beams)
        stage = ImageChops.add(stage, Image.new("RGB", (PW, PH), BG))
        sd = ImageDraw.Draw(stage, "RGBA")
        sd.rectangle([0, 26, PW, 34], fill=(60, 62, 72))  # truss
        for i in range(n):
            x0 = PW * (i + 0.5) / n
            sd.rounded_rectangle([x0 - 9, 30, x0 + 9, 46], 3, fill=(30, 31, 38), outline=(110, 112, 125))
        if self.strobe > 0:
            stage = Image.blend(stage, Image.new("RGB", (PW, PH), (255, 255, 255)), self.strobe * 0.85)
            sd = ImageDraw.Draw(stage, "RGBA")
        sd.text((10, 6), "VIRTUAL STAGE  ·  driven only by AnticipationFrames", font=F_SMALL, fill=(200, 202, 215))
        if self.banner > 0:
            a = int(255 * min(1.0, self.banner * 1.5))
            tw = sd.textlength(self.banner_text, font=F_BIG)
            sd.rounded_rectangle([PW / 2 - tw / 2 - 14, 140, PW / 2 + tw / 2 + 14, 182], 8, fill=(0, 0, 0, a // 2))
            sd.text((PW / 2 - tw / 2, 143), self.banner_text, font=F_BIG, fill=(255, 255, 255, a))
        return stage


def draw_hud(img: Image.Image, fr: dict | None, t: float, next_hit: float | None):
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle([8, 8, 206, 30], 6, fill=(0, 0, 0, 150))
    d.text((16, 10), "Meta V-JEPA 2 · ViT-L · live", font=F_SMALL, fill=(255, 255, 255))
    d.text((PW - 70, 10), f"{t:6.1f} s", font=F_SMALL, fill=(255, 255, 255))
    if fr is None:
        return
    act = fr["activity"]
    kin = fr["kinematics"]
    d.rounded_rectangle([8, PH - 92, 330, PH - 8], 8, fill=(0, 0, 0, 165))
    label = act["label"].replace("_", " ")
    d.text((18, PH - 88), label.upper(), font=F_BIG, fill=(255, 255, 255))
    d.text((20 + d.textlength(label.upper(), font=F_BIG) + 8, PH - 77), f"{act['conf']:.0%}", font=F_UI,
           fill=(180, 182, 195))
    pc = PHASE_COLORS.get(kin["phase"], (200, 200, 200))
    d.rounded_rectangle([18, PH - 50, 108, PH - 28], 11, fill=pc + (230,))
    d.text((63 - d.textlength(kin["phase"].upper(), font=F_SMALL) / 2, PH - 48), kin["phase"].upper(),
           font=F_SMALL, fill=(15, 15, 20))
    d.text((118, PH - 49), "energy", font=F_SMALL, fill=(200, 202, 215))
    d.rounded_rectangle([168, PH - 45, 318, PH - 33], 6, fill=(255, 255, 255, 40))
    d.rounded_rectangle([168, PH - 45, 168 + 150 * kin["energy"], PH - 33], 6, fill=pc + (255,))
    cad = kin["cadence_hz"]
    d.text((18, PH - 25), f"rhythm {cad * 60:.0f} bpm" if cad > 0 else "no steady rhythm", font=F_SMALL,
           fill=(200, 202, 215))
    if next_hit is not None and 0 <= next_hit - t <= 1.2:
        left = next_hit - t
        cx, cy, rad = PW - 60, PH - 60, 38
        d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(0, 0, 0, 170))
        d.arc([cx - rad, cy - rad, cx + rad, cy + rad], -90, -90 + 360 * (1 - left / 1.2), fill=(255, 190, 60),
              width=5)
        d.text((cx - 22, cy - 22), "HIT IN", font=F_SMALL, fill=(255, 255, 255))
        d.text((cx - 24, cy - 6), f"{left * 1000:.0f}ms", font=F_UI, fill=(255, 190, 60))


def json_lines(fr: dict, width: int = 78) -> list[str]:
    """The frame as JSON, wrapped to fit the panel: scalars share lines, nested objects
    are inlined and wrapped, the embedding is abbreviated."""

    def val(v):
        if isinstance(v, float):
            v = round(v, 3)
        if isinstance(v, list):
            return "[" + ", ".join(val(x) for x in v) + "]"
        return json.dumps(v)

    def wrap(tokens, indent):
        out, cur = [], indent
        for tok in tokens:
            if len(cur) + len(tok) > width and cur.strip():
                out.append(cur.rstrip())
                cur = indent
            cur += tok + " "
        out.append(cur.rstrip())
        return out

    lines = ["{"]
    lines += wrap([f'"{k}": {val(fr[k])},' for k in ("version", "t_start", "t_end", "latency_ms", "source")], " ")
    for key in ("activity", "kinematics", "transition", "anticipation"):
        lines.append(f' "{key}": {{')
        lines += wrap([f'"{k}": {val(v)},' for k, v in fr[key].items()], "   ")
        lines.append(" },")
    emb = fr.get("embedding")
    lines.append(f' "embedding": {{"dim": {emb["dim"]}, "dtype": "{emb["dtype"]}", "b64": "{emb["b64"][:16]}…"}}'
                 if emb else ' "embedding": null')
    lines.append("}")
    return lines


def draw_json(fr: dict | None, idx: int, n_sent: int) -> Image.Image:
    img = Image.new("RGB", (PW, PH), (14, 15, 21))
    d = ImageDraw.Draw(img)
    d.text((12, 8), f"→ Member B   ws://:8765   frame #{n_sent}", font=F_UI, fill=(255, 255, 255))
    if fr is None:
        d.text((12, 40), "waiting for first window (2 s)…", font=F_MONO, fill=(150, 150, 160))
        return img
    lines = json_lines(fr)
    y = 34
    for line in lines:
        if y > PH - 16:
            break
        key_end = line.find(":")
        if key_end > 0 and line.strip().startswith('"'):
            d.text((14, y), line[: key_end + 1], font=F_MONO, fill=(130, 170, 255))
            d.text((14 + d.textlength(line[: key_end + 1], font=F_MONO), y), line[key_end + 1 :], font=F_MONO,
                   fill=(235, 220, 160))
        else:
            d.text((14, y), line, font=F_MONO, fill=(170, 172, 185))
        y += 14
    return img


def draw_timeline(t, et, ee, peaks, preds, changes, trans_t, trans_s, hits) -> Image.Image:
    img = Image.new("RGB", (PW, PH), (14, 15, 21))
    d = ImageDraw.Draw(img, "RGBA")
    past, fut = 20.0, 3.0
    x0, x1, y0, y1 = 14, PW - 14, 46, PH - 70

    def X(tt):
        return x0 + (tt - (t - past)) / (past + fut) * (x1 - x0)

    def Y(v):
        return y1 - v * (y1 - y0)

    d.text((12, 8), "timeline  ·  energy   ▼ predicted hit   ● real peak   | scene change", font=F_UI,
           fill=(255, 255, 255))
    d.rectangle([X(t), y0 - 6, x1, PH - 14], fill=(255, 255, 255, 10))
    d.text((X(t) + 4, y0 - 4), "future", font=F_SMALL, fill=(150, 150, 165))
    for c in changes:
        if t - past <= c <= t:
            d.line([X(c), y0, X(c), PH - 14], fill=(200, 120, 255, 160), width=2)
    m = (et >= t - past) & (et <= t)
    if m.sum() > 1:
        pts = list(zip(X(et[m]), Y(ee[m])))
        d.line(pts + [(pts[-1][0], y1), (pts[0][0], y1)], fill=(80, 220, 170, 40))
        d.polygon(pts + [(pts[-1][0], y1), (pts[0][0], y1)], fill=(80, 220, 170, 40))
        d.line(pts, fill=(80, 220, 170, 255), width=2)
    for p in peaks:
        if t - past <= p <= t:
            i = np.searchsorted(et, p)
            v = ee[min(i, len(ee) - 1)]
            d.ellipse([X(p) - 4, Y(v) - 4, X(p) + 4, Y(v) + 4], fill=(255, 255, 255))
    for p, prob in preds:
        if t - past <= p <= t + fut:
            a = int(110 + 145 * prob)
            d.polygon([(X(p) - 6, y0 - 14), (X(p) + 6, y0 - 14), (X(p), y0 - 4)], fill=(255, 190, 60, a))
    # scene-change score strip
    m = (trans_t >= t - past) & (trans_t <= t)
    if m.sum() > 1:
        base = PH - 20
        d.line(list(zip(X(trans_t[m]), base - 40 * trans_s[m])), fill=(200, 120, 255), width=2)
        d.text((x0, PH - 64), "scene-change score (V-JEPA)", font=F_SMALL, fill=(200, 120, 255))
    d.line([X(t), y0 - 6, X(t), PH - 14], fill=(255, 255, 255), width=2)
    d.text((X(t) - 13, PH - 16), "now", font=F_SMALL, fill=(255, 255, 255))
    landed, made = hits
    msg = f"predicted hits that landed (±0.5 s): {landed}/{made}"
    d.text((x1 - d.textlength(msg, font=F_SMALL) - 50, PH - 64), msg, font=F_SMALL, fill=(255, 190, 60))
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("run")
    ap.add_argument("--frames", help="frames file (default: frames_heldout.jsonl if present, else frames.jsonl)")
    ap.add_argument("--out")
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=None)
    args = ap.parse_args()

    run = Path(args.run)
    fpath = Path(args.frames) if args.frames else (
        run / "frames_heldout.jsonl" if (run / "frames_heldout.jsonl").exists() else run / "frames.jsonl")
    frames = [json.loads(line) for line in fpath.read_text().splitlines()]
    avail = np.array([f["t_end"] + f["latency_ms"] / 1000 for f in frames])
    x = np.load(run / "extras.npz", allow_pickle=False)
    et, ee = x["energy_t"], x["energy"]
    peaks = find_peaks(et, ee)
    preds_all = [(a, f["t_end"] + f["anticipation"]["eta_ms"] / 1000, f["anticipation"]["prob"])
                 for a, f in zip(avail, frames)
                 if f["anticipation"]["eta_ms"] is not None and f["anticipation"]["prob"] >= 0.5]
    changes_all = [(a, f["t_end"]) for a, f in zip(avail, frames) if f["transition"]["is_change"]]
    trans_t = np.array([f["t_end"] for f in frames])
    trans_s = np.array([f["transition"]["score"] for f in frames])
    print(f"{len(frames)} frames from {fpath.name}, {len(preds_all)} predicted hits, {len(peaks)} real peaks, "
          f"{len(changes_all)} scene changes")

    out_path = args.out or str(run / "show.mp4")
    out = av.open(out_path, mode="w")
    st = out.add_stream("libx264", rate=args.fps)
    st.width, st.height, st.pix_fmt = W, H, "yuv420p"
    st.time_base = Fraction(1, args.fps)
    st.options = {"crf": "21", "preset": "veryfast"}

    stage = Stage()
    last_t, n, fired_strobes, seen_changes = None, 0, set(), set()
    for t, img in read_video(args.video, target_fps=args.fps, max_side=PW):
        if t < args.start:
            continue
        if args.end is not None and t > args.end:
            break
        dt = 1.0 / args.fps if last_t is None else t - last_t
        last_t = t
        k = int(np.searchsorted(avail, t, side="right")) - 1
        fr = frames[k] if k >= 0 else None
        known = [(p, pr) for a, p, pr in preds_all if a <= t]
        # strobe when the time of a known prediction arrives (one strobe per 0.4 s)
        hit_now = False
        for p, _ in known:
            key = round(p / 0.4)
            if t - dt < p <= t and key not in fired_strobes:
                fired_strobes.add(key)
                hit_now = True
        change_now = False
        for a, c in changes_all:
            if a <= t and c not in seen_changes:
                seen_changes.add(c)
                change_now = True
        upcoming = [p for p, _ in known if p > t]
        next_hit = min(upcoming) if upcoming else None
        made = [p for p, _ in known if p <= t - 0.5]
        landed = sum(1 for p in made if np.any(np.abs(peaks - p) <= 0.5))
        stage.update(fr, dt, hit_now, change_now)

        canvas = Image.new("RGB", (W, H), BG)
        ego = Image.fromarray(img).resize((PW, PH))
        draw_hud(ego, fr, t, next_hit)
        canvas.paste(ego, (0, 0))
        canvas.paste(stage.draw(), (PW, 0))
        canvas.paste(draw_json(fr, k, k + 1), (0, PH))
        canvas.paste(draw_timeline(t, et, ee, peaks[peaks <= t], known, [c for a, c in changes_all if a <= t],
                                   trans_t[avail <= t], trans_s[avail <= t], (landed, len(made))), (PW, PH))
        vf = av.VideoFrame.from_ndarray(np.asarray(canvas), format="rgb24")
        vf.pts = n
        for pkt in st.encode(vf):
            out.mux(pkt)
        n += 1
        if n % (args.fps * 30) == 0:
            print(f"  rendered {t:6.1f} s", flush=True)
    for pkt in st.encode():
        out.mux(pkt)
    out.close()
    print(f"wrote {out_path} ({n} frames)")


if __name__ == "__main__":
    main()
