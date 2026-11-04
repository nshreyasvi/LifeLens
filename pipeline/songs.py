"""
Songs for a processed recording, picked while it is processed, so the Music and Stage tabs have them before Play.

python pipeline/songs.py --run runs/x        -> runs/x/songs.json

The recording is cut into sections of about 20 s. For each, the body's numbers are measured as the Music tab measures
them live (src/session.js bodyFeatures): pace, time still, arm swing, how upright, and the rhythm of all four limbs
(src/session.js rhythmBpm). They give the song targets with the Music tab's formulas (src/main.js musicTargets). Meta
Muse Spark reads every section's numbers and its captions in one call and names a music style and mood per section;
ReccoBeats' top match for that style is the seed, and its recommendations near the targets are sorted by how close their
measured tempo, energy and mood are. The same call names the activity and whether it is active (exercise, sport,
dance) or an everyday task; the app shows Stage and Gym only for active recordings. The key is read from
director/.env, never printed.
"""

import argparse
import json
import os
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np

from gymify import ask, muse_key

FPS = 30
SECTION_S = 20
RECCO = 'https://api.reccobeats.com/v1'
MOOD_VALENCE = {'calm': 0, 'curious': 0.05, 'joyful': 0.25, 'tense': -0.2, 'powerful': 0.15}   # as in src/main.js
PROMPT = """You pick music for a recording of a person, filmed by a camera on their head. LifeLens measured their 3D body;
for each section below you get its numbers and what Meta Muse Spark saw in the video. For every section, name a music
style that fits what they are doing and how they move (2-4 words a song search would match, e.g. "upbeat indie pop",
"calm acoustic", "driving workout hip hop") and a mood from: calm, curious, joyful, tense, powerful.
Also say what the person is doing over the whole recording, and whether it is active: true if they exercise, play a
sport, dance or perform; false for everyday tasks such as eating, desk work, chores or resting.
Answer with one JSON object: {{"activity": "1-4 words", "active": true or false, "sections": [{{"style": "...",
"mood": "...", "why": "one short reason"}}, ...]}}, one section entry per section, in order.

{sections}"""


