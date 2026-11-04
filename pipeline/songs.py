"""
Songs for a processed recording, picked while it is processed, so the Music and Stage tabs have them before Play.

python pipeline/songs.py --run runs/x        -> runs/x/songs.json

Rules:
- Clips under 10 s (< 10 s): too short to read a movement groove; writes too_short=True and no tracks so the UI
  displays a quirky note asking for a 10+ second clip.
- Clips 10-35 s (e.g. a 20-30 s clip): 1 section covering the whole clip, with 1 best-fitting song.
- Longer clips (> 35 s): cut into ~20 s sections, each with 1 best-fitting song matched to what happens in that
  20 s window and the 3D body's measured pace, rhythm, arm swing, and posture.
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
MIN_CLIP_S = 10.0
SINGLE_SONG_MAX_S = 35.0
RECCO = 'https://api.reccobeats.com/v1'
MOOD_VALENCE = {'calm': 0, 'curious': 0.05, 'joyful': 0.25, 'tense': -0.2, 'powerful': 0.15}
PROMPT = """You pick music for a recording of a person, filmed by a camera on their head. LifeLens measured their 3D body;
for each ~20 s window below you get its biomechanical numbers, postures, and what Meta Muse Spark saw in the video.
For every section, return:
- "what_happens": 4-9 words summarizing what the person is doing in that window,
- "style": 2-4 words describing the fitting music style (e.g. "cozy acoustic cafe", "upbeat indie warm-up", "driving workout hip-hop"),
- "mood": one of calm, curious, joyful, tense, powerful,
- "seed_songs": array of 4 well-known songs as {{"title": "exact song title", "artist": "main artist"}} that genuinely fit this exact activity, energy, and tempo,
- "why": one concise sentence explaining why this music fits what the person is doing in this 20 s window.
Also say what the person is doing over the whole recording ("activity": 1-4 words), and whether it is "active": true if they
exercise, stretch, play a sport, dance or perform; false for everyday tasks such as eating, desk work, chores or resting.
Answer with one JSON object only:
{{"activity": "1-4 words", "active": true or false, "sections": [{{"what_happens": "...", "style": "...", "mood": "...", "seed_songs": [{{"title": "...", "artist": "..."}}, ...], "why": "..."}}, ...]}}

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


