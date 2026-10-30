"""
Narration of the ego video by a small local video LLM (Qwen3-VL-2B-Instruct): one sentence per window.

python pipeline/describe.py --run runs/x [--window 5] [--fps 2] [--model Qwen/Qwen3-VL-2B-Instruct]

Writes
    narration.json   [{start_s, end_s, text}, ...] on input.mp4's clock
    narration.srt    the same as subtitles: load it in a player next to input.mp4 or side_by_side.mp4
and lists both in manifest.json. Needs ~5 GB of VRAM, so it runs after the body pipeline, never alongside SLAM.
"""

import argparse
import json
import os
import time

import cv2
import torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor

PROMPT = ("This is first-person video from a camera on the wearer's head. In one short sentence starting with a verb, "
          "say what the camera wearer is doing.")
WIDTH = 448     # the model spends one token per 32x32 pixels per 2 frames: 448 px wide keeps a 5 s window ~600 tokens


def sampled_frames(path, fps):
    cap = cv2.VideoCapture(path)
    src_fps = cap.get(cv2.CAP_PROP_FPS)
    step, i = max(round(src_fps / fps), 1), 0
    while True:
        ok, img = cap.read()
        if not ok:
            return
        if i % step == 0:
            small = cv2.resize(img, (WIDTH, round(img.shape[0] * WIDTH / img.shape[1])), interpolation=cv2.INTER_AREA)
            yield i / src_fps, Image.fromarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))
        i += 1


def srt_time(s):
    ms = round(s * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def main(a):
    t0 = time.time()
    processor = AutoProcessor.from_pretrained(a.model)
    model = AutoModelForImageTextToText.from_pretrained(a.model, dtype=torch.bfloat16, device_map='cuda')
    load_s, t1 = time.time() - t0, time.time()

    windows, end = {}, 0.0
    for t, img in sampled_frames(f'{a.run}/input.mp4', a.fps):
        windows.setdefault(int(t // a.window), []).append(img)
        end = t + 1 / a.fps
    prompt = processor.apply_chat_template(
        [{'role': 'user', 'content': [{'type': 'video'}, {'type': 'text', 'text': PROMPT}]}], add_generation_prompt=True)
    narration = []
    for w, imgs in sorted(windows.items()):
        imgs += imgs[-1:] * (len(imgs) % 2)     # the model pairs frames in time
        meta = {'fps': a.fps, 'total_num_frames': len(imgs), 'frames_indices': list(range(len(imgs)))}  # timestamps
        inputs = processor(text=[prompt], videos=[imgs], video_metadata=[meta], do_sample_frames=False,
                           return_tensors='pt').to(model.device)
        ids = model.generate(**inputs, max_new_tokens=40, do_sample=False)
        text = processor.batch_decode(ids[:, inputs['input_ids'].shape[1]:], skip_special_tokens=True)[0].strip()
        narration.append({'start_s': w * a.window, 'end_s': round(min((w + 1) * a.window, end), 2), 'text': text})
        print(f"{narration[-1]['start_s']:6.1f} s  {text}", flush=True)
    run_s = time.time() - t1

    json.dump(narration, open(f'{a.run}/narration.json', 'w'), indent=1)
    with open(f'{a.run}/narration.srt', 'w') as f:
        for i, n in enumerate(narration, 1):
            f.write(f"{i}\n{srt_time(n['start_s'])} --> {srt_time(n['end_s'])}\n{n['text']}\n\n")
    manifest = f'{a.run}/manifest.json'
    if os.path.exists(manifest):
        m = json.load(open(manifest))
        m['streams']['narration'] = 'narration.srt'
        m['narration'] = {'model': a.model, 'window_s': a.window, 'fps': a.fps, 'windows': len(narration),
                          'load_s': round(load_s, 1), 'run_s': round(run_s, 1),
                          'peak_gpu_mb': round(torch.cuda.max_memory_allocated() / 2**20)}
        json.dump(m, open(manifest, 'w'), indent=2)
    print(f'{len(narration)} windows in {run_s:.1f} s (+{load_s:.1f} s loading)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--window', type=float, default=5.0, help='Seconds of video per sentence.')
    parser.add_argument('--fps', type=float, default=2.0, help='Frames per second shown to the model.')
    parser.add_argument('--model', default='Qwen/Qwen3-VL-2B-Instruct')
    main(parser.parse_args())
