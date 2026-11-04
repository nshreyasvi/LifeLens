// LifeLens front-end: the POV video of a recording, always in the main window, with the 3D body and the kinematics
// graph that toggles open next to it. The 3D body video leads and the others follow its time, so a pane opens on
// the right frame. The POV itself has no toggle. In a live session the POV is the camera; there is no 3D body yet.
// A recording without a POV file on this machine (OmniEgoDB footage is never committed) plays the 3D body in the main
// window instead, and the note says why.

const DRIFT_S = 0.25; // re-align a follower that drifts further than this

export function mediaSet(root) {
  const video = (name) => root.querySelector(`[data-pane="${name}"] video`);
  const body = video('body');
  const pov = video('pov');
  const graph = video('graph');
  const followers = [pov, graph].filter(Boolean);
  const toggles = [...root.querySelectorAll('[data-toggle]')];
  const note = root.querySelector('.media-note');
  let open = new Set((root.dataset.open || '').split(' ').filter(Boolean));
  let povMissing = false;
  let live = false;

  const render = () => {
    root.classList.toggle('pov-missing', povMissing);
    root.classList.toggle('is-live', live);
    for (const pane of root.querySelectorAll('[data-pane]')) {
      const name = pane.dataset.pane;
      pane.hidden = name !== 'pov' && (live || !open.has(name) || (povMissing && name === 'body'));
    }
    for (const t of toggles) {
      const name = t.dataset.toggle;
      t.setAttribute('aria-pressed', String(!live && (open.has(name) || (povMissing && name === 'body'))));
      t.disabled = live || (povMissing && name === 'body');
    }
    if (note) note.hidden = !povMissing;
  };

  const standIn = () => {
    povMissing = true;
    pov.dataset.standIn = 'true';
    pov.src = body.getAttribute('src') || body.src;
    render();
  };

  const align = () => {
    for (const v of followers) {
      if (v.srcObject || !v.currentSrc) continue;
      if (v.readyState >= 1 && Math.abs(v.currentTime - body.currentTime) > DRIFT_S) v.currentTime = body.currentTime;
    }
  };

  for (const t of toggles) {
    t.addEventListener('click', () => {
      const name = t.dataset.toggle;
      if (!open.delete(name)) open.add(name);
      render();
      align();
    });
  }
  pov.addEventListener('error', () => { if (!pov.dataset.standIn && !pov.srcObject && pov.getAttribute('src')) standIn(); });
  pov.addEventListener('loadeddata', () => {
    if (pov.dataset.standIn || pov.srcObject) return;
    povMissing = false;
    render();
  });
  const play = (v) => v.play().catch(() => {});
  body.addEventListener('play', () => followers.forEach((v) => { if (!v.srcObject) play(v); }));
  body.addEventListener('pause', () => followers.forEach((v) => { if (!v.srcObject) v.pause(); }));
  body.addEventListener('seeked', align);
  body.addEventListener('timeupdate', align);
  render();

  return {
    body,
    pov,
    play() { play(body); },
    pause() { body.pause(); },
    seek(t) { if (Number.isFinite(body.duration) && t >= 0 && t < body.duration) body.currentTime = t; },
    show(names) { open = new Set(names); render(); align(); },
    shown() { return [...open]; },
    // Wipe any previously loaded video sources so old sessions never linger when switching to Live mode.
    clear() {
      live = true;
      povMissing = false;
      delete pov.dataset.standIn;
      for (const v of [pov, body, graph].filter(Boolean)) {
        v.pause();
        v.srcObject = null;
        v.removeAttribute('src');
        v.load();
      }
      render();
    },
    // Show the newly recorded clip immediately in the POV window while the 3D pipeline runs.
    setPreview(blobUrl) {
      live = true;
      povMissing = false;
      delete pov.dataset.standIn;
      for (const v of [body, graph].filter(Boolean)) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
      pov.srcObject = null;
      pov.src = blobUrl;
      play(pov);
      render();
    },
    setSources({ pov: povSrc, body: bodySrc, graph: graphSrc }) {
      live = false;
      body.pause();
      povMissing = false;
      delete pov.dataset.standIn;
      pov.srcObject = null;
      body.src = bodySrc;
      if (graph) graph.src = graphSrc || '';
      if (povSrc) pov.src = povSrc;
      else standIn();
      render();
    },
    setLive(stream) {
      live = true;
      povMissing = false;
      delete pov.dataset.standIn;
      for (const v of [body, graph].filter(Boolean)) { v.pause(); v.removeAttribute('src'); v.load(); }
      pov.removeAttribute('src');
      pov.srcObject = stream;
      play(pov);
      render();
    },
  };
}
