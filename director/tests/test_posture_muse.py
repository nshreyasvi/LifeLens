"""posture_muse: one label per 5 s window from Muse's reply; skipped or unknown labels become 'unknown'."""

import json
import shutil
from pathlib import Path

from director import posture_muse

OFFICE = Path(__file__).parents[2] / 'examples' / 'office'


def test_parse_reads_numbered_lines_and_rejects_other_labels():
    reply = '1: walking\n2) Sitting\n3. arms raised\n4: dancing\n'
    assert posture_muse.parse(reply, 5) == ['walking', 'sitting', 'arms raised', 'unknown', 'unknown']


def test_main_writes_one_label_per_window(tmp_path, monkeypatch):
    clip = tmp_path / 'office'
    clip.mkdir()
    for name in ('pose_timeseries.csv', 'narration_muse.json'):
        shutil.copy(OFFICE / name, clip / name)
    shutil.copytree(OFFICE / 'frames', clip / 'frames')       # office's real 3D body frames (pipeline/body_frames.py)
    sent = {'images': []}

    def fake_muse(prompt, max_calls, images=None):
        sent.setdefault('prompt', prompt)
        sent['images'].append(len(images))
        return '\n'.join(f'{i}: standing' for i in range(1, 100))

    monkeypatch.setattr(posture_muse, '_muse', fake_muse)
    posture_muse.main([str(clip)])
    out = json.loads((clip / 'posture_muse.json').read_text())
    assert len(out) == 17 and {w['label'] for w in out} == {'standing'}          # 83 s of office
    assert out[0]['start_s'] == 0 and out[-1]['start_s'] == 80
    assert '1. 0:00-0:05 · camera: Walk away' in sent['prompt'] and 'speed' not in sent['prompt']
    assert sent['images'] == [6, 6, 5]                        # one 3D body frame per window, 6 windows per call
