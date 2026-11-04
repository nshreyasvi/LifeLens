"""routine_tips: the prompt carries this recording's log and captions and the earlier recordings; Muse's JSON review
lands in insights.json, and a review without usable changes is refused."""

import json

import pytest

from director import routine_tips

TOTAL = {'duration_min': 1.38, 'minutes': {'walking': 0.45, 'standing': 0.87, 'sitting': 0.05},
         'walking_distance_m': 32.3, 'sit_stand_transitions': 1, 'longest_sitting_min': 0.05, 'bent_over_min': 0.0}
REVIEW = {'summary': 'A short office routine.', 'what_they_did': ['0:00-0:04: adjusts gloves (standing)'],
          'posture_and_movement': ['Walked 32.3 m.'], 'compared_with_history': ['Shorter than outdoor.'],
          'improvements': [{'change': 'Pause after pouring', 'why': '0:25 pouring', 'how': 'Set the cup down'}],
          'went_well': ['Kept moving.'], 'caveats': ['Legs are estimated.']}


def make_run(path, name):
    run = path / name
    run.mkdir()
    (run / 'insights.json').write_text(json.dumps({'total': TOTAL, 'log': f'Clip {name}:\n  walking 14 s. Walks.'}))
    (run / 'activity.csv').write_text('second,clip,label,narration\n0,x,standing,"Adjusts gloves."\n1,x,walking,"Walks."\n')
    (run / 'narration_muse.json').write_text(json.dumps([{'start_s': 0, 'end_s': 5, 'text': 'Adjust the gloves.'}]))
    return run


def test_review_is_written_with_history(tmp_path, monkeypatch):
    run, earlier = make_run(tmp_path, 'office'), make_run(tmp_path, 'outdoor')
    sent = {}

    def fake_muse(prompt, max_calls, images=None):
        sent['prompt'] = prompt
        return '```json\n' + json.dumps(REVIEW) + '\n```'

    monkeypatch.setattr(routine_tips, '_muse', fake_muse)
    routine_tips.main([str(run), '--history', str(earlier)])
    p = sent['prompt']
    assert 'walking 14 s' in p and '0:00 Adjust the gloves.' in p and '- outdoor: Recorded 1.38 min' in p
    saved = json.loads((run / 'insights.json').read_text())
    assert saved['report']['improvements'][0]['change'] == 'Pause after pouring'
    assert saved['report']['history'] == ['outdoor'] and saved['suggestions']['lines'] == ['Pause after pouring']


def test_review_without_changes_is_refused():
    with pytest.raises(ValueError):
        routine_tips.parse(json.dumps({**REVIEW, 'improvements': []}))
