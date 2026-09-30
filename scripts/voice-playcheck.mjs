import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const outDir = 'voice-review';
await fs.mkdir(outDir, { recursive: true });
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error('Chrome/Chromium executable not found');

const samples = [
  ['neutral', 'こんにちは。きょうは いいてんきです。'],
  ['neutral_short', 'いいね。'],
  ['question_short', 'いいね？'],
  ['exclaim_short', 'いくよ！'],
  ['hesitation_short', 'まつかな……'],
  ['sibilants', 'さしすせそ。しずかに つづけて はなす。'],
  ['events', '（息）いくよ。（笑）でも……（ため息）やっぱり やめようかな。'],
  ['repair_restart', 'あ。（言い直し）い。'],
  ['repair_rethink', 'あ。（思い直し）い。'],
];

const browser = await chromium.launch({
  executablePath,
  headless: false,
  args: ['--autoplay-policy=no-user-gesture-required','--no-sandbox','--disable-dev-shm-usage'],
});

const summary = [];
for (const [name, text] of samples) {
  console.log('START', name);
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      errors.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => errors.push({ type: 'pageerror', text: String(error) }));
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const [{ VoiceSynth }, { parseVoiceScript }] = await Promise.all([
      import('/src/voice/VoiceSynth.ts'),
      import('/src/voice/VoiceScript.ts'),
    ]);
    const synth = new VoiceSynth();
    window.__voiceReview = { synth, parseVoiceScript };
    const button = document.createElement('button');
    button.id = 'voice-review-unlock';
    button.textContent = 'UNLOCK AUDIO';
    button.style.position = 'fixed';
    button.style.zIndex = '99999';
    button.style.left = '20px';
    button.style.top = '20px';
    button.addEventListener('click', () => {
      window.__voiceReviewUnlockPromise = synth.unlock();
    }, { once: true });
    document.body.append(button);
  });
  await page.click('#voice-review-unlock');
  await page.evaluate(async () => {
    await Promise.race([
      window.__voiceReviewUnlockPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Audio unlock timeout')), 8000)),
    ]);
  });

  const settings = {
    style: 'warm',
    character: 'natural',
    tone: 0,
    rate: 1,
    pitch: 60,
    energy: 0.92,
    intonation: 'auto',
    expression: { preset: 'neutral', intensity: 1 },
  };

  const result = await page.evaluate(async ({ text, settings }) => {
    const { synth, parseVoiceScript } = window.__voiceReview;
    const script = parseVoiceScript(text);
    const plan = synth.plan(script, settings);
    const blob = await synth.renderWav(script, settings);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return {
      wavBase64: btoa(binary),
      wavBytes: bytes.length,
      plan: {
        duration: plan.duration,
        units: plan.units.map((unit) => ({
          text: unit.unit.display,
          start: unit.start,
          duration: unit.duration,
          pitchMidi: unit.pitchMidi,
          energyScale: unit.energyScale,
          sentenceHesitation: unit.unit.sentenceHesitation,
        })),
        events: plan.events.map((event) => ({
          kind: event.event.kind,
          start: event.start,
          duration: event.duration,
          gapAfter: event.gapAfter,
        })),
        unsupported: script.unsupported,
      },
    };
  }, { text, settings });

  await fs.writeFile(`${outDir}/${name}.wav`, Buffer.from(result.wavBase64, 'base64'));
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  summary.push({ name, text, recordingBytes: result.wavBytes, plan: result.plan, errors });
  console.log('DONE', name, result.wavBytes, result.plan.duration);
  await page.close();
}
await fs.writeFile(`${outDir}/summary.json`, JSON.stringify({ executablePath, samples: summary }, null, 2));
await browser.close();
console.log('VOICE PLAYCHECK COMPLETE');
