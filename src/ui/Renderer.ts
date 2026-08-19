import type { PlayerIntent } from '../core/music';
import { aggregateSkill } from '../core/rhythm';
import { phaseInBar, type GameState } from '../game/GameEngine';
import { pressureDanger, waveProgress, type PressureWave, type WaveLane } from '../game/PressureSystem';

interface Pulse {
  x: number;
  y: number;
  age: number;
  strength: number;
}

interface IntentVisual {
  intent: PlayerIntent;
  age: number;
  strength: number;
  fromTension: number;
  toTension: number;
}

interface Point {
  x: number;
  y: number;
}

const TAU = Math.PI * 2;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function intentColor(intent: PlayerIntent, alpha: number): string {
  const a = clamp01(alpha);
  switch (intent) {
    case 'resolve': return `rgba(101,243,223,${a})`;
    case 'delay': return `rgba(166,140,255,${a})`;
    case 'diverge': return `rgba(255,186,98,${a})`;
    case 'intensify': return `rgba(255,109,159,${a})`;
  }
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private pulses: Pulse[] = [];
  private intentVisuals: IntentVisual[] = [];
  private climaxAge = -1;
  private climaxStrength = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.canvas = canvas;
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  impact(strength: number): void {
    this.pulses.push({
      x: this.width * 0.5,
      y: this.height * 0.48,
      age: 0,
      strength: clamp01(strength),
    });
    if (this.pulses.length > 10) this.pulses.shift();
  }

  showIntent(intent: PlayerIntent, fromTension: number, toTension: number, strength: number): void {
    for (const visual of this.intentVisuals) visual.age += 0.18;
    this.intentVisuals.push({
      intent,
      age: 0,
      strength: clamp01(0.35 + strength * 0.65),
      fromTension: clamp01(fromTension),
      toTension: clamp01(toTension),
    });
    while (this.intentVisuals.length > 2) this.intentVisuals.shift();
  }

  celebratePhrase(strength: number): void {
    this.climaxAge = 0;
    this.climaxStrength = clamp01(0.65 + strength * 0.35);
  }

  render(state: GameState, deltaSeconds: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);

    this.drawGrid(state);
    this.drawWaveField(state);
    this.drawPressureLanes(state);
    this.drawPressureWaves(state);
    this.drawCore(state);
    this.drawIntentEffects(deltaSeconds);
    this.drawPulses(deltaSeconds);
    this.drawPhraseClimax(deltaSeconds);
    // Rhythm targets and cursor are always last so feedback never hides the next input.
    this.drawRhythmOrbit(state);
  }

  private laneGeometry(lane: WaveLane): { start: Point; control: Point; end: Point } {
    const end = { x: this.width * 0.5, y: this.height * 0.48 };
    const radius = Math.max(145, Math.min(this.height * 0.54, this.width * 0.31, 260));
    const angle = lane === 0 ? -2.28 : lane === 1 ? -Math.PI / 2 : -0.86;
    const start = {
      x: end.x + Math.cos(angle) * radius,
      y: end.y + Math.sin(angle) * radius,
    };
    const lateral = lane === 0 ? -34 : lane === 2 ? 34 : 0;
    const control = {
      x: (start.x + end.x) * 0.5 + lateral,
      y: (start.y + end.y) * 0.5 - 14,
    };
    return { start, control, end };
  }

  private pointOnLane(lane: WaveLane, progress: number): Point {
    const { start, control, end } = this.laneGeometry(lane);
    const t = clamp01(progress);
    const inv = 1 - t;
    return {
      x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
      y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
    };
  }

  private drawGrid(state: GameState): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const phase = phaseInBar(state);
    const offset = phase * 38;
    ctx.save();
    ctx.strokeStyle = 'rgba(112, 126, 180, 0.075)';
    ctx.lineWidth = 1;
    for (let x = -40 + offset; x < w + 40; x += 38) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = -40; y < h + 40; y += 38) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawWaveField(state: GameState): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cy = h * 0.48;
    const amplitude = 12 + state.music.tension * 34;
    const phase = phaseInBar(state) * TAU * 4;
    const lanes = 5;

    ctx.save();
    for (let lane = 0; lane < lanes; lane += 1) {
      const yBase = cy + (lane - 2) * 20;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 5) {
        const normalized = x / w;
        const envelope = Math.sin(normalized * Math.PI);
        const y = yBase + Math.sin(normalized * TAU * (2 + lane * 0.35) - phase - lane) * amplitude * envelope * (0.3 + lane * 0.13);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = lane === 2
        ? `rgba(101,243,223,${0.18 + state.flow * 0.26})`
        : `rgba(103,116,255,${0.055 + lane * 0.018})`;
      ctx.lineWidth = lane === 2 ? 1.6 : 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPressureLanes(state: GameState): void {
    const ctx = this.ctx;
    const danger = pressureDanger(state.pressure);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([4, 9]);
    for (const lane of [0, 1, 2] as const) {
      const { start, control, end } = this.laneGeometry(lane);
      ctx.strokeStyle = `rgba(${Math.round(116 + danger * 95)},${Math.round(128 - danger * 22)},${Math.round(178 - danger * 34)},${0.12 + danger * 0.13})`;
      ctx.lineWidth = lane === 1 ? 1.35 : 1;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(133,145,190,.28)';
      ctx.beginPath();
      ctx.arc(start.x, start.y, 2.2, 0, TAU);
      ctx.fill();
      ctx.setLineDash([4, 9]);
    }
    ctx.restore();
  }

  private waveColor(wave: PressureWave, alpha: number): string {
    const a = clamp01(alpha);
    if (wave.amplified) return `rgba(255,109,159,${a})`;
    if (wave.kind === 'accent') return `rgba(101,243,223,${a})`;
    if (wave.kind === 'dissonance') return `rgba(255,186,98,${a})`;
    return `rgba(218,225,255,${a})`;
  }

  private drawPressureWaves(state: GameState): void {
    const ctx = this.ctx;
    if (state.pressure.waves.length === 0) return;
    const ordered = [...state.pressure.waves].sort((a, b) => b.etaMs - a.etaMs);
    const priorityId = [...state.pressure.waves].sort((a, b) => a.etaMs - b.etaMs)[0]?.id;

    ctx.save();
    for (const wave of ordered) {
      const progress = waveProgress(wave);
      const point = this.pointOnLane(wave.lane, progress);
      const priority = wave.id === priorityId;
      const size = 4.5 + wave.pressure * 3.2 + progress * 2.8;
      const alpha = 0.48 + progress * 0.42;
      const color = this.waveColor(wave, alpha);

      if (priority) {
        ctx.shadowColor = this.waveColor(wave, 0.9);
        ctx.shadowBlur = 12 + progress * 12;
        ctx.strokeStyle = this.waveColor(wave, 0.38);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(point.x, point.y, size + 7 + Math.sin(state.elapsedMs * 0.01) * 1.5, 0, TAU);
        ctx.stroke();
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = color;
      ctx.strokeStyle = this.waveColor(wave, Math.min(1, alpha + 0.2));
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (wave.kind === 'dissonance') {
        ctx.moveTo(point.x, point.y - size);
        ctx.lineTo(point.x + size, point.y);
        ctx.lineTo(point.x, point.y + size);
        ctx.lineTo(point.x - size, point.y);
        ctx.closePath();
      } else if (wave.kind === 'accent') {
        for (let i = 0; i < 8; i += 1) {
          const angle = -Math.PI / 2 + (i / 8) * TAU;
          const radius = i % 2 === 0 ? size * 1.18 : size * 0.62;
          const x = point.x + Math.cos(angle) * radius;
          const y = point.y + Math.sin(angle) * radius;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      } else {
        ctx.arc(point.x, point.y, size, 0, TAU);
      }
      ctx.fill();
      ctx.stroke();

      if (wave.delayed) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(166,140,255,.72)';
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.arc(point.x, point.y, size + 4, -Math.PI * 0.85, Math.PI * 0.65);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (wave.diverged) {
        ctx.strokeStyle = 'rgba(255,186,98,.68)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(point.x - 5, point.y + size + 4);
        ctx.lineTo(point.x, point.y + size + 8);
        ctx.lineTo(point.x + 5, point.y + size + 4);
        ctx.stroke();
      }
      if (wave.amplified) {
        ctx.strokeStyle = 'rgba(255,109,159,.72)';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 6; i += 1) {
          const angle = (i / 6) * TAU;
          ctx.beginPath();
          ctx.moveTo(point.x + Math.cos(angle) * (size + 2), point.y + Math.sin(angle) * (size + 2));
          ctx.lineTo(point.x + Math.cos(angle) * (size + 7), point.y + Math.sin(angle) * (size + 7));
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private drawRhythmOrbit(state: GameState): void {
    const ctx = this.ctx;
    const cx = this.width * 0.5;
    const cy = this.height * 0.48;
    const minDimension = Math.min(this.width, this.height);
    const radius = Math.max(72, Math.min(minDimension * 0.27, 150));
    const phase = phaseInBar(state);
    const count = state.challenge.steps.length;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(151,161,201,.2)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.stroke();

    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (i / count) * TAU;
      const active = Boolean(state.challenge.steps[i]);
      const accent = state.challenge.accents[i] ?? 0;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      const size = active ? 2.8 + accent * 4.2 : 1.2;
      if (active) {
        ctx.shadowColor = 'rgba(218,225,255,.65)';
        ctx.shadowBlur = 5 + accent * 6;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = active
        ? `rgba(231,236,255,${0.48 + accent * 0.5})`
        : 'rgba(112,124,165,.22)';
      ctx.beginPath();
      ctx.arc(x, y, size, 0, TAU);
      ctx.fill();
    }

    const cursorAngle = -Math.PI / 2 + phase * TAU;
    const x = cx + Math.cos(cursorAngle) * radius;
    const y = cy + Math.sin(cursorAngle) * radius;
    ctx.shadowColor = '#65f3df';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#dffffa';
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawCore(state: GameState): void {
    const ctx = this.ctx;
    const cx = this.width * 0.5;
    const cy = this.height * 0.48;
    const radius = Math.max(39, Math.min(this.width, this.height) * 0.09);
    const tension = state.music.tension;
    const flow = state.flow;
    const skill = aggregateSkill(state.skill);
    const danger = pressureDanger(state.pressure);
    const stability = state.pressure.stability;

    ctx.save();
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.75);
    glow.addColorStop(0, `rgba(${Math.round(101 + danger * 140)},${Math.round(243 - danger * 120)},${Math.round(223 - danger * 85)},${0.17 + flow * 0.12 + danger * 0.12})`);
    glow.addColorStop(0.45, `rgba(${Math.round(92 + danger * 130)},${Math.round(92 - danger * 24)},${Math.round(255 - danger * 70)},${0.07 + tension * 0.13 + danger * 0.1})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 2.75, 0, TAU);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(63,70,96,.5)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 10, 0, TAU);
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.strokeStyle = stability > 0.55
      ? `rgba(101,243,223,${0.58 + stability * 0.32})`
      : stability > 0.28
        ? `rgba(255,186,98,${0.65 + stability * 0.3})`
        : 'rgba(255,109,159,.94)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 10, -Math.PI / 2, -Math.PI / 2 + TAU * stability);
    ctx.stroke();

    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(63,70,96,.42)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = `rgba(${Math.round(101 + tension * 100)}, ${Math.round(243 - tension * 80)}, ${Math.round(223 - tension * 10)}, .94)`;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + TAU * tension);
    ctx.stroke();

    if (danger > 0.5) {
      ctx.strokeStyle = `rgba(255,109,159,${(danger - 0.5) * 1.2})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 17 + Math.sin(state.elapsedMs * 0.012) * 2, 0, TAU);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f6f8ff';
    ctx.font = `700 ${Math.max(13, radius * 0.3)}px ui-sans-serif, sans-serif`;
    ctx.fillText(`${Math.round(tension * 100)}`, cx, cy - 4);
    ctx.fillStyle = 'rgba(151,162,194,.8)';
    ctx.font = `600 ${Math.max(7, radius * 0.14)}px ui-sans-serif, sans-serif`;
    ctx.fillText('TENSION', cx, cy + radius * 0.28);

    const skillY = cy + radius * 1.55;
    const barW = radius * 1.55;
    ctx.fillStyle = 'rgba(67,74,101,.35)';
    ctx.fillRect(cx - barW / 2, skillY, barW, 2);
    ctx.fillStyle = 'rgba(101,243,223,.8)';
    ctx.fillRect(cx - barW / 2, skillY, barW * skill, 2);
    ctx.restore();
  }

  private drawIntentEffects(deltaSeconds: number): void {
    const ctx = this.ctx;
    const cx = this.width * 0.5;
    const cy = this.height * 0.48;
    const baseRadius = Math.max(46, Math.min(this.width, this.height) * 0.1);

    this.intentVisuals = this.intentVisuals.filter((visual) => {
      visual.age += deltaSeconds;
      const duration = visual.intent === 'delay' ? 0.72 : 0.56;
      if (visual.age > duration) return false;
      const p = clamp01(visual.age / duration);
      const alpha = (1 - p) * (0.28 + visual.strength * 0.42);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = intentColor(visual.intent, 0.8);
      ctx.shadowBlur = 8 + visual.strength * 9;

      switch (visual.intent) {
        case 'resolve': {
          for (let ring = 0; ring < 3; ring += 1) {
            const local = clamp01(p + ring * 0.08);
            const ringRadius = baseRadius + (1 - local) * (138 + ring * 22) * visual.strength;
            ctx.strokeStyle = intentColor('resolve', alpha * (1 - ring * 0.2));
            ctx.lineWidth = 1.3 + visual.strength * 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, ringRadius, 0, TAU);
            ctx.stroke();
          }
          ctx.strokeStyle = intentColor('resolve', alpha);
          ctx.lineWidth = 2;
          for (let side = -1; side <= 1; side += 2) {
            ctx.beginPath();
            ctx.moveTo(cx + side * (105 - p * 58), cy - 42 + p * 30);
            ctx.lineTo(cx + side * (baseRadius * 0.55), cy);
            ctx.stroke();
          }
          break;
        }
        case 'delay': {
          ctx.setLineDash([8, 10]);
          for (let ring = 0; ring < 3; ring += 1) {
            const ringRadius = baseRadius + 24 + ring * 26 + p * 12;
            const start = -Math.PI * 0.9 + p * 0.35 + ring * 0.24;
            ctx.strokeStyle = intentColor('delay', alpha * (1 - ring * 0.17));
            ctx.lineWidth = 1.4 + visual.strength;
            ctx.beginPath();
            ctx.arc(cx, cy, ringRadius, start, start + Math.PI * 1.35);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.strokeStyle = intentColor('delay', alpha * 0.8);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx - 34, cy - baseRadius - 8);
          ctx.lineTo(cx + 34, cy - baseRadius - 8);
          ctx.moveTo(cx + 34, cy - baseRadius - 18);
          ctx.lineTo(cx + 34, cy - baseRadius + 2);
          ctx.stroke();
          break;
        }
        case 'diverge': {
          const reach = 62 + p * 122 * visual.strength;
          const splitY = cy - 8;
          ctx.strokeStyle = intentColor('diverge', alpha);
          ctx.lineWidth = 1.8 + visual.strength * 1.4;
          ctx.beginPath();
          ctx.moveTo(cx, cy + 22);
          ctx.lineTo(cx, splitY);
          ctx.lineTo(cx - reach, cy - 52 - p * 14);
          ctx.moveTo(cx, splitY);
          ctx.lineTo(cx + reach, cy + 42 + p * 10);
          ctx.stroke();
          for (let spark = 0; spark < 4; spark += 1) {
            const direction = spark % 2 === 0 ? -1 : 1;
            const ratio = 0.42 + (spark / 4) * 0.55;
            const x = cx + direction * reach * ratio;
            const y = splitY + direction * (40 + p * 16) * ratio;
            ctx.fillStyle = intentColor('diverge', alpha * 0.75);
            ctx.beginPath();
            ctx.arc(x, y, 1.8 + visual.strength * 1.6, 0, TAU);
            ctx.fill();
          }
          break;
        }
        case 'intensify': {
          const spikeCount = 12;
          const inner = baseRadius + 8 + p * 10;
          const outerBoost = (36 + 98 * (1 - p)) * visual.strength;
          ctx.strokeStyle = intentColor('intensify', alpha);
          ctx.lineWidth = 1.35 + visual.strength * 1.2;
          for (let i = 0; i < spikeCount; i += 1) {
            const angle = (i / spikeCount) * TAU + p * 0.2;
            const variation = i % 3 === 0 ? 1.22 : i % 2 === 0 ? 1 : 0.74;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
            ctx.lineTo(
              cx + Math.cos(angle) * (inner + outerBoost * variation),
              cy + Math.sin(angle) * (inner + outerBoost * variation),
            );
            ctx.stroke();
          }
          ctx.strokeStyle = intentColor('intensify', alpha * 0.65);
          ctx.beginPath();
          ctx.arc(cx, cy, inner + outerBoost * 0.45, 0, TAU);
          ctx.stroke();
          break;
        }
      }

      const tensionDelta = visual.toTension - visual.fromTension;
      if (Math.abs(tensionDelta) >= 0.02) {
        ctx.shadowBlur = 0;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = intentColor(visual.intent, alpha * 0.9);
        ctx.font = `700 ${Math.max(10, baseRadius * 0.18)}px ui-sans-serif, sans-serif`;
        const arrow = tensionDelta > 0 ? '▲' : '▼';
        ctx.fillText(`${arrow}${Math.abs(Math.round(tensionDelta * 100))}`, cx, cy - baseRadius * 1.55);
      }

      ctx.restore();
      return true;
    });
  }

  private drawPhraseClimax(deltaSeconds: number): void {
    if (this.climaxAge < 0) return;
    this.climaxAge += deltaSeconds;
    const duration = 1.05;
    if (this.climaxAge >= duration) {
      this.climaxAge = -1;
      return;
    }

    const ctx = this.ctx;
    const cx = this.width * 0.5;
    const cy = this.height * 0.48;
    const p = this.climaxAge / duration;
    const fade = (1 - p) * this.climaxStrength;
    const radius = Math.max(55, Math.min(this.width, this.height) * 0.11);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(101,243,223,.8)';
    ctx.shadowBlur = 14;
    for (let ring = 0; ring < 3; ring += 1) {
      const ringRadius = radius + p * (150 + ring * 38);
      ctx.strokeStyle = `rgba(220,255,249,${fade * (0.32 - ring * 0.07)})`;
      ctx.lineWidth = 1.4 + (2 - ring) * 0.45;
      ctx.beginPath();
      ctx.arc(cx, cy, ringRadius, 0, TAU);
      ctx.stroke();
    }
    const rays = 16;
    ctx.strokeStyle = `rgba(101,243,223,${fade * 0.28})`;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < rays; i += 1) {
      const angle = (i / rays) * TAU;
      const inner = radius + 18 + p * 26;
      const outer = inner + (72 + 90 * (1 - p)) * this.climaxStrength;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPulses(deltaSeconds: number): void {
    const ctx = this.ctx;
    this.pulses = this.pulses.filter((pulse) => {
      pulse.age += deltaSeconds;
      if (pulse.age > 0.55) return false;
      const p = pulse.age / 0.55;
      const radius = 28 + p * 210 * (0.7 + pulse.strength * 0.45);
      ctx.save();
      ctx.strokeStyle = `rgba(101,243,223,${(1 - p) * (0.16 + pulse.strength * 0.42)})`;
      ctx.lineWidth = 1 + pulse.strength * 2;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, radius, 0, TAU);
      ctx.stroke();
      ctx.restore();
      return true;
    });
  }
}
