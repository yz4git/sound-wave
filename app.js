(() => {
  'use strict';

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const TAU = Math.PI * 2;
  const PITCH_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const PROFILE_KEY = 'sound-wave:profile:v1';

  function required(selector) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Missing UI: ${selector}`);
    return el;
  }

  function safeStorage() {
    try { return window.localStorage; } catch { return null; }
  }

  function initialSkill() {
    return { timing: 0.42, syncopation: 0.25, density: 0.3, polyrhythm: 0.12, stability: 0.5 };
  }

  function loadProfile() {
    const fallback = { version: 1, skill: initialSkill(), bestScore: 0, bestCombo: 0, sessions: 0 };
    try {
      const storage = safeStorage();
      if (!storage) return fallback;
      const raw = storage.getItem(PROFILE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.skill) return fallback;
      return {
        version: 1,
        skill: { ...fallback.skill, ...parsed.skill },
        bestScore: Number.isFinite(parsed.bestScore) ? Math.max(0, parsed.bestScore) : 0,
        bestCombo: Number.isFinite(parsed.bestCombo) ? Math.max(0, parsed.bestCombo) : 0,
        sessions: Number.isFinite(parsed.sessions) ? Math.max(0, parsed.sessions) : 0,
      };
    } catch { return fallback; }
  }

  function saveProfile(profile) {
    try { safeStorage()?.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* optional */ }
  }

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function aggregateSkill(s) {
    return clamp01(s.timing * 0.38 + s.syncopation * 0.2 + s.density * 0.16 + s.polyrhythm * 0.12 + s.stability * 0.14);
  }

  function generateChallenge(skill, seed, previous) {
    const random = rng(seed);
    const target = clamp01(aggregateSkill(skill) + 0.08);
    const subdivisions = target < 0.34 ? 2 : 4;
    const count = subdivisions * 4;
    const baseDensity = 0.24 + target * 0.38;
    const syncBias = skill.syncopation * 0.15 + target * 0.15;
    let polyrhythm = 1;
    if (target > 0.78 && random() < 0.36) polyrhythm = 5;
    else if (target > 0.48 && random() < 0.46) polyrhythm = 3;
    const steps = new Array(count).fill(false);
    const accents = new Array(count).fill(0);

    for (let i = 0; i < count; i += 1) {
      const downbeat = i % subdivisions === 0;
      const offbeat = !downbeat && i % Math.max(1, subdivisions / 2) === 0;
      const ghostPenalty = previous?.steps?.[i] ? 0.08 : 0;
      const p = baseDensity + (downbeat ? 0.2 : offbeat ? syncBias : syncBias * 0.5) - ghostPenalty;
      steps[i] = random() < clamp01(p);
      if (steps[i]) {
        const metric = downbeat ? 0.95 : offbeat ? 0.68 : 0.45;
        const poly = polyrhythm > 1 && i % Math.max(1, Math.round(count / polyrhythm)) === 0 ? 0.18 : 0;
        accents[i] = clamp01(metric + poly + random() * 0.08);
      }
    }
    steps[0] = true;
    accents[0] = 1;
    if (steps.filter(Boolean).length < 2) {
      const mid = Math.floor(count / 2);
      steps[mid] = true;
      accents[mid] = 0.72;
    }
    return { steps, accents, subdivisions, polyrhythm, targetDifficulty: target };
  }

  function updateSkill(skill, samples) {
    if (!samples.length) return skill;
    const alpha = 0.16;
    const hits = samples.filter((s) => s.hit);
    const hitRate = hits.length / samples.length;
    const timingScore = samples.reduce((sum, s) => sum + (s.hit ? clamp01(1 - Math.abs(s.errorMs) / 130) : 0), 0) / samples.length;
    const sync = samples.filter((s) => s.syncopated);
    const poly = samples.filter((s) => s.polyrhythmic);
    const syncScore = sync.length ? sync.filter((s) => s.hit).length / sync.length : skill.syncopation;
    const polyScore = poly.length ? poly.filter((s) => s.hit).length / poly.length : skill.polyrhythm;
    const errorMean = samples.reduce((sum, s) => sum + Math.abs(s.errorMs), 0) / samples.length;
    const stabilityScore = clamp01(1 - errorMean / 180);
    const densityScore = clamp01(hitRate * 0.75 + timingScore * 0.25);
    return {
      timing: clamp01(skill.timing * (1 - alpha) + timingScore * alpha),
      syncopation: clamp01(skill.syncopation * (1 - alpha) + syncScore * alpha),
      density: clamp01(skill.density * (1 - alpha) + densityScore * alpha),
      polyrhythm: clamp01(skill.polyrhythm * (1 - alpha) + polyScore * alpha),
      stability: clamp01(skill.stability * (1 - alpha) + stabilityScore * alpha),
    };
  }

  function chordFor(intent, current) {
    const tonic = 0;
    if (intent === 'resolve') return { root: tonic, tones: [0, 3, 7], tension: 0.15, label: 'C · tonic' };
    if (intent === 'delay') return { root: 5, tones: [5, 8, 0], tension: Math.min(1, current.tension + 0.12), label: 'F · suspended' };
    if (intent === 'diverge') return { root: 3, tones: [3, 7, 10], tension: 0.5, label: 'E♭ · deceptive' };
    return { root: 7, tones: [7, 11, 2, 5], tension: 0.97, label: 'G7 · dominant' };
  }

  function coherence(tension, intent) {
    if (intent === 'resolve') return clamp01(0.22 + tension * 0.88);
    if (intent === 'delay') return clamp01(0.36 + (1 - Math.abs(tension - 0.72) / 0.72) * 0.58);
    if (intent === 'diverge') return clamp01(0.42 + (1 - Math.abs(tension - 0.5) / 0.5) * 0.46);
    return clamp01(0.3 + (1 - tension) * 0.72);
  }

  function barMs(bpm) { return (60000 / bpm) * 4; }
  function phase(state) { return ((state.phaseMs % barMs(state.bpm)) + barMs(state.bpm)) % barMs(state.bpm) / barMs(state.bpm); }

  function nearestStep(challenge, p) {
    const length = challenge.steps.length;
    const current = (((p % 1) + 1) % 1) * length;
    let index = 0;
    let distance = Infinity;
    for (let i = 0; i < length; i += 1) {
      if (!challenge.steps[i]) continue;
      const raw = Math.abs(i - current);
      const wrapped = Math.min(raw, length - raw);
      if (wrapped < distance) { distance = wrapped; index = i; }
    }
    return { index, distance };
  }

  const modifierNames = ['RESONANT RELEASE', 'OFFBEAT ENGINE', 'EDGE SUSTAIN', 'DECEPTIVE CURRENT', 'OVERDRIVE', 'POLY CORE'];

  function createState(skill) {
    const seed = Date.now() >>> 0;
    return {
      running: false, elapsedMs: 0, phaseMs: 0, bpm: 112, bar: 0,
      score: 0, combo: 0, maxCombo: 0, flow: 0.5, seed,
      music: { tension: 0.15, label: 'C · tonic', root: 0, tones: [0, 3, 7] },
      skill, challenge: generateChallenge(skill, seed), previousChallenge: null,
      samples: [], consumed: [], modifiers: [], lastUnlock: null, lastInput: null,
    };
  }

  class AudioEngine {
    constructor() { this.ctx = null; this.master = null; this.music = null; this.perc = null; }
    async unlock() {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      if (!this.ctx) {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.music = this.ctx.createGain();
        this.perc = this.ctx.createGain();
        this.master.gain.value = 0.7; this.music.gain.value = 0.48; this.perc.gain.value = 0.7;
        this.music.connect(this.master); this.perc.connect(this.master); this.master.connect(this.ctx.destination);
      }
      try { if (this.ctx.state !== 'running') await this.ctx.resume(); } catch { return false; }
      return this.ctx.state === 'running';
    }
    hz(pitch, octave = 4) { return 440 * 2 ** (((12 * (octave + 1) + pitch) - 69) / 12); }
    chord(music) {
      if (!this.ctx || this.ctx.state !== 'running' || !this.music) return;
      const now = this.ctx.currentTime;
      music.tones.forEach((pitch, i) => {
        const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
        o.type = i === 0 ? 'triangle' : 'sine'; o.frequency.value = this.hz(pitch, i === 0 ? 3 : 4);
        g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(i === 0 ? 0.1 : 0.055, now + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
        o.connect(g); g.connect(this.music); o.start(now); o.stop(now + 0.8);
      });
    }
    hit(ok = true, level = 0.7) {
      if (!this.ctx || this.ctx.state !== 'running' || !this.perc) return;
      const now = this.ctx.currentTime; const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = ok ? 'sine' : 'sawtooth'; o.frequency.setValueAtTime(ok ? 620 : 170, now); o.frequency.exponentialRampToValueAtTime(ok ? 920 : 90, now + 0.07);
      g.gain.setValueAtTime(0.08 * Math.max(0.2, level), now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      o.connect(g); g.connect(this.perc); o.start(now); o.stop(now + 0.12);
    }
    tick(accent = 0.5) {
      if (!this.ctx || this.ctx.state !== 'running' || !this.perc) return;
      const now = this.ctx.currentTime; const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = 'square'; o.frequency.value = 1100; g.gain.setValueAtTime(0.025 + 0.025 * accent, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
      o.connect(g); g.connect(this.perc); o.start(now); o.stop(now + 0.04);
    }
    suspend() { try { this.ctx?.suspend(); } catch {} }
    resume() { try { this.ctx?.resume(); } catch {} }
  }

  try {
    const canvas = required('#game');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    const start = required('#start');
    const scoreEl = required('#score');
    const comboEl = required('#combo');
    const flowEl = required('#flow');
    const bpmEl = required('#bpm');
    const chordEl = required('#chord');
    const judgementEl = required('#judgement');
    const buttons = [...document.querySelectorAll('[data-intent]')];
    const audio = new AudioEngine();
    const profile = loadProfile();
    let state = createState(profile.skill);
    let last = performance.now();
    let lastStep = -1;
    let lastBarForStep = -1;
    let messageTimer = 0;
    let impact = 0;
    let dpr = 1, w = 1, h = 1;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2); w = Math.max(1, rect.width); h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function syncHud() {
      scoreEl.textContent = state.score.toLocaleString(); comboEl.textContent = String(state.combo); flowEl.textContent = `${Math.round(state.flow * 100)}%`; bpmEl.textContent = String(Math.round(state.bpm));
      chordEl.textContent = `${state.music.label} · ${state.challenge.polyrhythm === 1 ? 'STRAIGHT' : `${state.challenge.polyrhythm}:4 POLY`}${state.modifiers.length ? ` · MOD ×${state.modifiers.length}` : ''}`;
      if (messageTimer > 0 && state.lastInput) judgementEl.textContent = `${state.lastInput.message}  +${state.lastInput.scoreDelta}`;
      else if (state.lastUnlock && messageTimer > 0) judgementEl.textContent = `MUTATION ACQUIRED — ${state.lastUnlock}`;
      else if (state.music.tension > 0.68) judgementEl.textContent = 'TENSION HIGH — RESOLVE, DELAY OR BREAK IT';
      else if (state.music.tension < 0.32) judgementEl.textContent = 'SPACE OPEN — BUILD TENSION';
      else judgementEl.textContent = 'READ THE PULSE — SHAPE THE NEXT STATE';
    }

    function begin(ev) {
      ev?.preventDefault?.();
      if (state.running) return;
      state.running = true;
      start.classList.add('hidden'); start.disabled = true; start.setAttribute('aria-hidden', 'true');
      profile.sessions += 1; saveProfile(profile); last = performance.now(); syncHud();
      Promise.resolve(audio.unlock()).then((ok) => { if (ok) audio.chord(state.music); }).catch(() => {});
    }

    function intent(name, button) {
      if (!state.running) return;
      const p = phase(state); const nearest = nearestStep(state.challenge, p); const stepMs = 60000 / state.bpm / state.challenge.subdivisions;
      const errorMs = nearest.distance * stepMs; const timing = clamp01(1 - Math.abs(errorMs) / Math.max(1, stepMs * 0.55));
      const nextMusic = chordFor(name, state.music); const coh = coherence(state.music.tension, name);
      if (state.consumed.includes(nearest.index)) {
        state.music = nextMusic; state.lastInput = { message: 'ECHO', scoreDelta: 0 }; messageTimer = 0.55; audio.tick(0.4); syncHud(); return;
      }
      const reframed = timing <= 0.36 && nearest.distance <= 1.05; const hit = timing > 0.36 || reframed;
      const resolution = name === 'resolve' ? Math.max(0.24, state.music.tension - nextMusic.tension + 0.3) : clamp01(0.38 + nextMusic.tension * 0.42);
      const flow = clamp01(Math.pow(Math.max(0.08, reframed ? timing * 0.72 + 0.18 : timing), 0.42) * Math.pow(Math.max(0.08, coh), 0.33) * Math.pow(Math.max(0.08, resolution), 0.25));
      const judgement = timing >= 0.82 ? 'LOCKED' : timing > 0.36 ? 'IN FLOW' : reframed ? 'SYNCOPATED' : 'DRIFT';
      const combo = hit ? state.combo + 1 : 0; const musicality = coh * 0.42 + flow * 0.34 + timing * 0.24;
      let multiplier = 1;
      if (state.modifiers.includes('RESONANT RELEASE') && name === 'resolve' && state.music.tension >= 0.65) multiplier *= 1.35;
      if (state.modifiers.includes('OFFBEAT ENGINE') && nearest.index % state.challenge.subdivisions !== 0 && hit) multiplier *= 1.3;
      if (state.modifiers.includes('POLY CORE') && state.challenge.polyrhythm !== 1 && hit) multiplier *= 1.35;
      const scoreDelta = hit ? Math.round(120 * musicality * (1 + Math.min(combo, 24) * 0.035) * multiplier) : 0;
      state.samples.push({ errorMs, hit, syncopated: nearest.index % state.challenge.subdivisions !== 0, polyrhythmic: state.challenge.polyrhythm !== 1 });
      if (hit) state.consumed.push(nearest.index);
      state.music = nextMusic; state.score += scoreDelta; state.combo = combo; state.maxCombo = Math.max(state.maxCombo, combo); state.flow = clamp01(state.flow * 0.72 + flow * 0.28);
      state.lastInput = { message: judgement, scoreDelta }; messageTimer = 0.55; impact = hit ? Math.max(impact, flow) : 0.2; audio.chord(state.music); audio.hit(hit, flow);
      if (hit && typeof navigator.vibrate === 'function') navigator.vibrate(timing >= 0.82 ? 14 : 8);
      if (button) { button.classList.add('active'); setTimeout(() => button.classList.remove('active'), 90); }
      syncHud();
    }

    function nextBar() {
      state.skill = updateSkill(state.skill, state.samples); state.samples = []; state.previousChallenge = state.challenge; state.seed = (state.seed + 0x9e3779b9 + state.bar * 97) >>> 0;
      state.challenge = generateChallenge(state.skill, state.seed, state.previousChallenge); state.bar += 1; state.consumed = [];
      if (state.skill.stability > 0.7 && state.bar > 3) state.bpm = Math.min(156, state.bpm + 0.35);
      state.lastUnlock = null;
      if (state.bar > 0 && state.bar % 4 === 0 && state.modifiers.length < modifierNames.length) {
        const available = modifierNames.filter((m) => !state.modifiers.includes(m)); const pick = available[state.seed % available.length]; if (pick) { state.modifiers.push(pick); state.lastUnlock = pick; messageTimer = 2.4; }
      }
      profile.skill = state.skill; profile.bestScore = Math.max(profile.bestScore, state.score); profile.bestCombo = Math.max(profile.bestCombo, state.maxCombo); saveProfile(profile);
    }

    function render(dt) {
      ctx.clearRect(0, 0, w, h); const p = phase(state); const cx = w * 0.5; const cy = h * 0.48; const radius = Math.max(72, Math.min(Math.min(w, h) * 0.27, 150));
      ctx.strokeStyle = 'rgba(112,126,180,.08)'; ctx.lineWidth = 1;
      const offset = p * 38; for (let x = -40 + offset; x < w + 40; x += 38) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = -40; y < h + 40; y += 38) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      const amp = 12 + state.music.tension * 34; ctx.beginPath();
      for (let x = 0; x <= w; x += 5) { const n = x / w; const y = cy + Math.sin(n * TAU * 2.7 - p * TAU * 4) * amp * Math.sin(n * Math.PI) * 0.65; x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.strokeStyle = `rgba(101,243,223,${0.25 + state.flow * 0.4})`; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = 'rgba(151,161,201,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU); ctx.stroke();
      state.challenge.steps.forEach((on, i) => { const a = -Math.PI / 2 + i / state.challenge.steps.length * TAU; const x = cx + Math.cos(a) * radius; const y = cy + Math.sin(a) * radius; const accent = state.challenge.accents[i] || 0; ctx.fillStyle = on ? `rgba(218,225,255,${0.35 + accent * 0.55})` : 'rgba(112,124,165,.18)'; ctx.beginPath(); ctx.arc(x, y, on ? 2.8 + accent * 4.2 : 1.2, 0, TAU); ctx.fill(); });
      const ca = -Math.PI / 2 + p * TAU; ctx.shadowColor = '#65f3df'; ctx.shadowBlur = 18; ctx.fillStyle = '#dffffa'; ctx.beginPath(); ctx.arc(cx + Math.cos(ca) * radius, cy + Math.sin(ca) * radius, 5.5, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      const core = Math.max(39, Math.min(w, h) * 0.09); ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(63,70,96,.42)'; ctx.beginPath(); ctx.arc(cx, cy, core, 0, TAU); ctx.stroke(); ctx.strokeStyle = '#65f3df'; ctx.beginPath(); ctx.arc(cx, cy, core, -Math.PI / 2, -Math.PI / 2 + TAU * state.music.tension); ctx.stroke();
      ctx.fillStyle = '#f6f8ff'; ctx.textAlign = 'center'; ctx.font = `700 ${Math.max(13, core * 0.3)}px sans-serif`; ctx.fillText(String(Math.round(state.music.tension * 100)), cx, cy); ctx.fillStyle = '#8790ab'; ctx.font = `600 ${Math.max(7, core * 0.14)}px sans-serif`; ctx.fillText('TENSION', cx, cy + core * 0.32);
      if (impact > 0.01) { impact *= Math.max(0, 1 - dt * 4.5); ctx.strokeStyle = `rgba(101,243,223,${impact * 0.5})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, radius * (1.05 + (1 - impact) * 0.4), 0, TAU); ctx.stroke(); }
    }

    start.addEventListener('pointerdown', begin, { passive: false }); start.addEventListener('touchend', begin, { passive: false }); start.addEventListener('click', begin, { passive: false });
    buttons.forEach((button) => { const fire = (e) => { e.preventDefault(); intent(button.dataset.intent, button); }; button.addEventListener('pointerdown', fire, { passive: false }); button.addEventListener('touchend', fire, { passive: false }); button.addEventListener('contextmenu', (e) => e.preventDefault()); });
    window.addEventListener('keydown', (e) => { const map = { ArrowLeft: 'resolve', ArrowDown: 'delay', ArrowUp: 'diverge', ArrowRight: 'intensify', a: 'resolve', s: 'delay', d: 'diverge', f: 'intensify' }; const name = map[e.key]; if (name && !e.repeat) { e.preventDefault(); intent(name, buttons.find((b) => b.dataset.intent === name)); } });
    window.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 120)); document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('visibilitychange', () => { document.hidden ? audio.suspend() : audio.resume(); last = performance.now(); });

    function frame(now) {
      const delta = Math.min(100, Math.max(0, now - last)); last = now;
      if (state.running) {
        state.elapsedMs += delta; state.phaseMs += delta;
        let guard = 0; while (state.phaseMs >= barMs(state.bpm) && guard++ < 4) { state.phaseMs -= barMs(state.bpm); nextBar(); }
        const idx = Math.floor(phase(state) * state.challenge.steps.length) % state.challenge.steps.length;
        if (idx !== lastStep || state.bar !== lastBarForStep) { lastStep = idx; lastBarForStep = state.bar; if (state.challenge.steps[idx]) audio.tick(state.challenge.accents[idx] || 0.4); }
      }
      messageTimer = Math.max(0, messageTimer - delta / 1000); render(delta / 1000); syncHud(); requestAnimationFrame(frame);
    }

    resize(); syncHud(); requestAnimationFrame(frame);
    document.documentElement.dataset.soundWaveBoot = 'ready';
    if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {}));
  } catch (error) {
    console.error('SOUND WAVE boot failed', error);
    document.documentElement.dataset.soundWaveBoot = 'failed';
    const start = document.querySelector('#start');
    if (start) {
      const small = start.querySelector('small');
      if (small) small.textContent = `BOOT ERROR — ${error instanceof Error ? error.message : 'unknown error'}`;
    }
  }
})();
