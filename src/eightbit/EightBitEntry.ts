import './eight-bit.css';
import { EightBitMode } from './EightBitMode';

function installEightBitMode(): void {
  const app = document.querySelector<HTMLElement>('#app');
  const start = document.querySelector<HTMLElement>('#start');
  const grid = document.querySelector<HTMLElement>('.title-mode-grid');
  if (!app || !start || !grid || document.querySelector('#eight-bit-studio')) return;

  const root = document.createElement('section');
  root.id = 'eight-bit-studio';
  root.setAttribute('aria-hidden', 'true');
  app.append(root);

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'title-mode-card eightbit';
  card.setAttribute('aria-label', 'Open 8BIT Studio game audio generator');
  card.innerHTML = '<i>▥</i><b>8BIT STUDIO</b><span>Generate game BGM loops and SFX, then export WAV.</span>';
  grid.append(card);

  const mode = new EightBitMode(root);
  const titleButton = document.querySelector<HTMLButtonElement>('[data-app-mode-button="title"]');

  card.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    app.dataset.appMode = 'eightbit';
    start.classList.add('hidden');
    start.setAttribute('aria-hidden', 'true');
    void mode.activate().catch((error: unknown) => {
      console.warn('8BIT Studio audio could not start.', error);
    });
  }, { passive: false });
  card.addEventListener('contextmenu', (event) => event.preventDefault());

  titleButton?.addEventListener('pointerdown', () => {
    if (!mode.isActive) return;
    mode.deactivate();
    app.dataset.appMode = 'title';
  }, { capture: true });

  document.addEventListener('visibilitychange', () => {
    if (!mode.isActive) return;
    if (document.hidden) mode.deactivate();
  });
}

installEightBitMode();
