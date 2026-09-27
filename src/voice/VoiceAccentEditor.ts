import {
  finalizeVoiceUnits,
  type VoicePitchAccent,
  type VoiceScript,
  type VoiceUnit,
} from './VoiceScript';

export interface VoiceAccentPhrase {
  start: number;
  end: number;
  count: number;
  nucleus: number | null;
  pattern: VoicePitchAccent[];
}

export function accentNucleusForPattern(
  pattern: readonly VoicePitchAccent[],
): number | null {
  if (pattern.length === 0) return null;
  if (pattern.some((value) => value === 'auto')) return null;

  if (pattern[0] === 'high') return 1;
  for (let index = 1; index < pattern.length; index += 1) {
    if (pattern[index] === 'high' && pattern[index + 1] === 'low') return index + 1;
  }

  return 0;
}

export function accentPatternForNucleus(
  count: number,
  nucleus: number,
): VoicePitchAccent[] {
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0) return [];
  const safeNucleus = Math.max(0, Math.min(safeCount, Math.floor(nucleus)));
  const pattern = new Array<VoicePitchAccent>(safeCount).fill('low');

  if (safeNucleus === 0) {
    for (let index = 1; index < safeCount; index += 1) pattern[index] = 'high';
    return pattern;
  }
  if (safeNucleus === 1) {
    pattern[0] = 'high';
    return pattern;
  }

  for (let index = 1; index < safeNucleus; index += 1) pattern[index] = 'high';
  return pattern;
}

export function collectAccentPhrases(script: VoiceScript): VoiceAccentPhrase[] {
  const phrases: VoiceAccentPhrase[] = [];
  let start = 0;

  for (let index = 0; index < script.units.length; index += 1) {
    const unit = script.units[index]!;
    const closes = unit.accentEnd || index === script.units.length - 1;
    if (!closes) continue;

    const pattern = script.units
      .slice(start, index + 1)
      .map((candidate) => candidate.pitchAccent);

    phrases.push({
      start,
      end: index,
      count: index - start + 1,
      nucleus: accentNucleusForPattern(pattern),
      pattern,
    });
    start = index + 1;
  }

  return phrases;
}

export function applyAccentNucleus(
  script: VoiceScript,
  start: number,
  end: number,
  nucleus: number,
): void {
  const safeStart = Math.max(0, Math.floor(start));
  const safeEnd = Math.min(script.units.length - 1, Math.floor(end));
  if (safeStart > safeEnd) return;

  const pattern = accentPatternForNucleus(safeEnd - safeStart + 1, nucleus);
  for (let offset = 0; offset < pattern.length; offset += 1) {
    const unit = script.units[safeStart + offset];
    if (unit) unit.pitchAccent = pattern[offset]!;
  }
  finalizeVoiceUnits(script.units);
}

export function cloneVoiceScript(script: VoiceScript): VoiceScript {
  return {
    unsupported: [...script.unsupported],
    units: script.units.map((unit: VoiceUnit) => ({ ...unit })),
  };
}
