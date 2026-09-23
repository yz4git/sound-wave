import type { VocalVowel } from '../compose/VocalGenerator';

export type VoiceIntonation = 'natural' | 'flat' | 'rise' | 'fall' | 'question';

export interface VoiceUnit {
  index: number;
  display: string;
  syllable: string;
  vowel: VocalVowel;
  phraseStart: boolean;
  phraseEnd: boolean;
  pauseAfter: number;
}

export interface VoiceScript {
  units: VoiceUnit[];
  unsupported: string[];
}

const PUNCTUATION = new Map<string, number>([
  ['、', 0.16], [',', 0.14], ['，', 0.14],
  ['。', 0.34], ['.', 0.28], ['！', 0.3], ['!', 0.26],
  ['？', 0.34], ['?', 0.32], [';', 0.18], ['；', 0.18],
  ['\n', 0.36],
]);

const KANA: Record<string, string> = {
  'あ':'a','い':'i','う':'u','え':'e','お':'o',
  'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
  'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
  'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
  'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
  'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
  'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
  'や':'ya','ゆ':'yu','よ':'yo',
  'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
  'わ':'wa','を':'o','ん':'n',
  'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
  'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
  'だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do',
  'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
  'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
  'ゔ':'vu',
  'ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o',
  'きゃ':'kya','きゅ':'kyu','きょ':'kyo',
  'しゃ':'sha','しゅ':'shu','しょ':'sho',
  'ちゃ':'cha','ちゅ':'chu','ちょ':'cho',
  'にゃ':'nya','にゅ':'nyu','にょ':'nyo',
  'ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo',
  'みゃ':'mya','みゅ':'myu','みょ':'myo',
  'りゃ':'rya','りゅ':'ryu','りょ':'ryo',
  'ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo',
  'じゃ':'ja','じゅ':'ju','じょ':'jo',
  'びゃ':'bya','びゅ':'byu','びょ':'byo',
  'ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo',
  'ふぁ':'fa','ふぃ':'fi','ふぇ':'fe','ふぉ':'fo',
  'てぃ':'ti','でぃ':'di','とぅ':'tu','どぅ':'du',
  'うぃ':'wi','うぇ':'we','うぉ':'wo',
  'ゔぁ':'va','ゔぃ':'vi','ゔぇ':'ve','ゔぉ':'vo',
};

function toHiragana(value: string): string {
  return [...value].map((char) => {
    const code = char.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char;
  }).join('');
}

function vowelOf(syllable: string, fallback: VocalVowel = 'a'): VocalVowel {
  const normalized = syllable.toLowerCase();
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const char = normalized[index];
    if (char === 'a' || char === 'e' || char === 'i' || char === 'o' || char === 'u') return char;
  }
  return fallback;
}

function pushUnit(units: VoiceUnit[], display: string, syllable: string, vowel: VocalVowel): void {
  const previous = units[units.length - 1];
  const phraseStart = !previous || previous.phraseEnd || previous.pauseAfter >= 0.28;
  units.push({
    index: units.length,
    display,
    syllable,
    vowel,
    phraseStart,
    phraseEnd: false,
    pauseAfter: 0,
  });
}

function markPause(units: VoiceUnit[], pause: number): void {
  const previous = units[units.length - 1];
  if (!previous) return;
  previous.pauseAfter = Math.max(previous.pauseAfter, pause);
  if (pause >= 0.24) previous.phraseEnd = true;
}

