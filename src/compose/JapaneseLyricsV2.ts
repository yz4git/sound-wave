import type { FullSongComposition } from './FullSongComposer';
import { fullSongSectionAtStep } from './FullSongComposer';
import type { GenreStyleProfile } from './GenreStyle';
import { lyricsThemeFor, type JapaneseLyricsTheme, type JapaneseLyricVocalEvent } from './JapaneseLyrics';
import type { VocalEvent, VocalVowel } from './VocalGenerator';

interface LyricToken {
  kana: string;
  syllable: string;
  vowel: VocalVowel;
}

interface StoryLine {
  text: string;
  reading: string;
}

type StoryRole = 'verse1' | 'pre' | 'hook' | 'verse2' | 'bridge' | 'final-hook' | 'outro';

type ThemeStory = Record<StoryRole, readonly StoryLine[]>;

const STORIES: Record<JapaneseLyricsTheme, ThemeStory> = {
  youth: {
    verse1: [
      { text: '青い空を見上げた', reading: 'あおいそらをみあげた' },
      { text: '昨日より少し遠くへ', reading: 'きのうよりすこしとおくへ' },
    ],
    pre: [
      { text: '胸の奥で鳴る声', reading: 'むねのおくでなるこえ' },
      { text: 'もう迷わないから', reading: 'もうまよわないから' },
    ],
    hook: [
      { text: 'この声を届けたい', reading: 'このこえをとどけたい' },
      { text: '君と未来へ走ろう', reading: 'きみとみらいへはしろう' },
    ],
    verse2: [
      { text: '転んだ跡も抱えて', reading: 'ころんだあともかかえて' },
      { text: '新しい朝を選ぶ', reading: 'あたらしいあさをえらぶ' },
    ],
    bridge: [
      { text: '一人じゃ見えなかった', reading: 'ひとりじゃみえなかった' },
      { text: '君がくれた光', reading: 'きみがくれたひかり' },
    ],
    'final-hook': [
      { text: 'この声は届いてる', reading: 'このこえはとどいてる' },
      { text: '君と未来を始めよう', reading: 'きみとみらいをはじめよう' },
    ],
    outro: [{ text: '青い空の向こうへ', reading: 'あおいそらのむこうへ' }],
  },
  night: {
    verse1: [
      { text: '夜の窓に月が揺れる', reading: 'よるのまどにつきがゆれる' },
      { text: '言えない言葉を隠した', reading: 'いえないことばをかくした' },
    ],
    pre: [
      { text: '静かな鼓動が近づく', reading: 'しずかなこどうがちかづく' },
      { text: 'あと少しだけそばに', reading: 'あとすこしだけそばに' },
    ],
    hook: [
      { text: '夜明けまで君を探す', reading: 'よあけまできみをさがす' },
      { text: '消えない光を信じて', reading: 'きえないひかりをしんじて' },
    ],
    verse2: [
      { text: '遠い足音を追いかけ', reading: 'とおいあしおとをおいかけ' },
      { text: '昨日の影をほどいた', reading: 'きのうのかげをほどいた' },
    ],
    bridge: [
      { text: '涙の理由を知った', reading: 'なみだのりゆうをしった' },
      { text: '朝はもう怖くない', reading: 'あさはもうこわくない' },
    ],
    'final-hook': [
      { text: '夜明けには君と歌う', reading: 'よあけにはきみとうたう' },
      { text: '消えない光になろう', reading: 'きえないひかりになろう' },
    ],
    outro: [{ text: '月は朝へ溶けてゆく', reading: 'つきはあさへとけてゆく' }],
  },
  future: {
    verse1: [
      { text: 'まだ白い地図を開く', reading: 'まだしろいちずをひらく' },
      { text: '境界線の向こう側', reading: 'きょうかいせんのむこうがわ' },
    ],
    pre: [
      { text: '小さな鼓動を重ねて', reading: 'ちいさなこどうをかさねて' },
      { text: '今ゼロから飛び出す', reading: 'いまぜろからとびだす' },
    ],
    hook: [
      { text: '未来をここから鳴らそう', reading: 'みらいをここからならそう' },
      { text: '新しい世界へ行こう', reading: 'あたらしいせかいへいこう' },
    ],
    verse2: [
      { text: '失敗さえも書き換えて', reading: 'しっぱいさえもかきかえて' },
      { text: '選んだ道をつないだ', reading: 'えらんだみちをつないだ' },
    ],
    bridge: [
      { text: '答えは先にないから', reading: 'こたえはさきにないから' },
      { text: '僕らの手で作ろう', reading: 'ぼくらのてでつくろう' },
    ],
    'final-hook': [
      { text: '未来はここから始まる', reading: 'みらいはここからはじまる' },
      { text: '新しい世界を描こう', reading: 'あたらしいせかいをえがこう' },
    ],
    outro: [{ text: '光はまだ続いてる', reading: 'ひかりはまだつづいてる' }],
  },
  adventure: {
    verse1: [
      { text: '遠い道の先を目指す', reading: 'とおいみちのさきをめざす' },
      { text: '風の地図を胸にしまう', reading: 'かぜのちずをむねにしまう' },
    ],
    pre: [
      { text: '知らない景色が呼んでる', reading: 'しらないけしきがよんでる' },
      { text: '次の扉を開こう', reading: 'つぎのとびらをひらこう' },
    ],
    hook: [
      { text: 'この旅を君と続けよう', reading: 'このたびをきみとつづけよう' },
      { text: 'まだ見ない場所へ行こう', reading: 'まだみないばしょへいこう' },
    ],
    verse2: [
      { text: '嵐の夜も越えてきた', reading: 'あらしのよるもこえてきた' },
      { text: '足跡が道に変わる', reading: 'あしあとがみちにかわる' },
    ],
    bridge: [
      { text: '帰る場所があるから', reading: 'かえるばしょがあるから' },
      { text: 'もっと遠くへ行ける', reading: 'もっととおくへいける' },
    ],
    'final-hook': [
      { text: 'この旅はまだ終わらない', reading: 'このたびはまだおわらない' },
      { text: '君と新しい空へ行こう', reading: 'きみとあたらしいそらへいこう' },
    ],
    outro: [{ text: '風は次の朝へ吹く', reading: 'かぜはつぎのあさへふく' }],
  },
};

