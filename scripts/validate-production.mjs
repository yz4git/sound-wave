import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const distDir = 'dist';
const indexPath = join(distDir, 'index.html');

function fail(message) {
  console.error(`[validate:prod] ${message}`);
  process.exit(1);
}

if (!existsSync(indexPath)) fail('dist/index.html is missing');

const html = readFileSync(indexPath, 'utf8');

if (/\/src\/main\.ts|src\/main\.ts/.test(html)) fail('dist/index.html still references TypeScript source');
if (/(?:src|href)=["'][^"']*(?:^|\/)app\.js["']|(?:src|href)=["'][^"']*(?:^|\/)styles\.css["']/.test(html)) {
  fail('dist/index.html references the removed build-independent runtime');
}

const assetRefs = [...html.matchAll(/(?:src|href)=["']\.\/?assets\/([^"']+)["']/g)].map((match) => match[1]);
const jsRefs = assetRefs.filter((name) => name.endsWith('.js'));
const cssRefs = assetRefs.filter((name) => name.endsWith('.css'));
if (jsRefs.length === 0) fail('dist/index.html has no Vite JavaScript bundle reference');
if (cssRefs.length === 0) fail('dist/index.html has no Vite CSS bundle reference');

for (const name of assetRefs) {
  if (!existsSync(join(distDir, 'assets', name))) fail(`referenced Vite asset is missing: dist/assets/${name}`);
}
for (const required of ['service-worker.js', 'manifest.webmanifest', 'icon.svg', 'vocal-worklet.js']) {
  if (!existsSync(join(distDir, required))) fail(`dist/${required} is missing`);
}

const entryJavaScript = jsRefs.map((name) => readFileSync(join(distDir, 'assets', name), 'utf8')).join('\n');
for (const genreFeature of ['J-POP', 'ROCK', 'K-POP', 'GAME MUSIC']) {
  if (!entryJavaScript.includes(genreFeature)) fail(`production bundle is missing Auto Compose Genre Style Engine feature: ${genreFeature}`);
}
for (const arrangementFeature of ['power-pulse', 'syncopated-808', 'arpeggio-pulse', 'eighth-drive', 'offbeat-stabs']) {
  if (!entryJavaScript.includes(arrangementFeature)) fail(`production bundle is missing Genre Arrangement Grammar feature: ${arrangementFeature}`);
}
for (const vocaloidExpressionFeature of ['consonantPreRollSeconds', 'transitionPreservation', 'sustainTimbreMotion', 'upperFormantScale']) {
  if (!entryJavaScript.includes(vocaloidExpressionFeature)) fail(`production bundle is missing VOCALOID-informed expression feature: ${vocaloidExpressionFeature}`);
}
for (const spectralTrajectoryFeature of ['timeSmoothingMs', 'transitionSmoothingMs', 'frequencySmoothing', 'transitionProtectionSeconds', 'spectralTiltDepth', 'trajectoryDepth']) {
  if (!entryJavaScript.includes(spectralTrajectoryFeature)) fail(`production bundle is missing spectral-envelope trajectory feature: ${spectralTrajectoryFeature}`);
}
for (const sourceFilterFeature of ['tractFeedbackDepth', 'sourceTiltDepth', 'openQuotientOffset', 'speedQuotientOffset', 'aspirationCoupling', 'highPitchCompensation', 'filterLoad', 'spectralCouplingDepth']) {
  if (!entryJavaScript.includes(sourceFilterFeature)) fail(`production bundle is missing v20.9 dynamic source-filter coupling: ${sourceFilterFeature}`);
}
for (const producerTuningFeature of ['timingLeadSeconds', 'consonantLengthScale', 'dynamicsStartScale', 'dynamicsEndScale', 'attackTimeScale', 'airScale', 'mouthScale', 'articulationScale', 'scoopCentsAdd', 'fallCentsAdd', 'vibratoScale', 'jitterScale']) {
  if (!entryJavaScript.includes(producerTuningFeature)) fail(`production bundle is missing v21.0 producer tuning grammar: ${producerTuningFeature}`);
}
for (const voiceCharacterFeature of ['SOFT', 'NATURAL', 'CLEAR', 'AIRY', 'POWER', 'upperFormantGainScale', 'compose-voice-character', 'compose-voice-tone']) {
  if (!entryJavaScript.includes(voiceCharacterFeature)) fail(`production bundle is missing v21.1 voice character macro: ${voiceCharacterFeature}`);
}
for (const fullSongFeature of ['AUTO COMPOSE v3', 'FULL SONG', 'songSections', 'PRE-CHORUS', 'INTERLUDE', 'BRIDGE']) {
  if (!entryJavaScript.includes(fullSongFeature)) fail(`production bundle is missing Auto Compose v3 full-song structure: ${fullSongFeature}`);
}
for (const ensembleFeature of ['harmonyTargetHz', 'harmonyGainScale', 'STACKED', 'DOUBLE', 'HARMONY']) {
  if (!entryJavaScript.includes(ensembleFeature)) fail(`production bundle is missing Vocal Ensemble feature: ${ensembleFeature}`);
}
for (const lyricsFeature of ['JAPANESE LYRICS', 'lyricLine', '青い空こえて', '未来を鳴らそう']) {
  if (!entryJavaScript.includes(lyricsFeature)) fail(`production bundle is missing Japanese Lyrics Engine feature: ${lyricsFeature}`);
}

