import { aggregateSkill } from '../core/rhythm';
import { phaseInBar, type GameState } from '../game/GameEngine';

interface Pulse {
  x: number;
  y: number;
  age: number;
  strength: number;
}

const TAU = Math.PI * 2;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private pulses: Pulse[] = [];

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

  render(state: GameState, deltaSeconds: number): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);

    this.drawGrid(state);
    this.drawWaveField(state);
    this.drawRhythmOrbit(state);
    this.drawCore(state);
    this.drawPulses(deltaSeconds);
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
    const cx = w * 0.5;
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
        ? `rgba(101,243,223,${0.26 + state.flow * 0.35})`
        : `rgba(103,116,255,${0.08 + lane * 0.025})`;
      ctx.lineWidth = lane === 2 ? 2 : 1;
      ctx.stroke();
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
    ctx.strokeStyle = 'rgba(151,161,201,.16)';
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
      ctx.fillStyle = active
        ? `rgba(218,225,255,${0.35 + accent * 0.55})`
        : 'rgba(112,124,165,.18)';
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

    ctx.save();
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.5);
    glow.addColorStop(0, `rgba(101,243,223,${0.18 + flow * 0.14})`);
    glow.addColorStop(0.45, `rgba(92,92,255,${0.08 + tension * 0.16})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 2.5, 0, TAU);
    ctx.fill();

    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(63,70,96,.42)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.stroke();

    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(${Math.round(101 + tension * 100)}, ${Math.round(243 - tension * 80)}, ${Math.round(223 - tension * 10)}, .94)`;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + TAU * tension);
    ctx.stroke();

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
