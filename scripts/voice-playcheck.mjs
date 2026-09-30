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
  ['neutral', 'こんにちは。おんせい ごうせいの じっけんです。'],
  ['question', 'そうだね？ ほんとうに いくの？'],
  ['hesitation', 'どうしようかな…… えーと、もうすこし かんがえる。'],
  ['events', '（息）きょうは いくよ！（笑）でも……（ため息）やっぱり やめようかな。'],
  ['repair', 'きょうは いく。（言い直し）いや、あしたに する。（思い直し）やっぱり きょう いく。'],
];

const browser = await chromium.launch({
  executablePath,
  headless: true,
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
    window.__voiceReview = { synth: new VoiceSynth(), parseVoiceScript };
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
