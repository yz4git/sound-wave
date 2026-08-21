import { describe, expect, it } from 'vitest';
import {
  groupKaraokeMarkers,
  karaokeFrameFor,
  type KaraokeMarkerData,
} from '../src/compose/KaraokeLyricsPanel';

const markers: KaraokeMarkerData[] = [
  { mora: 'こ', line: 'この声を届けたい', leftPercent: 10, widthPercent: 0.6 },
  { mora: 'の', line: 'この声を届けたい', leftPercent: 10.8, widthPercent: 0.6 },
  { mora: 'こ', line: 'この声を届けたい', leftPercent: 11.6, widthPercent: 0.6 },
  { mora: 'え', line: 'この声を届けたい', leftPercent: 12.4, widthPercent: 0.6 },
  { mora: 'き', line: '君と未来へ走ろう', leftPercent: 16, widthPercent: 0.6 },
  { mora: 'み', line: '君と未来へ走ろう', leftPercent: 16.8, widthPercent: 0.6 },
  { mora: 'と', line: '君と未来へ走ろう', leftPercent: 17.6, widthPercent: 0.6 },
  { mora: 'こ', line: 'この声を届けたい', leftPercent: 23, widthPercent: 0.6 },
  { mora: 'の', line: 'この声を届けたい', leftPercent: 23.8, widthPercent: 0.6 },
];

describe('Karaoke Lyrics Panel', () => {
  it('keeps repeated lyric lines as separate phrases when a musical gap exists', () => {
    const phrases = groupKaraokeMarkers(markers);
    expect(phrases).toHaveLength(3);
    expect(phrases[0]?.line).toBe('この声を届けたい');
    expect(phrases[1]?.line).toBe('君と未来へ走ろう');
    expect(phrases[2]?.line).toBe('この声を届けたい');
  });

  it('highlights the active mora and exposes the next two lyric lines', () => {
    const frame = karaokeFrameFor(markers, 11.6, 2);
    expect(frame.phrase?.line).toBe('この声を届けたい');
    expect(frame.activeMoraIndex).toBe(2);
    expect(frame.progressPercent).toBeGreaterThan(50);
    expect(frame.nextLines).toEqual(['君と未来へ走ろう', 'この声を届けたい']);
  });

  it('previews the next phrase during a rest instead of showing a blank panel', () => {
    const frame = karaokeFrameFor(markers, 15, -1);
    expect(frame.phrase?.line).toBe('君と未来へ走ろう');
    expect(frame.activeMoraIndex).toBe(-1);
    expect(frame.progressPercent).toBe(0);
  });
});