def songs_for(style: str, t: dict, seed_songs: list | None = None, used_ids: set | None = None) -> list:
    used_ids = used_ids if used_ids is not None else set()
    seed_hits = []
    seen_seed_ids = set()

    # 1. Search by exact song title and verify artist match when provided
    for item in (seed_songs or []):
        title = (item.get('title') if isinstance(item, dict) else str(item or '')).strip()
        want_artist = (item.get('artist', '') if isinstance(item, dict) else '').strip().lower()
        if not title:
            continue
        try:
            found = recco('/track/search', {'searchText': title, 'size': 8}).get('content', [])
        except Exception:
            found = []
        valid = [h for h in found if h.get('id') and spotify_id(h.get('href'))]
        if want_artist:
            artist_matched = [h for h in valid if any(want_artist in a.get('name', '').lower() or a.get('name', '').lower() in want_artist
                                                      for a in h.get('artists', []))]
            if artist_matched:
                valid = artist_matched
        valid.sort(key=lambda h: -(h.get('popularity') or 0))
        for h in valid[:1]:
            if h['id'] not in seen_seed_ids and spotify_id(h.get('href')) not in used_ids:
                seen_seed_ids.add(h['id'])
                seed_hits.append(h)

    # 2. Fallback to style keywords if needed
    if not seed_hits and style:
        for words in (style, ' '.join(style.split()[-2:]), style.split()[-1]):
            try:
                found = recco('/track/search', {'searchText': words, 'size': 5}).get('content', [])
            except Exception:
                found = []
            valid = sorted([h for h in found if h.get('id') and spotify_id(h.get('href'))],
                           key=lambda h: -(h.get('popularity') or 0))
            if valid:
                seed_hits.extend(valid[:2])
                break

    if not seed_hits:
        return []

    params = {'size': 10, 'seeds': ','.join(h['id'] for h in seed_hits[:3]),
              **{k: f"{t[k]:.2f}" for k in ('energy', 'danceability', 'valence', 'acousticness', 'instrumentalness', 'loudness')}}
    if t.get('tempo'):
        params['tempo'] = t['tempo']
    try:
        recs = recco('/track/recommendation', params).get('content', [])
    except Exception:
        recs = []

    candidates = seed_hits + recs
    seen, out = set(), []
    for s in candidates:
        sid = spotify_id(s.get('href'))
        if s.get('trackTitle') and sid and sid not in seen and sid not in used_ids:
            seen.add(sid)
            out.append({'id': str(s['id']), 'name': s['trackTitle'], 'spotifyId': sid,
                        'artist': ', '.join(a.get('name', '') for a in s.get('artists', [])),
                        'popularity': int(s.get('popularity') or 0),
                        'is_seed': s in seed_hits})
    if not out:
        return []
    try:
        feats = {spotify_id(x.get('href')): x for x in recco('/audio-features', {'ids': ','.join(s['id'] for s in out[:12])}).get('content', [])}
    except Exception:
        feats = {}
    for s in out:
        x = feats.get(s['spotifyId'])
        s['tempo'] = round(x['tempo']) if x and x.get('tempo') else t.get('tempo')
        feat_dist = (abs(x['tempo'] - (t['tempo'] or x['tempo'])) / 60 + abs(x['energy'] - t['energy'])
                     + abs(x['valence'] - t['valence'])) if x else 0.9
        # Direct artist+title matches suggested by Muse Spark for this 20 s window get first priority
        seed_bonus = 0.55 if s.get('is_seed') else 0.0
        pop_bonus = min(0.35, (s.get('popularity') or 0) / 160.0)
        s['fit'] = round(max(0.01, feat_dist - seed_bonus - pop_bonus + 0.5), 3)
        s.pop('popularity', None)
        s.pop('is_seed', None)
    ranked = sorted(out, key=lambda s: s['fit'])
    if ranked:
        used_ids.add(ranked[0]['spotifyId'])
    return ranked[:3]


