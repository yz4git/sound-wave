export interface KaraokeMarkerData {
  mora: string;
  line: string;
  leftPercent: number;
  widthPercent: number;
}

export interface KaraokePhrase {
  line: string;
  startMarker: number;
  endMarker: number;
  markers: KaraokeMarkerData[];
}

export interface KaraokeFrame {
  phraseIndex: number;
  phrase: KaraokePhrase | null;
  nextLines: string[];
  activeMoraIndex: number;
  completedMoraCount: number;
  progressPercent: number;
}

const SAME_LINE_GAP_BREAK_PERCENT = 1.2;

export function groupKaraokeMarkers(markers: readonly KaraokeMarkerData[]): KaraokePhrase[] {
  const phrases: KaraokePhrase[] = [];
  let phraseMarkers: KaraokeMarkerData[] = [];
  let startMarker = 0;

  const flush = (endMarker: number): void => {
    if (phraseMarkers.length === 0) return;
    phrases.push({
      line: phraseMarkers[0]?.line ?? '',
      startMarker,
      endMarker,
      markers: phraseMarkers,
    });
    phraseMarkers = [];
  };

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]!;
    const previous = markers[index - 1];
    const previousEnd = previous ? previous.leftPercent + previous.widthPercent : marker.leftPercent;
    const gap = marker.leftPercent - previousEnd;
    const phraseBreak = phraseMarkers.length > 0 && (
      marker.line !== phraseMarkers[0]?.line
      || gap > SAME_LINE_GAP_BREAK_PERCENT
    );

    if (phraseBreak) {
      flush(index - 1);
      startMarker = index;
    }
    if (phraseMarkers.length === 0) startMarker = index;
    phraseMarkers.push(marker);
  }
  flush(markers.length - 1);
  return phrases;
}

export function karaokeFrameFor(
  markers: readonly KaraokeMarkerData[],
  progressPercent: number,
  activeMarkerIndex: number,
): KaraokeFrame {
  const phrases = groupKaraokeMarkers(markers);
  if (phrases.length === 0) {
    return { phraseIndex: -1, phrase: null, nextLines: [], activeMoraIndex: -1, completedMoraCount: 0, progressPercent: 0 };
  }

  let markerIndex = activeMarkerIndex;
  if (markerIndex < 0 || markerIndex >= markers.length) {
    const upcoming = markers.findIndex((marker) => marker.leftPercent + marker.widthPercent * 0.5 >= progressPercent);
    markerIndex = upcoming >= 0 ? upcoming : markers.length - 1;
  }

  let phraseIndex = phrases.findIndex((phrase) => markerIndex >= phrase.startMarker && markerIndex <= phrase.endMarker);
  if (phraseIndex < 0) phraseIndex = phrases.length - 1;
  const phrase = phrases[phraseIndex]!;
  const localMarkerIndex = Math.max(0, Math.min(phrase.markers.length - 1, markerIndex - phrase.startMarker));
  const activeInPhrase = activeMarkerIndex >= phrase.startMarker && activeMarkerIndex <= phrase.endMarker;
  const completed = phrase.markers.filter((marker) => marker.leftPercent + marker.widthPercent <= progressPercent).length;
  const completedMoraCount = Math.max(0, Math.min(phrase.markers.length, completed));
  const activeMoraIndex = activeInPhrase ? activeMarkerIndex - phrase.startMarker : -1;
  const progress = activeInPhrase
    ? (localMarkerIndex + 0.58) / Math.max(1, phrase.markers.length) * 100
    : completedMoraCount / Math.max(1, phrase.markers.length) * 100;

  const nextLines: string[] = [];
  for (let index = phraseIndex + 1; index < phrases.length && nextLines.length < 2; index += 1) {
    const line = phrases[index]?.line ?? '';
    if (line) nextLines.push(line);
  }

  return {
    phraseIndex,
    phrase,
    nextLines,
    activeMoraIndex,
    completedMoraCount,
    progressPercent: Math.max(0, Math.min(100, progress)),
  };
}

interface DomMarker extends KaraokeMarkerData {
  element: HTMLElement;
}

function markerFromElement(element: HTMLElement): DomMarker | null {
  const title = element.title;
  const divider = title.indexOf(' · ');
  if (divider < 0) return null;
  const mora = title.slice(0, divider).trim();
  const line = title.slice(divider + 3).trim();
  const leftPercent = Number.parseFloat(element.style.left);
  const widthPercent = Number.parseFloat(element.style.width);
  if (!mora || !line || !Number.isFinite(leftPercent)) return null;
  return {
    element,
    mora,
    line,
    leftPercent,
    widthPercent: Number.isFinite(widthPercent) ? widthPercent : 0,
  };
}

class KaraokeLyricsPanelController {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly currentLine: HTMLElement;
  private readonly moraLine: HTMLElement;
  private readonly nextLine1: HTMLElement;
  private readonly nextLine2: HTMLElement;
  private readonly sectionLabel: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly roll: HTMLElement;
  private readonly vocalToggle: HTMLButtonElement | null;
  private readonly observers: MutationObserver[] = [];
  private markers: DomMarker[] = [];
  private frameRequested = false;
  private lastLine = '';

