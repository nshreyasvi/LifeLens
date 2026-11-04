# Front-end: LifeLens beta (Vite)

## Run it

```
npm install
DIRECTOR_PYTHON=director/venv/bin/python npm run dev
```

Open http://localhost:8000: enter your name, then **New live session** or **Open a recording**.

- **New live session:** the camera is the POV. Every 6 s, Meta Muse Spark captions two frames and names the posture
  over the video. **Record** saves the clip to `recordings/`, and the dev server runs the pipeline on it. The 3D body,
  music and lights open when processing is done.
- **Open a recording:** one LifeLens has processed already (`runs/`, `examples/`), or a video in `recordings/`, which the
  dev server processes when you open it.

**Play** starts the director on the open recording, and the page follows it over `ws://127.0.0.1:8765`. **Pause**
stops it, and so does switching to Routine or going back to the start screen. Only Activity, Music and Stage play.

The header switch **Qwen3-VL | Muse Spark** picks whose 5 s captions the director reads and the Routine log shows.
The choice is remembered in this browser.

Everything needs the dev server (`vite.config.js`). A static `npm run build` has no recordings list, no processing,
no director and no live captions.

## Files

| File | What it does |
|---|---|
| `index.html` | start screen, header, the POV panel and rail (Activity, Music, Stage, shared player), Routine |
| `src/start.js` | start screen: name, recordings, processing status |
| `src/session.js` | the open recording, its kinematics, and the body features that music and lights read |
| `src/main.js` | director messages, Play / Pause, lights per body part, music targets, ReccoBeats songs, the Spotify player |
| `src/media.js`, `src/extras.js` | POV, 3D body and kinematics on one clock; tab panes; AI badge; theme |
| `src/live.js` | live session: camera as POV, Muse captions, record, upload, process |
| `src/day.js`, `src/day.css` | Routine: the log with Qwen or Muse captions, posture sources, the Muse review and what it read, history |
| `src/styles.css`, `src/extras.css` | styles and theme tokens (`docs/brand/palette.json`); Geist and Geist Mono are self-hosted |
| `vite.config.js` | `/api/recordings`, `/api/process`, `/api/live/start`, `/api/live/stop`, `/api/live/caption`; local requests only |
| `public/video/` | compressed 3D body and kinematics videos of the demos; `public/video/input/` (POV) is gitignored |
| `docs/brand/` | logo (SVG), palette with contrast ratios |

## Notes

- **Songs:** ReccoBeats, free and keyless.
  - The seed is ReccoBeats' top search result for the director's mood.
  - The targets (tempo, energy, danceability, valence, acousticness) come from the last 10 s of the 3D body.
- **Playback:** one Spotify embed, driven by Spotify's iFrame API.
  - It plays a 30 s preview, or the whole song when the browser is logged in to Spotify.
  - When a song ends, the newest list's first song plays next.
  - The stage lights pulse to the playing song's measured BPM.
- **API keys:** none in the front-end. Muse Spark runs in the director, the pipeline scripts and
  `/api/live/caption`, all of which read `director/.env`.
