import type { FullSongComposition } from './FullSongComposer';
import type { JapaneseLyricVocalEvent, JapaneseLyricsTheme } from './JapaneseLyrics';
import type { VocalDirectorPreset } from './VocalDirector';
import type { VoiceCharacterPreset } from './VoiceCharacter';

export interface SongExportVoiceSettings {
  character: VoiceCharacterPreset;
  tone: number;
  director: VocalDirectorPreset;
}

export interface SongProjectSnapshot {
  version: 'sound-wave-song-v1';
  exportedAt: string;
  title: string;
  settings: FullSongComposition['settings'];
  sections: FullSongComposition['songSections'];
  chords: FullSongComposition['chords'];
  melody: FullSongComposition['melody'];
  drums: FullSongComposition['drums'];
  lyricsTheme: JapaneseLyricsTheme;
  lyrics: string[];
  vocal: JapaneseLyricVocalEvent[];
  voice: SongExportVoiceSettings;
}

const TITLE_BANK: Record<JapaneseLyricsTheme, readonly string[]> = {
  youth: ['青空シグナル', '明日へランウェイ', '声の行方', 'スタートライン'],
  night: ['月明かりの向こう', '夜明けのサイン', '静かな光', '夜を越えて'],
  future: ['ゼロから未来', '新世界シグナル', '境界線の向こう', '未来を鳴らせ'],
  adventure: ['風の地図', 'まだ見ない空', '旅の続き', '次の扉へ'],
};

function uniqueLines(vocal: readonly JapaneseLyricVocalEvent[]): string[] {
  const lines: string[] = [];
  for (const event of vocal) if (!lines.includes(event.lyricLine)) lines.push(event.lyricLine);
  return lines;
}

export function generatedSongTitle(theme: JapaneseLyricsTheme, seed: number): string {
  const bank = TITLE_BANK[theme];
  const index = ((seed >>> 0) ^ ((seed >>> 16) * 31)) % bank.length;
  return bank[Math.abs(index)] ?? bank[0]!;
}

export function createSongProjectSnapshot(
  composition: FullSongComposition,
  vocal: readonly JapaneseLyricVocalEvent[],
  theme: JapaneseLyricsTheme,
  voice: SongExportVoiceSettings,
): SongProjectSnapshot {
  return {
    version: 'sound-wave-song-v1',
    exportedAt: new Date().toISOString(),
    title: generatedSongTitle(theme, composition.settings.seed),
    settings: { ...composition.settings },
    sections: composition.songSections.map((section) => ({ ...section })),
    chords: composition.chords.map((chord) => ({ ...chord, chord: { ...chord.chord, tones: [...chord.chord.tones] } })),
    melody: composition.melody.map((note) => ({ ...note })),
    drums: composition.drums.map((drum) => ({ ...drum })),
    lyricsTheme: theme,
    lyrics: uniqueLines(vocal),
    vocal: vocal.map((event) => ({ ...event })),
    voice: { ...voice },
  };
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'sound-wave';
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportProjectJson(snapshot: SongProjectSnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, `${safeFilename(snapshot.title)}.soundwave.json`);
}

export function exportLyricsText(snapshot: SongProjectSnapshot): void {
  const header = `${snapshot.title}\n${snapshot.settings.genre} / ${snapshot.settings.subgenre}\n\n`;
  const blob = new Blob([header + snapshot.lyrics.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, `${safeFilename(snapshot.title)}-lyrics.txt`);
}

const FAVORITES_KEY = 'sound-wave-favorite-songs-v1';

export function saveFavoriteSong(snapshot: SongProjectSnapshot): number {
  let items: SongProjectSnapshot[] = [];
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw) items = JSON.parse(raw) as SongProjectSnapshot[];
  } catch {
    items = [];
  }
  const deduped = items.filter((item) => item.settings.seed !== snapshot.settings.seed);
  deduped.unshift(snapshot);
  const limited = deduped.slice(0, 20);
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(limited)); } catch { /* storage may be unavailable */ }
  return limited.length;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function flatten(chunks: readonly Float32Array[], length: number): Float32Array {
  const result = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): Blob {
  const frames = Math.min(left.length, right.length);
  const bytesPerSample = 2;
  const blockAlign = 2 * bytesPerSample;
  const buffer = new ArrayBuffer(44 + frames * blockAlign);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + frames * blockAlign, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, frames * blockAlign, true);
  let offset = 44;
  for (let index = 0; index < frames; index += 1) {
    const l = Math.max(-1, Math.min(1, left[index] ?? 0));
    const r = Math.max(-1, Math.min(1, right[index] ?? 0));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true); offset += 2;
    view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7fff, true); offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export class WavCapture {
  private processor: ScriptProcessorNode | null = null;
  private mute: GainNode | null = null;
  private readonly left: Float32Array[] = [];
  private readonly right: Float32Array[] = [];
  private frames = 0;
  private sampleRate = 48000;

  start(context: AudioContext, source: AudioNode): void {
    this.stopNodes();
    this.left.length = 0;
    this.right.length = 0;
    this.frames = 0;
    this.sampleRate = context.sampleRate;
    const processor = context.createScriptProcessor(4096, 2, 2);
    const mute = context.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer;
      const left = new Float32Array(input.getChannelData(0));
      const rightSource = input.numberOfChannels > 1 ? input.getChannelData(1) : input.getChannelData(0);
      const right = new Float32Array(rightSource);
      this.left.push(left);
      this.right.push(right);
      this.frames += left.length;
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    this.processor = processor;
    this.mute = mute;
  }

  finish(): Blob {
    const left = flatten(this.left, this.frames);
    const right = flatten(this.right, this.frames);
    this.stopNodes();
    this.left.length = 0;
    this.right.length = 0;
    this.frames = 0;
    return encodeWav(left, right, this.sampleRate);
  }

  cancel(): void {
    this.stopNodes();
    this.left.length = 0;
    this.right.length = 0;
    this.frames = 0;
  }

  private stopNodes(): void {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try { this.processor.disconnect(); } catch { /* already disconnected */ }
    }
    if (this.mute) {
      try { this.mute.disconnect(); } catch { /* already disconnected */ }
    }
    this.processor = null;
    this.mute = null;
  }
}
