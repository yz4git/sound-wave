import type { VocalVowel } from '../compose/VocalGenerator';

export type VoiceIntonation = 'auto' | 'natural' | 'flat' | 'rise' | 'fall' | 'question';
export type VoiceResolvedIntonation = Exclude<VoiceIntonation, 'auto'> | 'exclaim' | 'content-question';
export type VoiceBoundary = 'none' | 'accent' | 'sentence';
export type VoicePitchAccent = 'auto' | 'low' | 'high';
export type VoiceSentenceTerminal = 'statement' | 'question' | 'exclamation';
export type VoiceSentenceAttitude = 'none' | 'shared' | 'assertive' | 'wonder' | 'uncertain';
export type VoiceQuestionKind = 'none' | 'yes-no' | 'content';
export type VoiceContinuationKind =
  | 'none'
  | 'contrast'
  | 'cause'
  | 'condition'
  | 'concessive'
  | 'additive';
export type VoiceDiscourseRole = 'none' | 'topic' | 'subject' | 'quote' | 'list' | 'focus';
export type VoiceSpeechEventKind = 'laugh' | 'sigh' | 'inhale' | 'restart' | 'rethink';

export interface VoiceSpeechEvent {
  kind: VoiceSpeechEventKind;
  /** Unit immediately before the event. -1 means before the first mora. */
  afterUnit: number;
  /** Character offset in speech text after markup removal. */
  textOffset: number;
  strength: number;
}

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
  accentPhraseIndex: number;
  accentPhraseCount: number;
  boundaryAfter: VoiceBoundary;
  pauseAfter: number;
  boundaryBefore: VoiceBoundary;
  pauseBefore: number;
  questionKind: VoiceQuestionKind;
  questionFocus: boolean;
  sentenceAttitude: VoiceSentenceAttitude;
  sentenceHesitation: boolean;
  attitudeFocus: boolean;
  suppressAttitudeInference: boolean;
  continuationAfter: VoiceContinuationKind;
  continuationBefore: VoiceContinuationKind;
  suppressContinuationInference: boolean;
  discourseAfter: VoiceDiscourseRole;
  discourseBefore: VoiceDiscourseRole;
  focusStrength: number;
  quoted: boolean;
  parenthetical: boolean;
  breathBefore: number;
  breathAfter: boolean;
  expressivePauseAfter: number;
  hesitationAfter: boolean;
  filledPause: boolean;
  autoRateScale: number;
  /** Explicit punctuation attached to this mora, when it ends a sentence. */
  terminalAfter?: VoiceSentenceTerminal;
  /** Sentence-level terminal copied to every mora for AUTO intonation. */
  sentenceTerminal?: VoiceSentenceTerminal;
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
  events: VoiceSpeechEvent[];
}

interface PunctuationSpec {
  pause: number;
  boundary: VoiceBoundary;
  terminal?: VoiceSentenceTerminal;
}

interface VoiceSpeechEventMarker {
  kind: VoiceSpeechEventKind;
  textOffset: number;
  strength: number;
}

const SPEECH_EVENT_MARKERS: readonly {
  raw: string;
  kind: VoiceSpeechEventKind;
  strength: number;
}[] = [
  { raw: '(言い直し)', kind: 'restart', strength: 1 },
  { raw: '(思い直し)', kind: 'rethink', strength: 1 },
  { raw: '(ため息)', kind: 'sigh', strength: 0.82 },
  { raw: '(溜息)', kind: 'sigh', strength: 0.82 },
  { raw: '(笑)', kind: 'laugh', strength: 0.68 },
  { raw: '(息)', kind: 'inhale', strength: 0.72 },
  { raw: '[restart]', kind: 'restart', strength: 1 },
  { raw: '[rethink]', kind: 'rethink', strength: 1 },
  { raw: '[inhale]', kind: 'inhale', strength: 0.72 },
  { raw: '[laugh]', kind: 'laugh', strength: 0.68 },
  { raw: '[sigh]', kind: 'sigh', strength: 0.82 },
] as const;