const vocalWorklet = readFileSync(join(distDir, 'vocal-worklet.js'), 'utf8');
try {
  new Function(vocalWorklet);
} catch (error) {
  fail(`dist/vocal-worklet.js has invalid JavaScript syntax: ${error instanceof Error ? error.message : String(error)}`);
}
if (!vocalWorklet.includes("registerProcessor('sound-wave-vocal-processor'")) fail('dist/vocal-worklet.js does not register the Sound Wave vocal processor');
if (/createOscillator\s*\(/.test(vocalWorklet)) fail('vocal AudioWorklet must generate one continuous glottal stream without per-note OscillatorNode creation');
for (const requiredFeature of ['sourceTractCoupling', 'aspirationDepth', 'centeringStart', 'phraseEnergy']) {
  if (!vocalWorklet.includes(requiredFeature)) fail(`vocal AudioWorklet is missing Human Phrase Model feature: ${requiredFeature}`);
}
for (const antiCrackFeature of ['transitionFromHz', 'safeDesiredHz', 'safeF1', 'Number.isFinite(sample)']) {
  if (!vocalWorklet.includes(antiCrackFeature)) fail(`vocal AudioWorklet is missing anti-crack protection: ${antiCrackFeature}`);
}
for (const phonemeFeature of ['phonemeExcitation', 'coarticulationMix', 'nextHz', 'moraicN', 'closureSeconds', 'fricationSeconds']) {
  if (!vocalWorklet.includes(phonemeFeature)) fail(`vocal AudioWorklet is missing Japanese phoneme/coarticulation feature: ${phonemeFeature}`);
}
for (const scoringFeature of ['DEFAULT_KARAOKE', 'pitchStability', 'straightHoldRatio', 'vibratoGain', 'scoopCents', 'fallCents', 'dynamicGain']) {
  if (!vocalWorklet.includes(scoringFeature)) fail(`vocal AudioWorklet is missing karaoke-score-inspired singing feature: ${scoringFeature}`);
}
for (const resonanceFeature of ['DEFAULT_RESONANCE', 'harmonicCollision', 'collisionBandwidthBoost', 'formantGainScale', 'dynamicOpenQuotient', 'dynamicSpeedQuotient', 'nasalAntiFormant', 'vibratoResonanceDepth']) {
  if (!vocalWorklet.includes(resonanceFeature)) fail(`vocal AudioWorklet is missing dynamic resonance/glottal feature: ${resonanceFeature}`);
}
for (const spectralWorkletFeature of ['DEFAULT_SPECTRAL', 'spectralSmoothingAlpha', 'spectralFrequencyState', 'spectralBandwidthState', 'spectralRawGain', 'frequencySmoothing', 'transitionProtectionSeconds', 'vibratoEnvelopeDepth']) {
  if (!vocalWorklet.includes(spectralWorkletFeature)) fail(`vocal AudioWorklet is missing v20.8 spectral-envelope trajectory: ${spectralWorkletFeature}`);
}

console.log(`[validate:prod] OK — ${jsRefs.length} entry JS bundle(s), ${cssRefs.length} entry CSS bundle(s), Vite-only production artifact + Auto Compose v3 Full Song Structure + Vocal Ensemble + Japanese Lyrics Engine + Genre Style/Arrangement Grammar + VOCALOID-informed expression + v20.8 spectral-envelope trajectory + v20.9 dynamic source-filter coupling + v21.0 producer tuning grammar + v21.1 voice character macros + Human Phrase Model + Japanese phoneme/coarticulation + karaoke-score phrasing + dynamic resonance/glottal AudioWorklet`);