def clamp01(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


def rhythm_bpm(sig: np.ndarray, lo: float = 60, hi: float = 180):
    """The lag (as BPM) at which the signal best repeats: a true autocorrelation peak only (src/session.js rhythmBpm)."""
    if len(sig) < FPS * 4:
        return None
    x = sig - sig.mean()
    e = float((x * x).mean())
    if e < 1e-4:
        return None
    lag0, lag1 = round(FPS * 60 / hi), round(FPS * 60 / lo)
    lags = list(range(lag0 - 1, lag1 + 2))
    r = [float((x[lag:] * x[:-lag]).mean()) / e for lag in lags]
    peaks = [(r[k], lags[k]) for k in range(1, len(r) - 1) if r[k] >= r[k - 1] and r[k] > r[k + 1]]
    if not peaks:
        return None
    best_r, best_lag = max(peaks)
    return {'bpm': 60 * FPS / best_lag, 'strength': clamp01(best_r)}


def features(ts, motion: np.ndarray, a: int, b: int) -> dict:
    speed = ts['speed_m_s'][a:b]
    lean = float(np.mean(ts['trunk_lean'][a:b]))
    elbows = (ts['elbow_l'][a:b] + ts['elbow_r'][a:b]) / 2
    return {'pace': float(speed.mean()), 'still': float((speed < 0.08).mean()), 'arm': float(elbows.std()),
            'upright': clamp01(1 - lean / 40), 'rhythm': rhythm_bpm(motion[a:b])}


def targets(f: dict, mood: str) -> dict:
    """The song targets, with src/main.js musicTargets' formulas."""
    rhythm = f['rhythm'] if f['rhythm'] and f['rhythm']['strength'] > 0.3 else None
    return {'energy': clamp01(0.1 + 0.55 * min(f['pace'] / 1.2, 1) + 0.35 * min(f['arm'] / 20, 1)),
            'danceability': clamp01(0.2 + 0.7 * (rhythm['strength'] if rhythm else 0) + 0.1 * min(f['arm'] / 20, 1)),
            'valence': clamp01(0.25 + 0.45 * f['upright'] + MOOD_VALENCE.get(mood, 0)),
            'acousticness': clamp01(0.15 + 0.7 * f['still']), 'instrumentalness': clamp01(0.1 + 0.6 * f['still']),
            'loudness': -16 + 10 * clamp01(f['pace'] / 1.2),
            'tempo': round(rhythm['bpm']) if rhythm else None, 'tempo_from': 'body rhythm' if rhythm else ''}


def recco(path: str, params: dict) -> dict:
    req = Request(f'{RECCO}{path}?{urlencode(params)}', headers={'Accept': 'application/json', 'User-Agent': 'LifeLens/0.1'})
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def spotify_id(href) -> str:
    return href.split('/track/')[1][:22] if isinstance(href, str) and '/track/' in href else ''


def songs_for(style: str, t: dict) -> list:
    hits = []
    for words in (style, ' '.join(style.split()[-2:]), style.split()[-1]):     # shorter words when nothing matches
        hits = [h for h in recco('/track/search', {'searchText': words, 'size': 5}).get('content', []) if h.get('id')]
        if hits:
            break
    if not hits:
        return []
    params = {'size': 10, 'seeds': hits[0]['id'],
              **{k: f"{t[k]:.2f}" for k in ('energy', 'danceability', 'valence', 'acousticness', 'instrumentalness', 'loudness')}}
    if t['tempo']:
        params['tempo'] = t['tempo']
    seen, out = set(), []
    for s in recco('/track/recommendation', params).get('content', []):
        sid = spotify_id(s.get('href'))
        if s.get('trackTitle') and sid and sid not in seen:
            seen.add(sid)
            out.append({'id': str(s['id']), 'name': s['trackTitle'], 'spotifyId': sid,
                        'artist': ', '.join(a.get('name', '') for a in s.get('artists', []))})
    if not out:
        return []
    feats = {spotify_id(x.get('href')): x for x in recco('/audio-features', {'ids': ','.join(s['id'] for s in out)}).get('content', [])}
    for s in out:
        x = feats.get(s['spotifyId'])
        s['tempo'] = round(x['tempo']) if x else None
        s['fit'] = (abs(x['tempo'] - (t['tempo'] or x['tempo'])) / 60 + abs(x['energy'] - t['energy'])
                    + abs(x['valence'] - t['valence'])) if x else 9
    return sorted(out, key=lambda s: s['fit'])[:5]


def main(a):
    t0 = time.time()
    run = a.run
    ts = np.genfromtxt(f'{run}/pose_timeseries.csv', delimiter=',', names=True)
    j = np.load(f'{run}/kinematics/joints_world.npy')
    limbs = j[:, [20, 21, 7, 8]]                                   # wrists and ankles: the body's rhythm
    motion = np.r_[0, np.linalg.norm(np.diff(limbs, axis=0), axis=2).sum(1) * FPS]
    n = len(ts)
    k = max(1, round(n / FPS / SECTION_S))
    bounds = [round(i * n / k) for i in range(k + 1)]
    caps_path = f'{run}/narration_muse.json'
    caps = json.load(open(caps_path, encoding='utf-8')) if os.path.exists(caps_path) else []
    sections, lines = [], []
    for i in range(k):
        s0, s1 = bounds[i] / FPS, bounds[i + 1] / FPS
        f = features(ts, motion, bounds[i], bounds[i + 1])
        said = ' '.join(c['text'] for c in caps if s0 <= c['start_s'] < s1 and not c['text'].startswith('['))
        rh = f"rhythm {round(f['rhythm']['bpm'])}/min ({round(100 * f['rhythm']['strength'])}%)" if f['rhythm'] else 'no rhythm'
        lines.append(f"{i + 1}. {s0:.0f}-{s1:.0f} s: pace {f['pace']:.2f} m/s, still {round(100 * f['still'])}%, arm swing "
                     f"{f['arm']:.0f} deg, upright {round(100 * f['upright'])}%, {rh}. Muse saw: {said or 'no caption'}")
        sections.append({'start_s': round(s0, 1), 'end_s': round(s1, 1), 'features': f})
    answer = ask(muse_key(), PROMPT.format(sections='\n'.join(lines)), [], feature='songs')
    picks = answer.get('sections', [])
    for sec, pick in zip(sections, picks + [{}] * len(sections)):
        mood = pick.get('mood', '') if pick.get('mood') in MOOD_VALENCE else ''
        sec.update(style=pick.get('style', ''), mood=mood, why=pick.get('why', ''), targets=targets(sec['features'], mood))
        sec['songs'] = songs_for(sec['style'], sec['targets']) if sec['style'] else []
    # activity / active: Muse's read of the whole recording; the app shows Stage and Gym only for active ones
    out = {'activity': str(answer.get('activity', '')), 'active': answer.get('active') is not False, 'sections': sections,
           'model': os.getenv('MUSE_MODEL', 'muse-spark-1.3'), 'runtime_s': round(time.time() - t0, 1)}
    json.dump(out, open(f'{run}/songs.json', 'w', encoding='utf-8'), indent=1)
    print(f"activity: {out['activity']} (active: {out['active']})", flush=True)
    for sec in sections:
        print(f"{sec['start_s']}-{sec['end_s']} s: {sec['style']} ({sec['mood']}): "
              f"{', '.join(s['name'] for s in sec['songs'][:3]) or 'no songs'}", flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    main(parser.parse_args())
