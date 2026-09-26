import './voice.css';
import { VoiceMode } from './VoiceMode';

function installVoiceMode(): void {
  const app = document.querySelector<HTMLElement>('#app');
  const start = document.querySelector<HTMLElement>('#start');
  const grid = document.querySelector<HTMLElement>('.title-mode-grid');
  if (!app || !start || !grid || document.querySelector('#voice-lab')) return;

  const root = document.createElement('section');
  root.id = 'voice-lab';
  root.setAttribute('aria-hidden', 'true');
  app.append(root);

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'title-mode-card voice';
  card.setAttribute('aria-label', 'Open Voice Lab speech synthesis');
  card.innerHTML = '<i>◉</i><b>VOICE LAB</b><span>Synthesize speech, shape prosody and export local WAV.</span>';
  grid.append(card);

  const mode = new VoiceMode(root);
  const titleButton = document.querySelector<HTMLButtonElement>('[data-app-mode-button="title"]');
  let resumeVoiceOnVisible = false;

  const returnToTitle = (): void => {
    resumeVoiceOnVisible = false;
    if (mode.isActive) mode.deactivate();
    app.dataset.appMode = 'title';
    start.classList.remove('hidden');
    start.setAttribute('aria-hidden', 'false');
  };

  card.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    app.dataset.appMode = 'voice';
    start.classList.add('hidden');
    start.setAttribute('aria-hidden', 'true');
    void mode.activate().catch((error: unknown) => {
      console.warn('VOICE LAB could not start.', error);
      returnToTitle();
    });
  }, { passive: false });
  card.addEventListener('contextmenu', (event) => event.preventDefault());

  titleButton?.addEventListener('pointerdown', () => {
    if (mode.isActive) returnToTitle();
  }, { capture: true });

  const restoreVisibleMode = (): void => {
    if (!resumeVoiceOnVisible || document.hidden) return;
    resumeVoiceOnVisible = false;

    if (app.dataset.appMode !== 'voice') return;
    start.classList.add('hidden');
    start.setAttribute('aria-hidden', 'true');
    void mode.activate().catch((error: unknown) => {
      console.warn('VOICE LAB could not resume.', error);
      returnToTitle();
    });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!mode.isActive) return;
      resumeVoiceOnVisible = true;
      mode.deactivate();
      return;
    }
    restoreVisibleMode();
  });

  window.addEventListener('pageshow', () => {
    if (app.dataset.appMode === 'voice' && !mode.isActive) {
      resumeVoiceOnVisible = true;
      restoreVisibleMode();
    }
  });
}

installVoiceMode();