def main(a):
    t0 = time.time()
    run = a.run
    ts = np.genfromtxt(f'{run}/pose_timeseries.csv', delimiter=',', names=True)
    j = np.load(f'{run}/kinematics/joints_world.npy')
    limbs = j[:, [20, 21, 7, 8]]                                   # wrists and ankles: the body's rhythm
    motion = np.r_[0, np.linalg.norm(np.diff(limbs, axis=0), axis=2).sum(1) * FPS]
    n = int(len(ts))
    dur_s = n / FPS
    caps_path = f'{run}/narration_muse.json'
    caps = json.load(open(caps_path, encoding='utf-8')) if os.path.exists(caps_path) else []
    post_path = f'{run}/posture_muse.json'
    raw_p = json.load(open(post_path, encoding='utf-8')) if os.path.exists(post_path) else []
    postures = raw_p if isinstance(raw_p, list) else raw_p.get('windows', [])
    gym_path = f'{run}/gym.json'
    gym = json.load(open(gym_path, encoding='utf-8')) if os.path.exists(gym_path) else {}
    gym_ex = (gym.get('exercise') or {}).get('exercise', 'none')
    gym_reps = gym.get('reps') or []

    # Rule 1: If clip is under 10 seconds, do not pick songs — return quirky too_short payload
    if dur_s < MIN_CLIP_S:
        out = {
            'activity': 'brief moment',
            'active': False,
            'too_short': True,
            'duration_s': round(dur_s, 1),
            'quirky_title': 'Hold the drop — that was a blink, not a groove!',
            'quirky_note': (f'This clip is only {dur_s:.1f}s long. Our AI DJ barely put its headphones on before the tape '
                            'ran out! Give us at least 10–20 seconds of movement so we can read your pace and spin the right track.'),
            'sections': [],
            'model': os.getenv('MUSE_MODEL', 'muse-spark-1.3'),
            'runtime_s': round(time.time() - t0, 1),
        }
        json.dump(out, open(f'{run}/songs.json', 'w', encoding='utf-8'), indent=1)
        print(f"too_short ({dur_s:.1f} s < {MIN_CLIP_S:.0f} s): no songs picked", flush=True)
        return

    # Rule 2: If clip is 10-35 s (e.g. 20-30 s), use just 1 song for the whole clip; otherwise ~20 s sections
    k = 1 if dur_s <= SINGLE_SONG_MAX_S else max(1, round(dur_s / SECTION_S))
    bounds = [round(i * n / k) for i in range(k + 1)]
    sections, lines = [], []
    for i in range(k):
        s0, s1 = bounds[i] / FPS, bounds[i + 1] / FPS
        f = features(ts, motion, bounds[i], bounds[i + 1])
        said = ' '.join(c['text'] for c in caps if s0 <= c['start_s'] < s1 and not c['text'].startswith('['))
        pos_w = [w.get('posture') for w in postures if s0 <= w.get('start_s', -1) < s1 and w.get('posture')]
        reps_w = [r for r in gym_reps if r['bottom_s'] >= s0 and r['bottom_s'] <= s1]
        gym_info = f" Exercise in window: {len(reps_w)} {gym_ex} rep(s)." if reps_w and gym_ex != 'none' else ''
        pos_info = f" Postures: {', '.join(pos_w)}." if pos_w else ''
        rh = f"rhythm {round(f['rhythm']['bpm'])}/min ({round(100 * f['rhythm']['strength'])}%)" if f['rhythm'] else 'no rhythm'
        lines.append(f"{i + 1}. {s0:.0f}-{s1:.0f} s: pace {f['pace']:.2f} m/s, still {round(100 * f['still'])}%, arm swing "
                     f"{f['arm']:.0f} deg, upright {round(100 * f['upright'])}%, {rh}.{pos_info}{gym_info} Muse saw: {said or 'no caption'}")
        sections.append({'start_s': round(s0, 1), 'end_s': round(s1, 1), 'features': f, 'caption': said})

    answer = ask(muse_key(), PROMPT.format(sections='\n'.join(lines)), [], feature='songs')
    picks = answer.get('sections', [])
    used_ids = set()
    for sec, pick in zip(sections, picks + [{}] * len(sections)):
        mood = pick.get('mood', '') if pick.get('mood') in MOOD_VALENCE else 'calm'
        what_happens = str(pick.get('what_happens') or sec.get('caption') or answer.get('activity') or 'Movement window').strip()
        seed_songs = pick.get('seed_songs') if isinstance(pick.get('seed_songs'), list) else []
        sec.update(
            what_happens=what_happens,
            style=pick.get('style', ''),
            mood=mood,
            why=pick.get('why', ''),
            targets=targets(sec['features'], mood),
        )
        ranked = songs_for(sec['style'], sec['targets'], seed_songs=seed_songs, used_ids=used_ids) if sec['style'] else []
        sec['songs'] = ranked[:1]
        sec['fallbacks'] = ranked[1:]
        sec.pop('caption', None)

    out = {
        'activity': str(answer.get('activity', '')),
        'active': answer.get('active') is not False,
        'too_short': False,
        'duration_s': round(dur_s, 1),
        'sections': sections,
        'model': os.getenv('MUSE_MODEL', 'muse-spark-1.3'),
        'runtime_s': round(time.time() - t0, 1),
    }
    json.dump(out, open(f'{run}/songs.json', 'w', encoding='utf-8'), indent=1)
    print(f"activity: {out['activity']} (active: {out['active']}, {len(sections)} section(s))", flush=True)
    for sec in sections:
        top = sec['songs'][0] if sec['songs'] else None
        label = f"{top['name']} - {top['artist']} ({top.get('tempo') or '-'} BPM)" if top else 'no song'
        print(f"{sec['start_s']}-{sec['end_s']} s [{sec['what_happens']}]: {sec['style']} ({sec['mood']}) -> {label}".encode('ascii', 'replace').decode(), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    main(parser.parse_args())