function parseRomajiWord(word: string, units: VoiceUnit[], unsupported: string[]): void {
  let value = word.toLowerCase().replace(/[^a-z']/g, '');
  if (!value) return;
  const combos = ['kya','kyu','kyo','sha','shu','sho','cha','chu','cho','nya','nyu','nyo','hya','hyu','hyo','mya','myu','myo','rya','ryu','ryo','gya','gyu','gyo','ja','ju','jo','bya','byu','byo','pya','pyu','pyo','shi','chi','tsu','fu'];
  let index = 0;
  while (index < value.length) {
    const tail = value.slice(index);
    const combo = combos.find((candidate) => tail.startsWith(candidate));
    if (combo) {
      pushUnit(units, combo, combo, vowelOf(combo));
      index += combo.length;
      continue;
    }

    const char = value[index]!;
    const next = value[index + 1] ?? '';
    if ('aeiou'.includes(char)) {
      pushUnit(units, char, char, char as VocalVowel);
      index += 1;
      continue;
    }
    if (char === 'n' && (!next || !'aeiouy'.includes(next))) {
      const fallback = units[units.length - 1]?.vowel ?? 'u';
      pushUnit(units, 'n', 'n', fallback);
      index += 1;
      continue;
    }
    if (/[bcdfghjklmpqrstvwxyz]/.test(char) && 'aeiou'.includes(next)) {
      const syllable = char + next;
      pushUnit(units, syllable, syllable, next as VocalVowel);
      index += 2;
      continue;
    }
    unsupported.push(char);
    index += 1;
  }
}

export function parseVoiceScript(text: string): VoiceScript {
  const normalized = toHiragana(text.normalize('NFKC'));
  const units: VoiceUnit[] = [];
  const unsupported: string[] = [];
  let index = 0;
  let geminate = false;

  while (index < normalized.length) {
    const char = normalized[index]!;
    const punctuationPause = PUNCTUATION.get(char);
    if (punctuationPause !== undefined) {
      markPause(units, punctuationPause);
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      markPause(units, 0.08);
      index += 1;
      continue;
    }
    if (char === 'っ') {
      geminate = true;
      markPause(units, 0.045);
      index += 1;
      continue;
    }
    if (char === 'ー') {
      const previous = units[units.length - 1];
      if (previous) pushUnit(units, 'ー', previous.vowel, previous.vowel);
      index += 1;
      continue;
    }

    const pair = normalized.slice(index, index + 2);
    const pairSyllable = KANA[pair];
    if (pairSyllable) {
      const syllable = geminate ? pairSyllable : pairSyllable;
      pushUnit(units, pair, syllable, vowelOf(pairSyllable, units[units.length - 1]?.vowel));
      geminate = false;
      index += 2;
      continue;
    }

    const syllable = KANA[char];
    if (syllable) {
      pushUnit(units, char, syllable, vowelOf(syllable, units[units.length - 1]?.vowel));
      geminate = false;
      index += 1;
      continue;
    }

    if (/[A-Za-z]/.test(char)) {
      let end = index + 1;
      while (end < normalized.length && /[A-Za-z']/i.test(normalized[end]!)) end += 1;
      parseRomajiWord(normalized.slice(index, end), units, unsupported);
      index = end;
      continue;
    }

    if (/\p{Script=Han}/u.test(char)) unsupported.push(char);
    else if (!/[-_]/.test(char)) unsupported.push(char);
    index += 1;
  }

  if (units.length > 0) units[units.length - 1]!.phraseEnd = true;
  return { units, unsupported: [...new Set(unsupported)] };
}

export function prosodyOffset(
  index: number,
  count: number,
  intonation: VoiceIntonation,
  phraseStart: boolean,
  phraseEnd: boolean,
): number {
  if (count <= 1) return intonation === 'question' ? 1.2 : 0;
  const progress = index / Math.max(1, count - 1);
  if (intonation === 'flat') return 0;
  if (intonation === 'rise') return -0.8 + progress * 2.2;
  if (intonation === 'fall') return 0.9 - progress * 2.3;
  if (intonation === 'question') return phraseEnd ? 2.2 : -0.25 + Math.sin(progress * Math.PI) * 0.6;
  const phraseShape = Math.sin(progress * Math.PI) * 0.85 - progress * 0.65;
  return phraseShape + (phraseStart ? 0.2 : 0) + (phraseEnd ? -0.35 : 0);
}
