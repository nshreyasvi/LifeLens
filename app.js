'use strict';

(() => {
  const DATA_URL = 'sample-data.json';
  const STEP_MS = 2000;
  const TEMPO_MIN = 60;
  const TEMPO_MAX = 180;

  // Brightness (0–1) for each energy level; "dim" scales it down further.
  const ENERGY_LEVEL = { low: 0.4, medium: 0.7, high: 1 };
  const ENERGY_ORDER = ['low', 'medium', 'high'];
  const DIM_FACTOR = 0.4;

  // "change_color" moves to the next color in this list.
  const PALETTE = [
    { name: 'Meta blue', hex: '#0866FF' },
    { name: 'Violet', hex: '#8B5CF6' },
    { name: 'Teal', hex: '#14B8A6' },
    { name: 'Amber', hex: '#F59E0B' },
    { name: 'Rose', hex: '#F43F5E' },
  ];

  const ACTION_LABELS = {
    flash_light: 'Flash light',
    dim: 'Dim',
    change_color: 'Change color',
  };

  const PHASE_LABELS = { activity: 'Activity', stage: 'Stage' };

  const LIGHT_NAMES = ['Living room', 'Kitchen', 'Desk', 'Hallway', 'Bedroom', 'Porch'];

  const $ = (id) => document.getElementById(id);
  const els = {
    error: $('error'),
    playBtn: $('play-btn'),
    playLabel: $('play-label'),
    pauseBtn: $('pause-btn'),
    pauseLabel: $('pause-label'),
    restartBtn: $('restart-btn'),
    progressLabel: $('progress-label'),
    progressFill: $('progress-fill'),
    tabs: $('tabs'),
    tabBtns: [...document.querySelectorAll('[role="tab"]')],
    views: [...document.querySelectorAll('[role="tabpanel"]')],
    activityView: $('view-activity'),
    energyChip: $('energy-chip'),
    energyValue: $('energy-value'),
    energySegs: [...document.querySelectorAll('#energy-meter .seg')],
    energyNote: $('energy-note'),
    timeline: $('timeline'),
    timelineCount: $('timeline-count'),
    ambient: $('ambient'),
    bulbs: $('bulbs'),
    lightsAction: $('lights-action'),
    lightsEnergy: $('lights-energy'),
    lightsBrightness: $('lights-brightness'),
    lightsSwatch: $('lights-swatch'),
    lightsColor: $('lights-color'),
    musicPanel: $('music-panel'),
    musicState: $('music-state'),
    beat: $('beat'),
    tempoValue: $('tempo-value'),
    tempoLabel: $('tempo-label'),
    tempoMeter: $('tempo-meter'),
  };

  // phase: 'idle' → 'activity' → 'stage' → 'done'
  const state = {
    messages: [],
    phase: 'idle',
    index: -1,
    playing: false,
    timer: null,
    pending: null, // the next step to run; kept while paused so Resume can continue
    colorIndex: 0,
    tempo: null,
    tempoFrame: null,
  };

  // ---------- Helpers ----------

  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const isRunning = () => state.phase === 'activity' || state.phase === 'stage';

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function isValidMessage(m) {
    return m
      && Object.hasOwn(ENERGY_LEVEL, m.energy)
      && Object.hasOwn(ACTION_LABELS, m.action)
      && Number.isFinite(m.music_tempo);
  }

  function tempoDescription(bpm) {
    if (bpm < 90) return 'Slow and relaxed';
    if (bpm < 120) return 'Moderate groove';
    if (bpm < 150) return 'Upbeat';
    return 'Fast and energetic';
  }

  // ---------- Tabs ----------

  function selectTab(name, { focus = false } = {}) {
    for (const btn of els.tabBtns) {
      const on = btn.dataset.tab === name;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      if (on && focus) btn.focus();
    }
    for (const view of els.views) view.hidden = view.dataset.view !== name;
    if (name === 'activity') scrollTimelineToCurrent();
  }

  function onTabKeydown(e) {
    const i = els.tabBtns.indexOf(document.activeElement);
    if (i === -1) return;
    const last = els.tabBtns.length - 1;
    const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(els.tabBtns[next].dataset.tab, { focus: true });
  }

  // ---------- Energy readout (Activity) ----------

  function renderEnergy(msg) {
    const level = ENERGY_ORDER.indexOf(msg.energy) + 1;
    els.energyValue.textContent = capitalize(msg.energy);
    els.energySegs.forEach((seg, i) => seg.classList.toggle('is-on', i < level));
    els.energyNote.textContent = `${msg.time ?? ''} · ${ACTION_LABELS[msg.action]}`;
  }

  // ---------- Timeline (Activity) ----------

  function buildTimeline() {
    els.timeline.innerHTML = '';
    for (const msg of state.messages) {
      const li = document.createElement('li');
      li.className = 'tl-item is-pending';
      li.innerHTML = `
        <span class="tl-dot" aria-hidden="true"></span>
        <div>
          <div class="tl-row">
            <span class="tl-action">${ACTION_LABELS[msg.action]}</span>
            <time>${msg.time ?? ''}</time>
          </div>
          <div class="tl-meta">
            <span class="energy energy-${msg.energy}">${capitalize(msg.energy)} energy</span>
            <span>${msg.music_tempo} BPM</span>
          </div>
        </div>`;
      els.timeline.appendChild(li);
    }
    els.timeline.scrollTop = 0;
  }

  // Items before `current` are done, `current` is highlighted, the rest are pending.
  function renderTimeline(current) {
    const items = els.timeline.children;
    for (let i = 0; i < items.length; i++) {
      const li = items[i];
      li.classList.toggle('is-done', i < current);
      li.classList.toggle('is-current', i === current);
      li.classList.toggle('is-pending', i > current);
      if (i === current) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    }
    scrollTimelineToCurrent();
  }

  // Keep the current item centered inside the list without scrolling the page.
  function scrollTimelineToCurrent() {
    if (els.activityView.hidden || state.phase !== 'activity') return;
    const current = els.timeline.children[state.index];
    if (!current) return;
    const top = current.offsetTop - els.timeline.clientHeight / 2 + current.offsetHeight / 2;
    els.timeline.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
  }

  // ---------- Lights (Stage) ----------

  function buildBulbs() {
    els.bulbs.innerHTML = '';
    for (const name of LIGHT_NAMES) {
      const light = document.createElement('div');
      light.className = 'light';
      light.innerHTML = `<div class="bulb"></div><span class="light-name">${name}</span>`;
      els.bulbs.appendChild(light);
    }
  }

  function renderLights(msg) {
    let level = ENERGY_LEVEL[msg.energy];
    if (msg.action === 'dim') level *= DIM_FACTOR;
    if (msg.action === 'change_color') state.colorIndex = (state.colorIndex + 1) % PALETTE.length;
    const color = PALETTE[state.colorIndex];

    els.bulbs.querySelectorAll('.bulb').forEach((bulb, i) => {
      bulb.style.transitionDelay = `${i * 70}ms`;
      bulb.style.backgroundColor = color.hex;
      bulb.style.opacity = (0.25 + 0.75 * level).toFixed(2);
      bulb.style.boxShadow =
        `0 0 ${Math.round(16 + 48 * level)}px ${Math.round(2 + 10 * level)}px ${hexToRgba(color.hex, 0.6 * level)}`;
    });

    els.ambient.style.backgroundColor = color.hex;
    els.ambient.style.opacity = (0.35 * level).toFixed(2);

    if (msg.action === 'flash_light') {
      // Remove and re-add the class so the animation restarts on back-to-back flashes.
      els.bulbs.classList.remove('flash');
      void els.bulbs.offsetWidth;
      els.bulbs.classList.add('flash');
    }

    els.lightsAction.textContent = ACTION_LABELS[msg.action];
    els.lightsAction.classList.add('is-active');
    els.lightsEnergy.textContent = capitalize(msg.energy);
    els.lightsBrightness.textContent = `${Math.round(level * 100)}%`;
    els.lightsSwatch.style.backgroundColor = color.hex;
    els.lightsColor.textContent = color.name;
  }

  // ---------- Music (Stage) ----------

  function animateTempo(to) {
    const from = state.tempo ?? to;
    state.tempo = to;
    cancelAnimationFrame(state.tempoFrame);
    const start = performance.now();
    const duration = 700;

    const frame = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      els.tempoValue.textContent = Math.round(from + (to - from) * eased);
      if (t < 1) state.tempoFrame = requestAnimationFrame(frame);
    };
    state.tempoFrame = requestAnimationFrame(frame);
  }

  function renderMusic(msg) {
    const bpm = msg.music_tempo;
    animateTempo(bpm);
    els.tempoLabel.textContent = tempoDescription(bpm);
    const pct = Math.min(Math.max((bpm - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN), 0), 1);
    els.tempoMeter.style.width = `${pct * 100}%`;
    els.beat.style.setProperty('--beat', `${(60 / bpm).toFixed(3)}s`);
  }

  // ---------- Reset ----------

  function resetDisplay() {
    els.energyValue.textContent = '—';
    els.energySegs.forEach((seg) => seg.classList.remove('is-on'));
    els.energyNote.textContent = 'Press Play demo to start.';
    buildTimeline();

    els.bulbs.classList.remove('flash');
    els.bulbs.querySelectorAll('.bulb').forEach((bulb) => { bulb.style.cssText = ''; });
    els.ambient.style.cssText = '';
    els.lightsAction.textContent = 'Waiting';
    els.lightsAction.classList.remove('is-active');
    els.lightsEnergy.textContent = '—';
    els.lightsBrightness.textContent = '—';
    els.lightsSwatch.style.cssText = '';
    els.lightsColor.textContent = '—';

    cancelAnimationFrame(state.tempoFrame);
    state.tempo = null;
    els.tempoValue.textContent = '—';
    els.tempoLabel.textContent = 'Starts in the Stage phase';
    els.tempoMeter.style.width = '0';
    els.beat.style.removeProperty('--beat');
  }

  // ---------- Progress & controls ----------

  function renderProgress() {
    const total = state.messages.length;
    let label;
    let fill;

    if (state.phase === 'idle') {
      label = `${total} messages ready`;
      fill = 0;
    } else if (state.phase === 'done') {
      label = 'Demo complete';
      fill = 1;
    } else {
      label = `${PHASE_LABELS[state.phase]} · Message ${state.index + 1} of ${total}`;
      if (!state.playing) label += ' · Paused';
      const offset = state.phase === 'stage' ? total : 0;
      fill = (offset + state.index + 1) / (total * 2);
    }

    els.progressLabel.textContent = label;
    els.progressFill.style.width = `${fill * 100}%`;

    const shown = { idle: 0, activity: state.index + 1 }[state.phase] ?? total;
    els.timelineCount.textContent = `${shown} / ${total}`;
  }

  function renderControls() {
    const running = isRunning();
    const paused = running && !state.playing;

    els.playBtn.disabled = running;
    els.playLabel.textContent = state.phase === 'done' ? 'Play again' : 'Play demo';
    els.pauseBtn.dataset.state = paused ? 'resume' : 'pause';
    els.pauseLabel.textContent = paused ? 'Resume' : 'Pause';

    for (const btn of els.tabBtns) {
      btn.classList.toggle('is-live', state.playing && btn.dataset.tab === state.phase);
    }

    const activityLive = state.phase === 'activity' && state.playing;
    els.energyChip.textContent = state.phase === 'activity'
      ? (state.playing ? 'Live' : 'Paused')
      : state.phase === 'idle' ? 'Waiting' : 'Complete';
    els.energyChip.classList.toggle('is-active', activityLive);

    const stageLive = state.phase === 'stage' && state.playing;
    els.musicState.textContent = state.phase === 'stage'
      ? (state.playing ? 'Playing' : 'Paused')
      : state.phase === 'done' ? 'Finished' : 'Waiting';
    els.musicState.classList.toggle('is-active', stageLive);
    els.musicPanel.classList.toggle('is-paused', !stageLive);
  }

  // ---------- Demo playback ----------

  function schedule(fn) {
    state.pending = fn;
    state.timer = setTimeout(() => {
      state.timer = null;
      state.pending = null;
      fn();
    }, STEP_MS);
  }

  function stopTimer() {
    clearTimeout(state.timer);
    state.timer = null;
  }

  function step() {
    state.index += 1;
    const msg = state.messages[state.index];
    if (state.phase === 'activity') {
      renderEnergy(msg);
      renderTimeline(state.index);
    } else {
      renderLights(msg);
      renderMusic(msg);
    }
    renderProgress();
  }

  function tick() {
    step();
    if (state.index < state.messages.length - 1) schedule(tick);
    else if (state.phase === 'activity') schedule(startStagePhase);
    else finish();
  }

  function startStagePhase() {
    state.phase = 'stage';
    state.index = -1;
    renderTimeline(state.messages.length);
    selectTab('stage');
    renderControls();
    tick();
  }

  function finish() {
    state.phase = 'done';
    state.playing = false;
    state.pending = null;
    renderProgress();
    renderControls();
  }

  function startDemo() {
    if (!state.messages.length) return;
    stopTimer();
    state.pending = null;
    resetDisplay();
    state.phase = 'activity';
    state.index = -1;
    state.colorIndex = 0;
    state.playing = true;
    selectTab('activity');
    renderControls();
    tick();
  }

  function togglePause() {
    if (!isRunning()) {
      els.progressLabel.textContent = state.phase === 'done'
        ? 'Demo complete · press Play again'
        : 'Press Play demo to start';
      return;
    }
    if (state.playing) {
      state.playing = false;
      stopTimer();
    } else {
      state.playing = true;
      schedule(state.pending ?? tick);
    }
    renderControls();
    renderProgress();
  }

  // ---------- Startup ----------

  function showError(err) {
    const onFile = location.protocol === 'file:';
    els.error.hidden = false;
    els.error.innerHTML = `
      <p><strong>Couldn't load ${DATA_URL}.</strong> ${err.message}</p>
      ${onFile
        ? '<p>Browsers block loading data from pages opened directly from disk. Run <code>python3 -m http.server 8000</code> in this folder and open <code>http://localhost:8000</code>.</p>'
        : ''}`;
    els.progressLabel.textContent = 'No data loaded';
    els.playBtn.disabled = true;
    els.pauseBtn.disabled = true;
    els.restartBtn.disabled = true;
  }

  async function init() {
    buildBulbs();
    els.playBtn.addEventListener('click', startDemo);
    els.restartBtn.addEventListener('click', startDemo);
    els.pauseBtn.addEventListener('click', togglePause);
    els.tabBtns.forEach((btn) => btn.addEventListener('click', () => selectTab(btn.dataset.tab)));
    els.tabs.addEventListener('keydown', onTabKeydown);

    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`The server responded with ${res.status}.`);
      const data = await res.json();
      const messages = Array.isArray(data.messages) ? data.messages : [];
      state.messages = messages.filter(isValidMessage);
      if (state.messages.length < messages.length) {
        console.warn(`Skipped ${messages.length - state.messages.length} invalid message(s) in ${DATA_URL}.`);
      }
      if (!state.messages.length) throw new Error('It has no valid messages.');
    } catch (err) {
      showError(err);
      return;
    }

    buildTimeline();
    renderProgress();
    renderControls();
  }

  init();
})();
