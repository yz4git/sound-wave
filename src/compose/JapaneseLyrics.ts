import type { FullSongComposition } from './FullSongComposer';
import { fullSongSectionAtStep } from './FullSongComposer';
import type { GenreStyleProfile } from './GenreStyle';
import type { VocalEvent, VocalVowel } from './VocalGenerator';

export type JapaneseLyricsTheme = 'youth' | 'night' | 'future' | 'adventure';

export interface JapaneseLyricVocalEvent extends VocalEvent {
  lyric: string;
  lyricLine: string;
}

interface MoraToken {
  kana: string;
  syllable: string;
  vowel: VocalVowel;
}

interface LyricLineTemplate {
  text: string;
  tokens: readonly MoraToken[];
  hook?: boolean;
}

const m = (kana: string, syllable: string, vowel: VocalVowel): MoraToken => ({ kana, syllable, vowel });
const N = m('ん', 'n', 'u');

const LINES: Record<JapaneseLyricsTheme, readonly LyricLineTemplate[]> = {
  youth: [
    { text: '青い空こえて', tokens: [m('あ','a','a'),m('お','o','o'),m('い','i','i'),m('そ','so','o'),m('ら','ra','a'),m('こ','ko','o'),m('え','e','e'),m('て','te','e')] },
    { text: '君と今走る', tokens: [m('き','ki','i'),m('み','mi','i'),m('と','to','o'),m('い','i','i'),m('ま','ma','a'),m('は','ha','a'),m('し','si','i'),m('る','ru','u')] },
    { text: 'まぶしい朝へ', tokens: [m('ま','ma','a'),m('ぶ','bu','u'),m('し','si','i'),m('い','i','i'),m('あ','a','a'),m('さ','sa','a'),m('へ','he','e')] },
    { text: 'この声を届け', tokens: [m('こ','ko','o'),m('の','no','o'),m('こ','ko','o'),m('え','e','e'),m('を','o','o'),m('と','to','o'),m('ど','to','o'),m('け','ke','e')], hook: true },
    { text: '未来まで行こう', tokens: [m('み','mi','i'),m('ら','ra','a'),m('い','i','i'),m('ま','ma','a'),m('で','te','e'),m('い','i','i'),m('こ','ko','o'),m('う','u','u')], hook: true },
  ],
  night: [
    { text: '夜の風ゆれて', tokens: [m('よ','yo','o'),m('る','ru','u'),m('の','no','o'),m('か','ka','a'),m('ぜ','ze','e'),m('ゆ','yu','u'),m('れ','re','e'),m('て','te','e')] },
    { text: '月明かりのなか', tokens: [m('つ','tu','u'),m('き','ki','i'),m('あ','a','a'),m('か','ka','a'),m('り','ri','i'),m('の','no','o'),m('な','na','a'),m('か','ka','a')] },
    { text: '静かな鼓動', tokens: [m('し','si','i'),m('ず','zu','u'),m('か','ka','a'),m('な','na','a'),m('こ','ko','o'),m('ど','to','o'),m('う','u','u')] },
    { text: '君をまだ探す', tokens: [m('き','ki','i'),m('み','mi','i'),m('を','o','o'),m('ま','ma','a'),m('だ','ta','a'),m('さ','sa','a'),m('が','ga','a'),m('す','su','u')], hook: true },
    { text: '夜明けまで歌う', tokens: [m('よ','yo','o'),m('あ','a','a'),m('け','ke','e'),m('ま','ma','a'),m('で','te','e'),m('う','u','u'),m('た','ta','a'),m('う','u','u')], hook: true },
  ],
  future: [
    { text: '光を集めて', tokens: [m('ひ','hi','i'),m('か','ka','a'),m('り','ri','i'),m('を','o','o'),m('あ','a','a'),m('つ','tu','u'),m('め','me','e'),m('て','te','e')] },
    { text: '新しい世界', tokens: [m('あ','a','a'),m('た','ta','a'),m('ら','ra','a'),m('し','si','i'),m('い','i','i'),m('せ','se','e'),m('か','ka','a'),m('い','i','i')] },
    { text: '境界線こえて', tokens: [m('きょ','kyo','o'),m('う','u','u'),m('か','ka','a'),m('い','i','i'),m('せ','se','e'),N,m('こ','ko','o'),m('え','e','e'),m('て','te','e')] },
    { text: '未来を鳴らそう', tokens: [m('み','mi','i'),m('ら','ra','a'),m('い','i','i'),m('を','o','o'),m('な','na','a'),m('ら','ra','a'),m('そ','so','o'),m('う','u','u')], hook: true },
    { text: 'ここから始まる', tokens: [m('こ','ko','o'),m('こ','ko','o'),m('か','ka','a'),m('ら','ra','a'),m('は','ha','a'),m('じ','zi','i'),m('ま','ma','a'),m('る','ru','u')], hook: true },
  ],
  adventure: [
    { text: '遠い道の先へ', tokens: [m('と','to','o'),m('お','o','o'),m('い','i','i'),m('み','mi','i'),m('ち','ti','i'),m('の','no','o'),m('さ','sa','a'),m('き','ki','i'),m('へ','he','e')] },
    { text: '風の地図ひらく', tokens: [m('か','ka','a'),m('ぜ','ze','e'),m('の','no','o'),m('ち','ti','i'),m('ず','zu','u'),m('ひ','hi','i'),m('ら','ra','a'),m('く','ku','u')] },
    { text: 'まだ見ない場所', tokens: [m('ま','ma','a'),m('だ','ta','a'),m('み','mi','i'),m('な','na','a'),m('い','i','i'),m('ば','ba','a'),m('しょ','syo','o')] },
    { text: '一緒に進もう', tokens: [m('い','i','i'),m('しょ','syo','o'),m('に','ni','i'),m('す','su','u'),m('す','su','u'),m('も','mo','o'),m('う','u','u')], hook: true },
    { text: 'この旅は続く', tokens: [m('こ','ko','o'),m('の','no','o'),m('た','ta','a'),m('び','bi','i'),m('は','ha','a'),m('つ','tu','u'),m('づ','zu','u'),m('く','ku','u')], hook: true },
  ],
};