const VOWELS: Record<string, VocalVowel> = { あ: 'a', か: 'a', さ: 'a', た: 'a', な: 'a', は: 'a', ま: 'a', や: 'a', ら: 'a', わ: 'a', が: 'a', ざ: 'a', だ: 'a', ば: 'a', ぱ: 'a',
  い: 'i', き: 'i', し: 'i', ち: 'i', に: 'i', ひ: 'i', み: 'i', り: 'i', ぎ: 'i', じ: 'i', び: 'i', ぴ: 'i',
  う: 'u', く: 'u', す: 'u', つ: 'u', ぬ: 'u', ふ: 'u', む: 'u', ゆ: 'u', る: 'u', ぐ: 'u', ず: 'u', ぶ: 'u', ぷ: 'u',
  え: 'e', け: 'e', せ: 'e', て: 'e', ね: 'e', へ: 'e', め: 'e', れ: 'e', げ: 'e', ぜ: 'e', で: 'e', べ: 'e', ぺ: 'e',
  お: 'o', こ: 'o', そ: 'o', と: 'o', の: 'o', ほ: 'o', も: 'o', よ: 'o', ろ: 'o', を: 'o', ご: 'o', ぞ: 'o', ど: 'o', ぼ: 'o', ぽ: 'o' };

const ROMAJI: Record<string, string> = {
  あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',さ:'sa',し:'si',す:'su',せ:'se',そ:'so',た:'ta',ち:'ti',つ:'tu',て:'te',と:'to',な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',を:'o',
  が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',ざ:'za',じ:'zi',ず:'zu',ぜ:'ze',ぞ:'zo',だ:'ta',で:'te',ど:'to',ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',
  きゃ:'kya',きゅ:'kyu',きょ:'kyo',しゃ:'sya',しゅ:'syu',しょ:'syo',ちゃ:'tya',ちゅ:'tyu',ちょ:'tyo',にゃ:'nya',にゅ:'nyu',にょ:'nyo',ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',みゃ:'mya',みゅ:'myu',みょ:'myo',りゃ:'rya',りゅ:'ryu',りょ:'ryo',じゃ:'zya',じゅ:'zyu',じょ:'zyo',びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',
};

function vowelFor(kana: string): VocalVowel {
  const last = kana.at(-1) ?? 'あ';
  if (last === 'ゃ') return 'a';
  if (last === 'ゅ') return 'u';
  if (last === 'ょ') return 'o';
  return VOWELS[last] ?? 'a';
}

function tokenizeReading(reading: string): LyricToken[] {
  const normalized = reading.replace(/[\s、。！？!?]/g, '');
  const result: LyricToken[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    if (char === 'っ') continue;
    if (char === 'ん') {
      result.push({ kana: 'ん', syllable: 'n', vowel: 'u' });
      continue;
    }
    const pair = normalized.slice(index, index + 2);
    if (ROMAJI[pair]) {
      result.push({ kana: pair, syllable: ROMAJI[pair]!, vowel: vowelFor(pair) });
      index += 1;
      continue;
    }
    const syllable = ROMAJI[char];
    if (!syllable) continue;
    result.push({ kana: char, syllable, vowel: vowelFor(char) });
  }
  return result;
}

