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

const captureInit = String.raw`
(() => {
  const originalConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(...args) {
    const destination = args[0];
    try {
      const context = this.context;
      if (context && destination === context.destination) {
        if (!context.__voiceReviewCapture) {
          context.__voiceReviewCapture = context.createMediaStreamDestination();
          window.__voiceReviewStream = context.__voiceReviewCapture.stream;
        }
        originalConnect.call(this, context.__voiceReviewCapture);
      }
    } catch {}
    return originalConnect.apply(this, args);
  };
  window.__startVoiceReviewRecording = () => {
    if (!window.__voiceReviewStream) throw new Error('Capture stream unavailable');
    const types = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
    const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    const chunks = [];
    const recorder = new MediaRecorder(window.__voiceReviewStream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    window.__voiceReviewRecorder = recorder;
    window.__voiceReviewChunks = chunks;
    recorder.start(100);
    return recorder.mimeType;
  };
  window.__stopVoiceReviewRecording = () => new Promise((resolve, reject) => {
    const recorder = window.__voiceReviewRecorder;
    if (!recorder) return reject(new Error('Recorder unavailable'));
    recorder.onstop = async () => {
      const blob = new Blob(window.__voiceReviewChunks, { type: recorder.mimeType });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      resolve({ mimeType: recorder.mimeType, base64: btoa(binary), size: bytes.length });
    };
    recorder.stop();
  });
})();
`;

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required','--no-sandbox','--disable-dev-shm-usage'],
});

const summary = [];
for (const [name, text] of samples) {
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  await page.addInitScript(captureInit);
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
    await synth.unlock();
    window.__voiceReview = { synth, parseVoiceScript };
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
  const plan = await page.evaluate(({ text, settings }) => {
    const script = window.__voiceReview.parseVoiceScript(text);
    const plan = window.__voiceReview.synth.plan(script, settings);
    return {
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
    };
  }, { text, settings });
  await page.evaluate(() => window.__startVoiceReviewRecording());
  await page.evaluate(async ({ text, settings }) => {
    const script = window.__voiceReview.parseVoiceScript(text);
    await window.__voiceReview.synth.play(script, settings);
  }, { text, settings });
  await page.waitForTimeout(Math.ceil((plan.duration + 0.5) * 1000));
  const recording = await page.evaluate(() => window.__stopVoiceReviewRecording());
  const ext = recording.mimeType.includes('webm') ? 'webm' : 'ogg';
  await fs.writeFile(`${outDir}/${name}.${ext}`, Buffer.from(recording.base64, 'base64'));
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  summary.push({ name, text, mimeType: recording.mimeType, recordingBytes: recording.size, plan, errors });
  await page.close();
}
await fs.writeFile(`${outDir}/summary.json`, JSON.stringify({ executablePath, samples: summary }, null, 2));
await browser.close();