function deterministicIndex(seed: number, phraseIndex: number, size: number): number {
  if (size <= 1) return 0;
  let value = (seed ^ Math.imul(phraseIndex + 5, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  return value % size;
}

export function lyricsThemeFor(profile: GenreStyleProfile): JapaneseLyricsTheme {
  if (profile.genre === 'game-music') return 'adventure';
  if (profile.genre === 'rock') return 'future';
  if (profile.genre === 'k-pop') return profile.id === 'ballad' || profile.id === 'rnb-pop' ? 'night' : 'future';
  if (profile.id === 'city-pop' || profile.id === 'ballad') return 'night';
  return 'youth';
}

function fitTokens(tokens: readonly MoraToken[], count: number): MoraToken[] {
  if (count <= 0) return [];
  if (tokens.length === count) return tokens.map((token) => ({ ...token }));
  if (tokens.length > count) {
    const result: MoraToken[] = [];
    for (let index = 0; index < count; index += 1) {
      const sourceIndex = Math.min(tokens.length - 1, Math.floor(index * tokens.length / count));
      result.push({ ...(tokens[sourceIndex] ?? tokens[0]!) });
    }
    return result;
  }

  const result = tokens.map((token) => ({ ...token }));
  while (result.length < count) {
    const previous = result.at(-1) ?? tokens.at(-1) ?? m('あ','a','a');
    result.push({ kana: previous.kana, syllable: previous.vowel, vowel: previous.vowel });
  }
  return result;
}

function splitPhrases(line: readonly VocalEvent[]): VocalEvent[][] {
  const phrases: VocalEvent[][] = [];
  let current: VocalEvent[] = [];
  for (const event of line) {
    if (event.phraseStart && current.length > 0) {
      phrases.push(current);
      current = [];
    }
    current.push(event);
    if (event.phraseEnd) {
      phrases.push(current);
      current = [];
    }
  }
  if (current.length > 0) phrases.push(current);
  return phrases;
}

function vocalAllowed(composition: FullSongComposition, event: VocalEvent): boolean {
  const section = fullSongSectionAtStep(composition, event.step);
  return (section?.vocalScale ?? 1) > 0.24;
}

function chooseTemplate(
  bank: readonly LyricLineTemplate[],
  hook: boolean,
  phraseLength: number,
  seed: number,
  phraseIndex: number,
): LyricLineTemplate {
  const candidates = bank.filter((line) => hook ? line.hook === true : line.hook !== true);
  const usable = candidates.length > 0 ? candidates : bank;
  const ordered = [...usable].sort((a, b) => {
    const difference = Math.abs(a.tokens.length - phraseLength) - Math.abs(b.tokens.length - phraseLength);
    if (difference !== 0) return difference;
    return a.text.localeCompare(b.text, 'ja');
  });
  const bestDifference = Math.abs((ordered[0]?.tokens.length ?? phraseLength) - phraseLength);
  const closest = ordered.filter((line) => Math.abs(line.tokens.length - phraseLength) <= bestDifference + 1);
  return closest[deterministicIndex(seed, phraseIndex, closest.length)] ?? ordered[0] ?? bank[0]!;
}

export interface JapaneseLyricsResult {
  events: JapaneseLyricVocalEvent[];
  theme: JapaneseLyricsTheme;
  lines: string[];
}

export function applyJapaneseLyrics(
  composition: FullSongComposition,
  profile: GenreStyleProfile,
  vocalLine: readonly VocalEvent[],
  theme: JapaneseLyricsTheme = lyricsThemeFor(profile),
): JapaneseLyricsResult {
  const filteredVocal = vocalLine.filter((event) => vocalAllowed(composition, event));
  const phrases = splitPhrases(filteredVocal);
  const bank = LINES[theme];
  const events: JapaneseLyricVocalEvent[] = [];
  const lines: string[] = [];

  for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex += 1) {
    const phrase = phrases[phraseIndex]!;
    const section = fullSongSectionAtStep(composition, phrase[0]?.step ?? 0);
    const hook = section?.kind === 'chorus' || section?.kind === 'drop' || section?.kind === 'post' || section?.kind === 'climax';
    const template = chooseTemplate(
      bank,
      hook,
      phrase.length,
      composition.settings.seed + (section?.index ?? 0) * 97,
      phraseIndex,
    );
    const fitted = fitTokens(template.tokens, phrase.length);
    lines.push(template.text);

    for (let index = 0; index < phrase.length; index += 1) {
      const source = phrase[index]!;
      const token = fitted[index] ?? fitted.at(-1) ?? m('あ','a','a');
      const next = fitted[index + 1] ?? null;
      events.push({
        ...source,
        syllable: token.syllable,
        vowel: token.vowel,
        nextVowel: next?.vowel ?? null,
        lyric: token.kana,
        lyricLine: template.text,
      });
    }
  }

  return { events, theme, lines };
}

export function lyricTextAtStep(line: readonly JapaneseLyricVocalEvent[], step: number): string {
  return line.find((event) => event.step === step)?.lyric ?? '';
}
