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
      t.disabled = live || (povMissing && name === 'body'); // live: no 3D body yet; no POV: it fills the main window
    }
    if (note) note.hidden = !povMissing;
  };

  // No POV file: the main window plays the 3D body instead, on the same clock.
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
    // Open these windows next to the POV (a tab's default); the toggles change them afterwards.
    show(names) { open = new Set(names); render(); align(); },
    shown() { return [...open]; },
    // Point the videos at a recording; a missing POV is replaced by the 3D body.
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
    // A live session: the camera is the POV.
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