  constructor(root: HTMLElement, stage: HTMLElement) {
    this.root = root;
    this.panel = document.createElement('section');
    this.panel.id = 'compose-lyrics-panel';
    this.panel.className = 'compose-lyrics-panel';
    this.panel.setAttribute('aria-label', 'Karaoke lyrics');
    this.panel.innerHTML = `
      <div class="compose-lyrics-head"><b>KARAOKE LYRICS</b><span id="compose-lyrics-section">UP NEXT</span></div>
      <div class="compose-lyrics-current" id="compose-lyrics-current" aria-live="polite">歌詞を生成中…</div>
      <div class="compose-lyrics-mora" id="compose-lyrics-mora" aria-hidden="true"></div>
      <div class="compose-lyrics-next" aria-label="Upcoming lyrics">
        <span id="compose-lyrics-next-1"></span><span id="compose-lyrics-next-2"></span>
      </div>`;

    const vocalStrip = stage.querySelector<HTMLElement>('.compose-vocal-strip');
    const progress = stage.querySelector<HTMLElement>('.compose-progress');
    if (vocalStrip) vocalStrip.insertAdjacentElement('afterend', this.panel);
    else if (progress) stage.insertBefore(this.panel, progress);
    else stage.prepend(this.panel);

    this.currentLine = this.panel.querySelector<HTMLElement>('#compose-lyrics-current')!;
    this.moraLine = this.panel.querySelector<HTMLElement>('#compose-lyrics-mora')!;
    this.nextLine1 = this.panel.querySelector<HTMLElement>('#compose-lyrics-next-1')!;
    this.nextLine2 = this.panel.querySelector<HTMLElement>('#compose-lyrics-next-2')!;
    this.sectionLabel = this.panel.querySelector<HTMLElement>('#compose-lyrics-section')!;
    this.progressFill = root.querySelector<HTMLElement>('#compose-progress-fill')!;
    this.roll = root.querySelector<HTMLElement>('#compose-roll')!;
    this.vocalToggle = root.querySelector<HTMLButtonElement>('#compose-vocal-toggle');

    this.refreshMarkers();
    this.observe();
    this.render();
  }

  private observe(): void {
    const rollObserver = new MutationObserver(() => {
      this.refreshMarkers();
      this.requestRender();
    });
    rollObserver.observe(this.roll, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'title'] });
    this.observers.push(rollObserver);

    const progressObserver = new MutationObserver(() => this.requestRender());
    progressObserver.observe(this.progressFill, { attributes: true, attributeFilter: ['style'] });
    this.observers.push(progressObserver);

    if (this.vocalToggle) {
      const toggleObserver = new MutationObserver(() => this.requestRender());
      toggleObserver.observe(this.vocalToggle, { attributes: true, childList: true, characterData: true, subtree: true });
      this.observers.push(toggleObserver);
    }

    const chord = this.root.querySelector<HTMLElement>('#compose-chord');
    if (chord) {
      const chordObserver = new MutationObserver(() => this.requestRender());
      chordObserver.observe(chord, { childList: true, characterData: true, subtree: true });
      this.observers.push(chordObserver);
    }
  }

  private refreshMarkers(): void {
    this.markers = Array.from(this.roll.querySelectorAll<HTMLElement>('.compose-vocal-note'))
      .map(markerFromElement)
      .filter((marker): marker is DomMarker => marker !== null)
      .sort((a, b) => a.leftPercent - b.leftPercent);
  }

  private requestRender(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.render();
    });
  }

  private render(): void {
    const progressPercent = Number.parseFloat(this.progressFill.style.width) || 0;
    const activeElement = this.roll.querySelector<HTMLElement>('.compose-vocal-note.active');
    const activeMarkerIndex = activeElement
      ? this.markers.findIndex((marker) => marker.element === activeElement)
      : -1;
    const frame = karaokeFrameFor(this.markers, progressPercent, activeMarkerIndex);
    const vocalEnabled = this.vocalToggle?.textContent?.trim() !== 'OFF';
    this.panel.classList.toggle('muted', !vocalEnabled);
    this.panel.classList.toggle('singing', activeMarkerIndex >= 0 && vocalEnabled);

    const chordText = this.root.querySelector<HTMLElement>('#compose-chord')?.textContent ?? '';
    this.sectionLabel.textContent = chordText.split(' · ')[0]?.trim() || 'UP NEXT';

    if (!frame.phrase) {
      this.currentLine.textContent = '歌詞を生成中…';
      this.currentLine.style.setProperty('--karaoke-progress', '0%');
      this.moraLine.replaceChildren();
      this.nextLine1.textContent = '';
      this.nextLine2.textContent = '';
      return;
    }

    if (this.lastLine !== frame.phrase.line) {
      this.currentLine.textContent = frame.phrase.line;
      this.lastLine = frame.phrase.line;
    }
    this.currentLine.style.setProperty('--karaoke-progress', `${frame.progressPercent.toFixed(1)}%`);

    this.moraLine.replaceChildren();
    frame.phrase.markers.forEach((marker, index) => {
      const token = document.createElement('span');
      token.textContent = marker.mora;
      token.classList.toggle('done', index < frame.completedMoraCount || index < frame.activeMoraIndex);
      token.classList.toggle('active', index === frame.activeMoraIndex && vocalEnabled);
      this.moraLine.append(token);
    });

    this.nextLine1.textContent = frame.nextLines[0] ?? '';
    this.nextLine2.textContent = frame.nextLines[1] ?? '';
  }
}

function bootKaraokeLyricsPanel(): void {
  const root = document.querySelector<HTMLElement>('#auto-compose');
  if (!root) return;

  const attach = (): boolean => {
    const stage = root.querySelector<HTMLElement>('.compose-stage');
    if (!stage || root.querySelector('#compose-lyrics-panel')) return Boolean(root.querySelector('#compose-lyrics-panel'));
    if (!root.querySelector('#compose-roll') || !root.querySelector('#compose-progress-fill')) return false;
    new KaraokeLyricsPanelController(root, stage);
    return true;
  };

  if (attach()) return;
  const setupObserver = new MutationObserver(() => {
    if (!attach()) return;
    setupObserver.disconnect();
  });
  setupObserver.observe(root, { childList: true, subtree: true });
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootKaraokeLyricsPanel, { once: true });
  else bootKaraokeLyricsPanel();
}