export function stripVoiceSpeechEventMarkup(text: string): {
  text: string;
  markers: VoiceSpeechEventMarker[];
} {
  const normalized = text.normalize('NFKC');
  const markers: VoiceSpeechEventMarker[] = [];
  let cleaned = '';
  let index = 0;

  while (index < normalized.length) {
    const marker = SPEECH_EVENT_MARKERS.find((candidate) => (
      normalized.startsWith(candidate.raw, index)
    ));
    if (!marker) {
      cleaned += normalized[index]!;
      index += 1;
      continue;
    }
    markers.push({
      kind: marker.kind,
      textOffset: cleaned.length,
      strength: marker.strength,
    });
    index += marker.raw.length;
  }

  return { text: cleaned, markers };
}

export function remapVoiceSpeechEvents(
  events: readonly VoiceSpeechEvent[],
  ranges: readonly { start: number; end: number }[],
): VoiceSpeechEvent[] {
  return events.map((event) => {
    let afterUnit = -1;
    for (let index = 0; index < ranges.length; index += 1) {
      if (ranges[index]!.end <= event.textOffset) afterUnit = index;
      else break;
    }
    return { ...event, afterUnit };
  });
}

const QUOTE_OPEN = new Set(['「', '『', '“', '〝']);
const QUOTE_CLOSE = new Set(['」', '』', '”', '〟']);
const PAREN_OPEN = new Set(['(', '[', '【', '〈', '《']);
const PAREN_CLOSE = new Set([')', ']', '】', '〉', '》']);

const PUNCTUATION = new Map<string, PunctuationSpec>([
  ['、', { pause: 0.16, boundary: 'accent' }],
  [',', { pause: 0.14, boundary: 'accent' }],
  ['，', { pause: 0.14, boundary: 'accent' }],
  ['。', { pause: 0.34, boundary: 'sentence', terminal: 'statement' }],
  ['.', { pause: 0.28, boundary: 'sentence', terminal: 'statement' }],
  ['！', { pause: 0.3, boundary: 'sentence', terminal: 'exclamation' }],
  ['!', { pause: 0.26, boundary: 'sentence', terminal: 'exclamation' }],
  ['？', { pause: 0.34, boundary: 'sentence', terminal: 'question' }],
  ['?', { pause: 0.32, boundary: 'sentence', terminal: 'question' }],
  [';', { pause: 0.18, boundary: 'accent' }],
  ['；', { pause: 0.18, boundary: 'accent' }],
  ['・', { pause: 0.08, boundary: 'accent' }],
  ['/', { pause: 0.07, boundary: 'accent' }],
  ['\n', { pause: 0.36, boundary: 'sentence', terminal: 'statement' }],
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
    accentPhraseIndex: 0,
    accentPhraseCount: 1,
    boundaryAfter: 'none',
    pauseAfter: 0,
    boundaryBefore: 'none',
    pauseBefore: 0,
    questionKind: 'none',
    questionFocus: false,
    sentenceAttitude: 'none',
    sentenceHesitation: false,
    attitudeFocus: false,
    suppressAttitudeInference: false,
    continuationAfter: 'none',
    continuationBefore: 'none',
    suppressContinuationInference: false,
    discourseAfter: 'none',
    discourseBefore: 'none',
    focusStrength: 0,
    quoted: false,
    parenthetical: false,
    breathBefore: 0,
    breathAfter: false,
    expressivePauseAfter: 0,
    hesitationAfter: false,
    filledPause: false,
    autoRateScale: 1,
    geminateBefore: flags.geminateBefore ?? false,
    longVowel: flags.longVowel ?? false,
    moraicN: syllable === 'n' || syllable === 'nn',
    devoiced: false,
    pitchAccent: 'auto',
  });
}

function strongerTerminal(
  current: VoiceSentenceTerminal | undefined,
  next: VoiceSentenceTerminal | undefined,
): VoiceSentenceTerminal | undefined {
  if (!next) return current;
  if (!current) return next;
  if (current === 'question' || next === 'question') return 'question';
  if (current === 'exclamation' || next === 'exclamation') return 'exclamation';
  return 'statement';
}

