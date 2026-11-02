# Front-end: Node.js (Vite) version

The LifeLens Live Panel now runs on Node.js using [Vite](https://vite.dev). It looks and behaves the same as before.

## Run it

```
npm install
npm run dev
```

Open http://localhost:8000. The page connects to the director at `ws://127.0.0.1:8765` (retries every 5 seconds) and shows **Live**. If no director is running it shows **Demo** and plays the sample data in `public/sample-data.json`.

Build a static copy with `npm run build` (output goes to `dist/`) and preview it with `npm run preview`.

## Files

- `index.html`: page markup (Vite entry)
- `src/main.js`: app logic (live connection, lights, music box)
- `src/styles.css`: styles
- `public/sample-data.json`: demo data
- `legacy/`: the original plain HTML version (no Node needed). Run `cd legacy && python3 -m http.server 8000`.

## Notes

- The music box asks ReccoBeats (free, no key) for songs that match the director's mood and tempo, and shows a Spotify player under each song. If ReccoBeats fails, sample songs are shown.
- No API keys or secrets are used anywhere in the front-end.