function fitTokens(tokens: readonly LyricToken[], count: number): LyricToken[] {
  if (count <= 0) return [];
  if (tokens.length === 0) return Array.from({ length: count }, () => ({ kana: 'あ', syllable: 'a', vowel: 'a' as const }));
  if (tokens.length >= count) {
    return Array.from({ length: count }, (_, index) => ({ ...tokens[Math.min(tokens.length - 1, Math.floor(index * tokens.length / count))]! }));
  }
  const result = tokens.map((token) => ({ ...token }));
  while (result.length < count) {
    const last = result.at(-1)!;
    result.push({ kana: last.kana, syllable: last.vowel, vowel: last.vowel });
  }
  return result;
}

function splitPhrases(line: readonly VocalEvent[]): VocalEvent[][] {
  const phrases: VocalEvent[][] = [];
  let current: VocalEvent[] = [];
  for (const event of line) {
    if (event.phraseStart && current.length > 0) { phrases.push(current); current = []; }
    current.push(event);
    if (event.phraseEnd) { phrases.push(current); current = []; }
  }
  if (current.length > 0) phrases.push(current);
  return phrases;
}

function roleFor(composition: FullSongComposition, step: number): StoryRole | null {
  const section = fullSongSectionAtStep(composition, step);
  if (!section || section.vocalScale <= 0.24) return null;
  if (section.kind === 'pre') return 'pre';
  if (section.kind === 'bridge') return 'bridge';
  if (section.kind === 'outro') return 'outro';
  if (section.kind === 'chorus' || section.kind === 'drop' || section.kind === 'post' || section.kind === 'climax') {
    const hooks = composition.songSections.filter((candidate) => candidate.kind === section.kind || (candidate.kind === 'chorus' && section.kind === 'chorus'));
    const final = hooks.at(-1)?.index === section.index;
    return final ? 'final-hook' : 'hook';
  }
  const verseSections = composition.songSections.filter((candidate) => candidate.kind === 'verse');
  const secondVerse = verseSections.length > 1 && section.index >= (verseSections[1]?.index ?? Number.POSITIVE_INFINITY);
  return secondVerse ? 'verse2' : 'verse1';
}

function chooseLine(story: ThemeStory, role: StoryRole, phraseIndex: number, seed: number): StoryLine {
  const bank = story[role];
  const index = Math.abs((seed ^ Math.imul(phraseIndex + 7, 1103515245)) >>> 0) % bank.length;
  return bank[index] ?? bank[0]!;
}

export interface JapaneseLyricsV2Result {
  events: JapaneseLyricVocalEvent[];
  theme: JapaneseLyricsTheme;
  lines: string[];
}

export function applyJapaneseLyricsV2(
  composition: FullSongComposition,
  profile: GenreStyleProfile,
  vocalLine: readonly VocalEvent[],
  theme: JapaneseLyricsTheme = lyricsThemeFor(profile),
): JapaneseLyricsV2Result {
  const allowed = vocalLine.filter((event) => roleFor(composition, event.step) !== null);
  const phrases = splitPhrases(allowed);
  const story = STORIES[theme];
  const events: JapaneseLyricVocalEvent[] = [];
  const lines: string[] = [];

  for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex += 1) {
    const phrase = phrases[phraseIndex]!;
    const role = roleFor(composition, phrase[0]?.step ?? 0) ?? 'verse1';
    const line = chooseLine(story, role, phraseIndex, composition.settings.seed);
    const fitted = fitTokens(tokenizeReading(line.reading), phrase.length);
    lines.push(line.text);

    for (let index = 0; index < phrase.length; index += 1) {
      const source = phrase[index]!;
      const token = fitted[index] ?? fitted.at(-1)!;
      const next = fitted[index + 1] ?? null;
      events.push({
        ...source,
        syllable: token.syllable,
        vowel: token.vowel,
        nextVowel: next?.vowel ?? null,
        phraseStart: index === 0,
        phraseEnd: index === phrase.length - 1,
        lyric: token.kana,
        lyricLine: line.text,
      });
    }
  }

  return { events, theme, lines };
}

export function uniqueLyricLines(events: readonly JapaneseLyricVocalEvent[]): string[] {
  const result: string[] = [];
  for (const event of events) {
    if (!result.includes(event.lyricLine)) result.push(event.lyricLine);
  }
  return result;
}