function markPause(
  units: VoiceUnit[],
  pause: number,
  boundary: VoiceBoundary,
  terminal?: VoiceSentenceTerminal,
): void {
  const previous = units[units.length - 1];
  if (!previous) return;
  previous.pauseAfter = Math.max(previous.pauseAfter, pause);
  previous.boundaryAfter = strongerBoundary(previous.boundaryAfter, boundary);
  if (boundary === 'sentence') {
    const mergedTerminal = strongerTerminal(previous.terminalAfter, terminal);
    if (mergedTerminal) previous.terminalAfter = mergedTerminal;
  }
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

const QUESTION_WORD_PATTERNS: readonly (readonly string[])[] = [
  ['do', 'chi', 'ra'],
  ['i', 'ku', 'ra'],
  ['na', 'n', 'de'],
  ['da', 're'],
  ['do', 'ko'],
  ['i', 'tsu'],
  ['do', 'u'],
  ['na', 'ze'],
  ['do', 're'],
  ['do', 'no'],
  ['na', 'ni'],
] as const;

function questionFocusRange(
  units: readonly VoiceUnit[],
  start: number,
  end: number,
): { start: number; end: number } | null {
  for (let cursor = start; cursor <= end; cursor += 1) {
    for (const pattern of QUESTION_WORD_PATTERNS) {
      if (cursor + pattern.length - 1 > end) continue;
      let matches = true;
      for (let offset = 0; offset < pattern.length; offset += 1) {
        if (units[cursor + offset]?.syllable.toLowerCase() !== pattern[offset]) {
          matches = false;
          break;
        }
      }
      if (matches) return { start: cursor, end: cursor + pattern.length - 1 };
    }
  }
  return null;
}

const SENTENCE_ATTITUDE_PATTERNS: readonly {
  attitude: Exclude<VoiceSentenceAttitude, 'none'>;
  syllables: readonly string[];
}[] = [
  { attitude: 'shared', syllables: ['yo', 'ne'] },
  { attitude: 'wonder', syllables: ['ka', 'na'] },
  { attitude: 'uncertain', syllables: ['ka', 'mo'] },
  { attitude: 'shared', syllables: ['ne'] },
  { attitude: 'assertive', syllables: ['yo'] },
] as const;

function sentenceAttitudeRange(
  units: readonly VoiceUnit[],
  start: number,
  end: number,
): { start: number; attitude: VoiceSentenceAttitude } | null {
  if (units[end]?.suppressAttitudeInference) return null;
  for (const entry of SENTENCE_ATTITUDE_PATTERNS) {
    const patternStart = end - entry.syllables.length + 1;
    if (patternStart < start) continue;
    let matches = true;
    for (let offset = 0; offset < entry.syllables.length; offset += 1) {
      if (units[patternStart + offset]?.syllable.toLowerCase() !== entry.syllables[offset]) {
        matches = false;
        break;
      }
      if (units[patternStart + offset]?.suppressAttitudeInference) {
        matches = false;
        break;
      }
    }
    if (matches) return { start: patternStart, attitude: entry.attitude };
  }
  return null;
}

const CONTINUATION_PATTERNS: readonly {
  kind: Exclude<VoiceContinuationKind, 'none'>;
  syllables: readonly string[];
}[] = [
  { kind: 'contrast', syllables: ['ke', 'do'] },
  { kind: 'contrast', syllables: ['ke', 're', 'do'] },
  { kind: 'cause', syllables: ['no', 'de'] },
  { kind: 'cause', syllables: ['ka', 'ra'] },
  { kind: 'condition', syllables: ['na', 'ra'] },
  { kind: 'condition', syllables: ['ta', 'ra'] },
  { kind: 'concessive', syllables: ['te', 'mo'] },
  { kind: 'concessive', syllables: ['de', 'mo'] },
  { kind: 'concessive', syllables: ['no', 'ni'] },
] as const;

function continuationKindEndingAt(
  units: readonly VoiceUnit[],
  end: number,
): VoiceContinuationKind {
  for (const entry of CONTINUATION_PATTERNS) {
    const start = end - entry.syllables.length + 1;
    if (start < 0) continue;
    let matches = true;
    for (let offset = 0; offset < entry.syllables.length; offset += 1) {
      if (units[start + offset]?.syllable.toLowerCase() !== entry.syllables[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return entry.kind;
  }
  return 'none';
}

export function applyVoiceContinuationBoundary(
  units: VoiceUnit[],
  end: number,
  kind: Exclude<VoiceContinuationKind, 'none'>,
  pause = 0.052,
): void {
  const unit = units[Math.max(0, Math.min(units.length - 1, Math.floor(end)))];
  if (!unit || unit.boundaryAfter === 'sentence') return;
  unit.boundaryAfter = strongerBoundary(unit.boundaryAfter, 'accent');
  unit.pauseAfter = Math.max(unit.pauseAfter, pause);
  unit.continuationAfter = kind;
}

export function applyVoiceDiscourseMarker(
  units: VoiceUnit[],
  end: number,
  role: Exclude<VoiceDiscourseRole, 'none'>,
  options: {
    pause?: number;
    boundary?: boolean;
    focusStart?: number;
    focusEnd?: number;
    focusStrength?: number;
  } = {},
): void {
  if (units.length === 0) return;
  const safeEnd = Math.max(0, Math.min(units.length - 1, Math.floor(end)));
  const unit = units[safeEnd];
  if (!unit || unit.boundaryAfter === 'sentence') return;

  unit.discourseAfter = role;
  if (options.boundary) {
    unit.boundaryAfter = strongerBoundary(unit.boundaryAfter, 'accent');
    unit.pauseAfter = Math.max(unit.pauseAfter, options.pause ?? 0.035);
  }

  const focusStrength = Math.max(0, Math.min(1, options.focusStrength ?? 0));
  if (focusStrength <= 0) return;
  const focusStart = Math.max(0, Math.min(safeEnd, Math.floor(options.focusStart ?? safeEnd)));
  const focusEnd = Math.max(focusStart, Math.min(safeEnd, Math.floor(options.focusEnd ?? safeEnd)));
  for (let index = focusStart; index <= focusEnd; index += 1) {
    units[index]!.focusStrength = Math.max(units[index]!.focusStrength, focusStrength);
  }
}

function markExpressivePause(
  units: VoiceUnit[],
  pause: number,
  hesitation = false,
): void {
  const previous = units[units.length - 1];
  if (!previous) return;
  previous.expressivePauseAfter = Math.max(previous.expressivePauseAfter, pause);
  previous.hesitationAfter ||= hesitation;
}

function annotateFilledPauses(units: VoiceUnit[]): void {
  const patterns: readonly (readonly string[])[] = [
    ['e', 'e', 'to'],
    ['e', 'to'],
  ];
  for (let start = 0; start < units.length; start += 1) {
    for (const pattern of patterns) {
      if (start + pattern.length > units.length) continue;
      let matches = true;
      for (let offset = 0; offset < pattern.length; offset += 1) {
        const unit = units[start + offset]!;
        const syllable = unit.syllable.toLowerCase();
        if (syllable !== pattern[offset]) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      const last = units[start + pattern.length - 1]!;
      // Two-mora えっと is identified by its sokuon. Plain えと remains lexical.
      if (pattern.length === 2 && !last.geminateBefore) continue;
      for (let cursor = start; cursor < start + pattern.length; cursor += 1) {
        units[cursor]!.filledPause = true;
      }
      last.expressivePauseAfter = Math.max(last.expressivePauseAfter, 0.13);
      last.hesitationAfter = true;
      start += pattern.length - 1;
      break;
    }
  }
}

export function applyVoicePreFocusPause(
  units: VoiceUnit[],
  focusStart: number,
  strength: number,
): void {
  const before = units[Math.floor(focusStart) - 1];
  if (!before || before.boundaryAfter === 'sentence') return;
  const amount = Math.max(0, Math.min(1, strength));
  before.expressivePauseAfter = Math.max(
    before.expressivePauseAfter,
    0.035 + amount * 0.035,
  );
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

export function refreshVoiceUnitBoundaryMetadata(units: VoiceUnit[]): void {
  if (units.length === 0) return;
  for (const unit of units) {
    unit.breathAfter = false;
    unit.autoRateScale = unit.parenthetical
      ? 1.06
      : unit.quoted
        ? 0.96
        : 1;
    if (unit.filledPause) unit.autoRateScale *= 0.9;
    if (unit.focusStrength >= 0.72) unit.autoRateScale *= 0.985;
  }
  const final = units[units.length - 1]!;
  final.boundaryAfter = 'sentence';
  final.terminalAfter ??= 'statement';

  let sentenceStart = 0;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]!;
    const isLast = index === units.length - 1;
    if (unit.boundaryAfter !== 'sentence' && !isLast) continue;
    const terminal = unit.terminalAfter ?? 'statement';
    const count = Math.max(1, index - sentenceStart + 1);
    const focus = terminal === 'question'
      ? questionFocusRange(units, sentenceStart, index)
      : null;
    const questionKind: VoiceQuestionKind = terminal === 'question'
      ? focus ? 'content' : 'yes-no'
      : 'none';
    const attitude = sentenceAttitudeRange(units, sentenceStart, index);
    const sentenceHesitation = unit.hesitationAfter;
    for (let cursor = sentenceStart; cursor <= index; cursor += 1) {
      const candidate = units[cursor]!;
      candidate.phraseIndex = cursor - sentenceStart;
      candidate.phraseCount = count;
      candidate.phraseStart = cursor === sentenceStart;
      candidate.phraseEnd = cursor === index;
      candidate.sentenceTerminal = terminal;
      candidate.questionKind = questionKind;
      candidate.questionFocus = focus !== null
        && cursor >= focus.start
        && cursor <= focus.end;
      candidate.sentenceAttitude = attitude?.attitude ?? 'none';
      candidate.sentenceHesitation = sentenceHesitation;
      candidate.attitudeFocus = attitude !== null && cursor >= attitude.start;
      candidate.breathBefore = cursor === sentenceStart && count >= 6
        ? candidate.parenthetical
          ? 0
          : 0.026
        : 0;
    }
    sentenceStart = index + 1;
  }

  for (const unit of units) {
    if (!unit.attitudeFocus) continue;
    if (unit.sentenceAttitude === 'wonder') {
      unit.autoRateScale *= unit.hesitationAfter ? 0.93 : 0.96;
    } else if (unit.sentenceAttitude === 'uncertain') {
      unit.autoRateScale *= 0.97;
    } else if (unit.sentenceAttitude === 'shared' && unit.sentenceTerminal === 'question') {
      unit.autoRateScale *= 0.985;
    } else if (unit.sentenceAttitude === 'assertive' && unit.sentenceTerminal === 'exclamation') {
      unit.autoRateScale *= 0.975;
    }
  }

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]!;
    if (unit.boundaryAfter !== 'accent') {
      unit.continuationAfter = 'none';
    } else if (unit.continuationAfter === 'none' && !unit.suppressContinuationInference) {
      unit.continuationAfter = continuationKindEndingAt(units, index);
      if (unit.continuationAfter !== 'none') {
        unit.pauseAfter = Math.max(unit.pauseAfter, 0.052);
      }
    }
  }

  for (let index = 0; index < units.length; index += 1) {
    const previous = units[index - 1];
    units[index]!.boundaryBefore = previous?.boundaryAfter ?? 'none';
    units[index]!.pauseBefore = previous?.pauseAfter ?? 0;
    units[index]!.continuationBefore = previous?.continuationAfter ?? 'none';
    units[index]!.discourseBefore = previous?.discourseAfter ?? 'none';
  }

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

  let phraseSentenceStart = 0;
  for (let sentenceEnd = 0; sentenceEnd < units.length; sentenceEnd += 1) {
    if (units[sentenceEnd]!.boundaryAfter !== 'sentence' && sentenceEnd !== units.length - 1) continue;
    const phraseRanges: { start: number; end: number }[] = [];
    let phraseStart = phraseSentenceStart;
    for (let cursor = phraseSentenceStart; cursor <= sentenceEnd; cursor += 1) {
      if (units[cursor]!.boundaryAfter === 'none' && cursor !== sentenceEnd) continue;
      phraseRanges.push({ start: phraseStart, end: cursor });
      phraseStart = cursor + 1;
    }
    const phraseCount = Math.max(1, phraseRanges.length);
    phraseRanges.forEach((range, phraseIndex) => {
      for (let cursor = range.start; cursor <= range.end; cursor += 1) {
        units[cursor]!.accentPhraseIndex = phraseIndex;
        units[cursor]!.accentPhraseCount = phraseCount;
      }
    });
    // Prefer existing accent boundaries as quiet inhalation points in long
    // sentences. This avoids inserting arbitrary pauses inside lexical words.
    const sentenceLength = sentenceEnd - phraseSentenceStart + 1;
    if (sentenceLength >= 18) {
      let lastBreath = phraseSentenceStart - 1;
      for (let cursor = phraseSentenceStart; cursor < sentenceEnd; cursor += 1) {
        const unit = units[cursor]!;
        const span = cursor - lastBreath;
        if (unit.boundaryAfter !== 'accent' || span < 11) continue;
        if (unit.discourseAfter === 'quote') continue;
        unit.breathAfter = true;
        unit.pauseAfter = Math.max(unit.pauseAfter, 0.12);
        lastBreath = cursor;
      }
    }

    phraseSentenceStart = sentenceEnd + 1;
  }
}

export function finalizeVoiceUnits(units: VoiceUnit[]): void {
  if (units.length === 0) return;
  refreshVoiceUnitBoundaryMetadata(units);

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
    const lexicallyProminent = unit.pitchAccent === 'high';

    // Consecutive devoicing varies considerably between speakers. Keep one
    // voiced high-vowel target between candidates, and preserve lexical-high
    // morae so the dictionary accent remains audible instead of disappearing.
    unit.devoiced = candidate && !previousDevoiced && !lexicallyProminent;
    previousDevoiced = unit.devoiced;
  }
}

export function parseVoiceScript(text: string): VoiceScript {
  const eventMarkup = stripVoiceSpeechEventMarkup(text);
  const normalized = toHiragana(eventMarkup.text);
  const units: VoiceUnit[] = [];
  const unsupported: string[] = [];
  const events: VoiceSpeechEvent[] = [];
  const pendingGeminate = { value: false };
  const quoteStarts: number[] = [];
  const parenStarts: number[] = [];
  let markerCursor = 0;
  let index = 0;

  const flushEventMarkers = (textOffset: number): void => {
    while (
      markerCursor < eventMarkup.markers.length
      && eventMarkup.markers[markerCursor]!.textOffset <= textOffset
    ) {
      const marker = eventMarkup.markers[markerCursor]!;
      events.push({
        kind: marker.kind,
        afterUnit: units.length - 1,
        textOffset: marker.textOffset,
        strength: marker.strength,
      });
      markerCursor += 1;
    }
  };

  const markScope = (
    start: number,
    end: number,
    scope: 'quote' | 'parenthetical',
  ): void => {
    if (end < start) return;
    for (let cursor = start; cursor <= end; cursor += 1) {
      const unit = units[cursor];
      if (!unit) continue;
      if (scope === 'quote') unit.quoted = true;
      else unit.parenthetical = true;
    }
  };

  while (index < normalized.length) {
    flushEventMarkers(index);
    const char = normalized[index]!;

    if (normalized.startsWith('...', index)) {
      let end = index + 3;
      while (normalized[end] === '.') end += 1;
      markExpressivePause(units, end - index >= 6 ? 0.24 : 0.2, true);
      index = end;
      continue;
    }
    if (char === '…') {
      let end = index + 1;
      while (normalized[end] === '…') end += 1;
      markExpressivePause(units, end - index >= 2 ? 0.24 : 0.18, true);
      index = end;
      continue;
    }
    if (char === '―' || char === '—') {
      let end = index + 1;
      while (normalized[end] === char) end += 1;
      markExpressivePause(units, end - index >= 2 ? 0.2 : 0.14, true);
      index = end;
      continue;
    }

    if (QUOTE_OPEN.has(char) || char === '"') {
      if (char !== '"' || quoteStarts.length === 0) {
        markPause(units, 0.04, 'accent');
        quoteStarts.push(units.length);
      } else {
        const start = quoteStarts.pop() ?? units.length;
        markScope(start, units.length - 1, 'quote');
        markPause(units, 0.055, 'accent');
      }
      index += 1;
      continue;
    }
    if (QUOTE_CLOSE.has(char)) {
      const start = quoteStarts.pop() ?? units.length;
      markScope(start, units.length - 1, 'quote');
      markPause(units, 0.055, 'accent');
      index += 1;
      continue;
    }
    if (PAREN_OPEN.has(char)) {
      markPause(units, 0.045, 'accent');
      parenStarts.push(units.length);
      index += 1;
      continue;
    }
    if (PAREN_CLOSE.has(char)) {
      const start = parenStarts.pop() ?? units.length;
      markScope(start, units.length - 1, 'parenthetical');
      markPause(units, 0.07, 'accent');
      index += 1;
      continue;
    }

    const punctuation = PUNCTUATION.get(char);
    if (punctuation) {
      markPause(units, punctuation.pause, punctuation.boundary, punctuation.terminal);
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

  flushEventMarkers(normalized.length);
  for (const start of quoteStarts) markScope(start, units.length - 1, 'quote');
  for (const start of parenStarts) markScope(start, units.length - 1, 'parenthetical');
  annotateFilledPauses(units);

  finalizeVoiceUnits(units);
  return { units, unsupported: [...new Set(unsupported)], events };
}

function accentPhraseOffset(unit: VoiceUnit): number {
  if (unit.pitchAccent !== 'auto') {
    const lexical = unit.pitchAccent === 'high' ? 0.58 : -0.5;
    const declination = unit.pitchAccent === 'high' ? unit.accentIndex * 0.062 : 0;
    return lexical - declination - (unit.accentEnd ? 0.08 : 0);
  }
  if (unit.accentCount <= 1) return 0;
  if (unit.accentIndex === 0) return -0.62;
  const decline = Math.max(0, unit.accentIndex - 1) * 0.13;
  const crest = 0.7 - decline;
  return crest - (unit.accentEnd ? 0.18 : 0);
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

export function resolveVoiceIntonation(
  unit: VoiceUnit,
  intonation: VoiceIntonation | VoiceResolvedIntonation,
): VoiceResolvedIntonation {
  if (intonation !== 'auto') return intonation;
  if (unit.sentenceTerminal === 'question') {
    return unit.questionKind === 'content' ? 'content-question' : 'question';
  }
  if (unit.sentenceTerminal === 'exclamation') return 'exclaim';
  return 'natural';
}

export function prosodyOffsetForUnit(
  unit: VoiceUnit,
  _index: number,
  _count: number,
  intonation: VoiceIntonation | VoiceResolvedIntonation,
): number {
  const resolvedIntonation = resolveVoiceIntonation(unit, intonation);
  if (resolvedIntonation === 'flat') return 0;

  const phraseProgress = unit.phraseCount <= 1
    ? 0
    : unit.phraseIndex / Math.max(1, unit.phraseCount - 1);
  const lexicalAccent = unit.pitchAccent !== 'auto';
  // Conversational declaratives keep enough contour to avoid a flat synthetic read.
  const phraseArcBase = Math.sin(phraseProgress * Math.PI) * 0.36 - phraseProgress * 0.5;
  const phraseArc = phraseArcBase * (lexicalAccent ? 0.25 : 1);
  const accent = accentPhraseOffset(unit);
  const micro = consonantMicroProsody(unit);
  const sentenceDeclination = -phraseProgress * 0.12;
  const boundaryResetStrength = unit.accentStart && unit.boundaryBefore === 'accent'
    ? Math.max(0, Math.min(1, (unit.pauseBefore - 0.03) / 0.14))
    : 0;
  const boundaryReset = boundaryResetStrength * (lexicalAccent ? 0.18 : 0.26);
  const continuationTailLift = unit.continuationAfter === 'contrast'
    ? 0.16
    : unit.continuationAfter === 'condition'
      ? 0.18
      : unit.continuationAfter === 'concessive'
        ? 0.14
        : unit.continuationAfter === 'cause'
          ? 0.1
          : unit.continuationAfter === 'additive'
            ? 0.08
            : 0;
  const continuationReset = unit.continuationBefore === 'contrast'
    || unit.continuationBefore === 'condition'
    ? 0.16
    : unit.continuationBefore !== 'none'
      ? 0.12
      : 0;
  const continuationMotion = continuationTailLift + continuationReset;
  const discourseTail = unit.discourseAfter === 'subject'
    ? 0.08
    : unit.discourseAfter === 'list'
      ? 0.1
      : unit.discourseAfter === 'focus'
        ? 0.025
        : unit.discourseAfter === 'topic'
          ? 0.03
          : unit.discourseAfter === 'quote'
            ? -0.02
            : 0;
  const discourseReset = unit.discourseBefore === 'topic'
    ? 0.14
    : unit.discourseBefore === 'quote'
      ? 0.1
      : unit.discourseBefore === 'list'
        ? 0.11
        : unit.discourseBefore === 'subject'
          ? 0.035
          : 0;
  const attitudeLift = unit.attitudeFocus
    ? unit.sentenceAttitude === 'wonder'
      ? 0.24
      : unit.sentenceAttitude === 'shared'
        ? 0.14
        : unit.sentenceAttitude === 'assertive'
          ? 0.035
          : unit.sentenceAttitude === 'uncertain'
            ? 0.09
            : 0
    : 0;
  const hesitationTail = unit.sentenceHesitation
    && (unit.sentenceAttitude === 'wonder' || unit.sentenceAttitude === 'uncertain')
    ? -0.24 * Math.max(0, Math.min(1, (phraseProgress - 0.52) / 0.48)) ** 1.35
    : 0;
  const focusLift = unit.focusStrength * 0.16
    + attitudeLift
    + hesitationTail
    + (unit.quoted ? 0.035 : 0)
    - (unit.parenthetical ? 0.055 : 0)
    - (unit.filledPause ? 0.08 : 0)
    - (unit.hesitationAfter ? 0.055 : 0);
  const downstep = -Math.min(0.3, unit.accentPhraseIndex * 0.05);
  const discourseMotion = discourseTail + discourseReset + focusLift + downstep;

  if (resolvedIntonation === 'rise') {
    return -0.7 + phraseProgress * 1.9 + accent * 0.35 + micro + boundaryReset + continuationMotion + discourseMotion;
  }
  if (resolvedIntonation === 'fall') {
    return 0.72 - phraseProgress * 1.8 + accent * 0.35 + micro + boundaryReset + continuationMotion + discourseMotion;
  }
  if (resolvedIntonation === 'question') {
    const terminal = unit.phraseCount <= 1
      ? 1
      : Math.max(0, Math.min(1, (phraseProgress - 0.58) / 0.42));
    const easedTerminal = terminal * terminal * (3 - 2 * terminal);
    const questionLift = (unit.phraseCount <= 1 ? 1.25 : 1.55) * easedTerminal;
    return phraseArc + accent * 0.8 + micro + questionLift + sentenceDeclination + boundaryReset + continuationMotion + discourseMotion;
  }
  if (resolvedIntonation === 'content-question') {
    const terminal = unit.phraseCount <= 1
      ? 1
      : Math.max(0, Math.min(1, (phraseProgress - 0.68) / 0.32));
    const easedTerminal = terminal * terminal * (3 - 2 * terminal);
    const focusLift = unit.questionFocus ? 0.22 : 0;
    const questionLift = (unit.phraseCount <= 1 ? 0.35 : 0.48) * easedTerminal;
    return phraseArc
      + accent * 0.85
      + micro
      + focusLift
      + questionLift
      + sentenceDeclination
      + boundaryReset
      + continuationMotion + discourseMotion;
  }
  if (resolvedIntonation === 'exclaim') {
    const terminal = unit.phraseCount <= 1
      ? 1
      : Math.max(0, Math.min(1, (phraseProgress - 0.72) / 0.28));
    const easedTerminal = terminal * terminal * (3 - 2 * terminal);
    const energeticArc = Math.sin(phraseProgress * Math.PI) * 0.16;
    return phraseArc * 0.72
      + accent
      + micro
      + energeticArc
      + easedTerminal * 0.14
      + sentenceDeclination * 0.35
      + boundaryReset
      + continuationMotion + discourseMotion;
  }

  const reset = unit.phraseStart ? (lexicalAccent ? 0.09 : 0.18) : 0;
  const terminal = unit.phraseCount <= 1
    ? 1
    : Math.max(0, Math.min(1, (phraseProgress - 0.68) / 0.32));
  const easedTerminal = terminal * terminal * (3 - 2 * terminal);
  const finalLowering = -(lexicalAccent ? 0.12 : 0.28) * easedTerminal;
  return phraseArc * 1.22
    + accent * 1.16
    + micro * 1.08
    + reset
    + finalLowering
    + sentenceDeclination
    + boundaryReset
    + continuationMotion
    + discourseMotion;
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
