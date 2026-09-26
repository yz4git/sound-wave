import { describe, expect, it } from 'vitest';
import {
  getVoiceProsodyWindow,
  VOICE_PROSODY_PAGE_SIZE,
} from '../src/voice/VoiceProsodyWindow';

describe('VOICE LAB long-form prosody paging', () => {
  it('keeps short utterances on one page', () => {
    expect(getVoiceProsodyWindow(36, 0)).toEqual({
      page: 0,
      pageCount: 1,
      start: 0,
      end: 36,
      visibleCount: 36,
    });
  });

  it('pages utterances longer than the preview limit without dropping morae', () => {
    const first = getVoiceProsodyWindow(160, 0);
    const second = getVoiceProsodyWindow(160, 1);
    const third = getVoiceProsodyWindow(160, 2);

    expect(VOICE_PROSODY_PAGE_SIZE).toBe(72);
    expect(first).toMatchObject({ page: 0, start: 0, end: 72, visibleCount: 72 });
    expect(second).toMatchObject({ page: 1, start: 72, end: 144, visibleCount: 72 });
    expect(third).toMatchObject({ page: 2, start: 144, end: 160, visibleCount: 16 });
  });

  it('clamps invalid pages after the text becomes shorter', () => {
    expect(getVoiceProsodyWindow(80, 99)).toMatchObject({
      page: 1,
      pageCount: 2,
      start: 72,
      end: 80,
      visibleCount: 8,
    });
    expect(getVoiceProsodyWindow(0, 4)).toMatchObject({
      page: 0,
      pageCount: 1,
      start: 0,
      end: 0,
      visibleCount: 0,
    });
  });

  it('supports alternate page sizes for deterministic mapping tests', () => {
    expect(getVoiceProsodyWindow(10, 1, 4)).toEqual({
      page: 1,
      pageCount: 3,
      start: 4,
      end: 8,
      visibleCount: 4,
    });
  });
});
