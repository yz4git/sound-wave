import type { VocalVowel } from '../compose/VocalGenerator';

export type VoiceIntonation = 'natural' | 'flat' | 'rise' | 'fall' | 'question';
export type VoiceBoundary = 'none' | 'accent' | 'sentence';
export type VoicePitchAccent = 'auto' | 'low' | 'high';

export interface VoiceUnit {
  index: number;
  display: string;
  syllable: string;
  vowel: VocalVowel;
  phraseStart: boolean;
  phraseEnd: boolean;
  phraseIndex: number;
  phraseCount: number;
  accentStart: boolean;
  accentEnd: boolean;
  accentIndex: number;
  accentCount: number;
  boundaryAfter: VoiceBoundary;
  pauseAfter: number;
  geminateBefore: boolean;
  longVowel: boolean;
  moraicN: boolean;
  devoiced: boolean;
  /** Optional lexical pitch-accent state supplied by a Japanese front end. */
  pitchAccent: VoicePitchAccent;
}

export interface VoiceScript {
  units: VoiceUnit[];
  unsupported: string[];
}

interface PunctuationSpec {
  pause: number;
  boundary: VoiceBoundary;
}

const PUNCTUATION = new Map<string, PunctuationSpec>([
  ['、', { pause: 0.16, boundary: 'accent' }],
  [',', { pause: 0.14, boundary: 'accent' }],
  ['，', { pause: 0.14, boundary: 'accent' }],
  ['。', { pause: 0.34, boundary: 'sentence' }],
  ['.', { pause: 0.28, boundary: 'sentence' }],
  ['！', { pause: 0.3, boundary: 'sentence' }],
  ['!', { pause: 0.26, boundary: 'sentence' }],
  ['？', { pause: 0.34, boundary: 'sentence' }],
  ['?', { pause: 0.32, boundary: 'sentence' }],
  [';', { pause: 0.18, boundary: 'accent' }],
  ['；', { pause: 0.18, boundary: 'accent' }],
  ['・', { pause: 0.08, boundary: 'accent' }],
  ['/', { pause: 0.07, boundary: 'accent' }],
  ['\n', { pause: 0.36, boundary: 'sentence' }],
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

function boundaryRank(boundary: VoiceBoundary): number {
  if (boundary === 'sentence') return 2;
  if (boundary === 'accent') return 1;
  return 0;
}

function strongerBoundary(a: VoiceBoundary, b: VoiceBoundary): VoiceBoundary {
  return boundaryRank(a) >= boundaryRank(b) ? a : b;
}

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

function consonantClass(syllable: string): string {
  const value = syllable.toLowerCase();
  if (value === 'n' || value === 'nn') return 'N';
  if (/^(sh|s)/.test(value)) return 's';
  if (/^(ch|ts|t)/.test(value)) return 't';
  if (/^(ky|k)/.test(value)) return 'k';
  if (/^(hy|h)/.test(value)) return 'h';
  if (/^f/.test(value)) return 'f';
  if (/^p/.test(value)) return 'p';
  if (/^(gy|g)/.test(value)) return 'g';
  if (/^(j|z)/.test(value)) return 'z';
  if (/^d/.test(value)) return 'd';
  if (/^b/.test(value)) return 'b';
  if (/^m/.test(value)) return 'm';
  if (/^n/.test(value)) return 'n';
  if (/^(ry|r)/.test(value)) return 'r';
  if (/^y/.test(value)) return 'y';
  if (/^w/.test(value)) return 'w';
  if (/^v/.test(value)) return 'v';
  return 'vowel';
}

function isVoicelessConsonant(syllable: string): boolean {
  const consonant = consonantClass(syllable);
  return consonant === 'k'
    || consonant === 's'
    || consonant === 't'
    || consonant === 'h'
    || consonant === 'f'
    || consonant === 'p';
}

function pushUnit(
  units: VoiceUnit[],
  display: string,
  syllable: string,
  vowel: VocalVowel,
  flags: { geminateBefore?: boolean; longVowel?: boolean } = {},
): void {
  units.push({
    index: units.length,
    display,
    syllable,
    vowel,
    phraseStart: false,
    phraseEnd: false,
    phraseIndex: 0,
    phraseCount: 1,
    accentStart: false,
    accentEnd: false,
    accentIndex: 0,
    accentCount: 1,
    boundaryAfter: 'none',
    pauseAfter: 0,
    geminateBefore: flags.geminateBefore ?? false,
    longVowel: flags.longVowel ?? false,
    moraicN: syllable === 'n' || syllable === 'nn',
    devoiced: false,
    pitchAccent: 'auto',
  });
}

function markPause(units: VoiceUnit[], pause: number, boundary: VoiceBoundary): void {
  const previous = units[units.length - 1];
  if (!previous) return;
  previous.pauseAfter = Math.max(previous.pauseAfter, pause);
  previous.boundaryAfter = strongerBoundary(previous.boundaryAfter, boundary);
}

function parseRomajiWord(
  word: string,
  units: VoiceUnit[],
  unsupported: string[],
  pendingGeminate: { value: boolean },
): void {
  const value = word.toLowerCase().replace(/[^a-z']/g, '');
  if (!value) return;
  const combos = [
    'kya','kyu','kyo','sha','shu','sho','cha','chu','cho','nya','nyu','nyo',
    'hya','hyu','hyo','mya','myu','myo','rya','ryu','ryo','gya','gyu','gyo',
    'ja','ju','jo','bya','byu','byo','pya','pyu','pyo','shi','chi','tsu','fu',
  ];
  let index = 0;

  while (index < value.length) {
    const tail = value.slice(index);
    const char = value[index] ?? '';
    const next = value[index + 1] ?? '';

    if (char && next && char === next && /[kstpgzdbcf]/.test(char)) {
      pendingGeminate.value = true;
      index += 1;
      continue;
    }

    const combo = combos.find((candidate) => tail.startsWith(candidate));
    if (combo) {
      pushUnit(units, combo, combo, vowelOf(combo), { geminateBefore: pendingGeminate.value });
      pendingGeminate.value = false;
      index += combo.length;
      continue;
    }

    if ('aeiou'.includes(char)) {
      pushUnit(units, char, char, char as VocalVowel, { geminateBefore: pendingGeminate.value });
      pendingGeminate.value = false;
      index += 1;
      continue;
    }

    if (char === 'n' && (!next || !'aeiouy'.includes(next))) {
      const fallback = units[units.length - 1]?.vowel ?? 'u';
      pushUnit(units, 'n', 'n', fallback, { geminateBefore: pendingGeminate.value });
      pendingGeminate.value = false;
      index += 1;
      continue;
    }

    if (/[bcdfghjklmpqrstvwxyz]/.test(char) && 'aeiou'.includes(next)) {
      const syllable = char + next;
      pushUnit(units, syllable, syllable, next as VocalVowel, { geminateBefore: pendingGeminate.value });
      pendingGeminate.value = false;
      index += 2;
      continue;
    }

    unsupported.push(char);
    index += 1;
  }
}

function annotateRuns(
  units: VoiceUnit[],
  isBoundary: (unit: VoiceUnit, index: number) => boolean,
  assign: (unit: VoiceUnit, localIndex: number, count: number) => void,
): void {
  let start = 0;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (!unit) continue;
    const isLast = index === units.length - 1;
    if (!isBoundary(unit, index) && !isLast) continue;

    const end = index;
    const count = Math.max(1, end - start + 1);
    for (let cursor = start; cursor <= end; cursor += 1) {
      const candidate = units[cursor];
      if (candidate) assign(candidate, cursor - start, count);
    }
    start = index + 1;
  }
}

export function finalizeVoiceUnits(units: VoiceUnit[]): void {
  if (units.length === 0) return;
  const final = units[units.length - 1]!;
  final.boundaryAfter = 'sentence';

  annotateRuns(
    units,
    (unit) => unit.boundaryAfter === 'sentence',
    (unit, localIndex, count) => {
      unit.phraseIndex = localIndex;
      unit.phraseCount = count;
      unit.phraseStart = localIndex === 0;
      unit.phraseEnd = localIndex === count - 1;
    },
  );

  annotateRuns(
    units,
    (unit) => unit.boundaryAfter !== 'none',
    (unit, localIndex, count) => {
      unit.accentIndex = localIndex;
      unit.accentCount = count;
      unit.accentStart = localIndex === 0;
      unit.accentEnd = localIndex === count - 1;
    },
  );

  let previousDevoiced = false;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]!;
    const next = units[index + 1];
    const highVowel = unit.vowel === 'i' || unit.vowel === 'u';
    const nextVoiceless = next ? isVoicelessConsonant(next.syllable) : false;
    const beforePause = unit.boundaryAfter !== 'none' && unit.pauseAfter <= 0.36;
    const candidate = highVowel
      && !unit.longVowel
      && !unit.moraicN
      && isVoicelessConsonant(unit.syllable)
      && (nextVoiceless || beforePause);

    // Avoid fully suppressing adjacent high-vowel morae; real speech typically
    // preserves enough timing/energy for intelligibility when devoicing
    // environments repeat.
    unit.devoiced = candidate && !previousDevoiced;
    previousDevoiced = unit.devoiced;
  }
}

export function parseVoiceScript(text: string): VoiceScript {
  const normalized = toHiragana(text.normalize('NFKC'));
  const units: VoiceUnit[] = [];
  const unsupported: string[] = [];
  const pendingGeminate = { value: false };
  let index = 0;

  while (index < normalized.length) {
    const char = normalized[index]!;
    const punctuation = PUNCTUATION.get(char);
    if (punctuation) {
      markPause(units, punctuation.pause, punctuation.boundary);
      index += 1;
      continue;
    }

    if (/\s/.test(char)) {
      markPause(units, 0.065, 'accent');
      index += 1;
      continue;
    }

    if (char === 'っ') {
      pendingGeminate.value = true;
      index += 1;
      continue;
    }

    if (char === 'ー') {
      const previous = units[units.length - 1];
      if (previous) {
        pushUnit(units, 'ー', previous.vowel, previous.vowel, { longVowel: true });
      }
      index += 1;
      continue;
    }

    const pair = normalized.slice(index, index + 2);
    const pairSyllable = KANA[pair];
    if (pairSyllable) {
      pushUnit(
        units,
        pair,
        pairSyllable,
        vowelOf(pairSyllable, units[units.length - 1]?.vowel),
        { geminateBefore: pendingGeminate.value },
      );
      pendingGeminate.value = false;
      index += 2;
      continue;
    }

    const syllable = KANA[char];
    if (syllable) {
      pushUnit(
        units,
        char,
        syllable,
        vowelOf(syllable, units[units.length - 1]?.vowel),
        { geminateBefore: pendingGeminate.value },
      );
      pendingGeminate.value = false;
      index += 1;
      continue;
    }

    if (/[A-Za-z]/.test(char)) {
      let end = index + 1;
      while (end < normalized.length && /[A-Za-z']/i.test(normalized[end]!)) end += 1;
      parseRomajiWord(normalized.slice(index, end), units, unsupported, pendingGeminate);
      index = end;
      continue;
    }

    if (/\p{Script=Han}/u.test(char)) unsupported.push(char);
    else if (!/[-_]/.test(char)) unsupported.push(char);
    index += 1;
  }

  finalizeVoiceUnits(units);
  return { units, unsupported: [...new Set(unsupported)] };
}

function accentPhraseOffset(unit: VoiceUnit): number {
  if (unit.pitchAccent !== 'auto') {
    const lexical = unit.pitchAccent === 'high' ? 0.44 : -0.42;
    const declination = unit.pitchAccent === 'high' ? unit.accentIndex * 0.055 : 0;
    return lexical - declination - (unit.accentEnd ? 0.08 : 0);
  }
  if (unit.accentCount <= 1) return 0;
  if (unit.accentIndex === 0) return -0.48;
  const decline = Math.max(0, unit.accentIndex - 1) * 0.11;
  const crest = 0.5 - decline;
  return crest - (unit.accentEnd ? 0.16 : 0);
}

function consonantMicroProsody(unit: VoiceUnit): number {
  const consonant = consonantClass(unit.syllable);
  if (consonant === 'k' || consonant === 's' || consonant === 't' || consonant === 'h' || consonant === 'f' || consonant === 'p') {
    return 0.16;
  }
  if (consonant === 'g' || consonant === 'z' || consonant === 'd' || consonant === 'b' || consonant === 'v') {
    return -0.11;
  }
  if (unit.moraicN) return -0.08;
  if (unit.longVowel) return -0.06;
  return 0;
}

export function prosodyOffsetForUnit(
  unit: VoiceUnit,
  index: number,
  count: number,
  intonation: VoiceIntonation,
): number {
  if (intonation === 'flat') return 0;

  const phraseProgress = unit.phraseCount <= 1
    ? 0
    : unit.phraseIndex / Math.max(1, unit.phraseCount - 1);
  const phraseArc = Math.sin(phraseProgress * Math.PI) * 0.24 - phraseProgress * 0.42;
  const accent = accentPhraseOffset(unit);
  const micro = consonantMicroProsody(unit);
  const globalDeclination = count <= 1 ? 0 : -(index / Math.max(1, count - 1)) * 0.12;

  if (intonation === 'rise') {
    return -0.7 + phraseProgress * 1.9 + accent * 0.35 + micro;
  }
  if (intonation === 'fall') {
    return 0.72 - phraseProgress * 1.8 + accent * 0.35 + micro;
  }
  if (intonation === 'question') {
    const questionLift = unit.phraseEnd ? 1.85 : phraseProgress > 0.72 ? (phraseProgress - 0.72) * 1.2 : 0;
    return phraseArc + accent * 0.8 + micro + questionLift + globalDeclination;
  }

  const reset = unit.phraseStart ? 0.18 : 0;
  const finalLowering = unit.phraseEnd ? -0.2 : 0;
  return phraseArc + accent + micro + reset + finalLowering + globalDeclination;
}

// Kept as a simple public contour helper for tests and external callers.
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
