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
for (const name of assetRefs) if (!existsSync(join(distDir, 'assets', name))) fail(`referenced Vite asset is missing: dist/assets/${name}`);
for (const required of ['service-worker.js', 'manifest.webmanifest', 'icon.svg', 'vocal-worklet.js', 'version.json']) {
  if (!existsSync(join(distDir, required))) fail(`dist/${required} is missing`);
}

const entryJavaScript = jsRefs.map((name) => readFileSync(join(distDir, 'assets', name), 'utf8')).join('\n');
for (const freshnessFeature of ['sound-wave-build-id-v1', '__fresh', 'service-worker.js', '__build']) {
  if (!entryJavaScript.includes(freshnessFeature)) fail(`production bundle is missing Pages freshness feature: ${freshnessFeature}`);
}
const version = JSON.parse(readFileSync(join(distDir, 'version.json'), 'utf8'));
if (typeof version.buildId !== 'string' || version.buildId.length < 3) fail('dist/version.json has no valid buildId');
for (const genreFeature of ['J-POP', 'ROCK', 'K-POP', 'GAME MUSIC']) {
  if (!entryJavaScript.includes(genreFeature)) fail(`production bundle is missing Auto Compose Genre Style Engine feature: ${genreFeature}`);
}
for (const arrangementFeature of ['power-pulse', 'syncopated-808', 'arpeggio-pulse', 'eighth-drive', 'offbeat-stabs']) {
  if (!entryJavaScript.includes(arrangementFeature)) fail(`production bundle is missing Genre Arrangement Grammar feature: ${arrangementFeature}`);
}
for (const scoreAlignedExpressionFeature of ['consonantPreRollSeconds', 'transitionPreservation', 'sustainTimbreMotion', 'upperFormantScale']) {
  if (!entryJavaScript.includes(scoreAlignedExpressionFeature)) fail(`production bundle is missing score-aligned expression feature: ${scoreAlignedExpressionFeature}`);
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
for (const voiceLabFeature of ['VOICE LAB', 'PROSODY DRAW', 'DRAW ENERGY', 'DRAW TIMING', 'manualEnergyScale', 'manualDurationScale']) {
  if (!entryJavaScript.includes(voiceLabFeature)) fail(`production bundle is missing VOICE LAB prosody editor: ${voiceLabFeature}`);
}
for (const expressionFeature of ['neutral', 'calm', 'excited', 'serious', 'whisper', 'narration', 'STYLE INTENSITY', 'voicingScale']) {
  if (!entryJavaScript.includes(expressionFeature)) fail(`production bundle is missing VOICE LAB expression feature: ${expressionFeature}`);
}
for (const localDeliveryFeature of ['SELECT TEXT', 'LOCAL DELIVERY', 'CLEAR TAGS', 'localExpressions', 'SELECT TEXT FIRST']) {
  if (!entryJavaScript.includes(localDeliveryFeature)) fail(`production bundle is missing VOICE LAB local delivery feature: ${localDeliveryFeature}`);
}
for (const japaneseG2PFeature of ['KANJI G2P', 'OPEN JTALK', 'pitchAccent', 'open_jtalk_dic_utf_8-1.11.tar.gz', 'browser/worker.js']) {
  if (!entryJavaScript.includes(japaneseG2PFeature)) fail(`production bundle is missing VOICE LAB Japanese G2P feature: ${japaneseG2PFeature}`);
}
for (const speechSourceFeature of ['speechSourceMix', 'speechSourceTilt', 'speechCoarticulation', 'speechPulseNoise', 'geminateClosureSeconds']) {
  if (!entryJavaScript.includes(speechSourceFeature)) fail(`production bundle is missing VOICE LAB speech source feature: ${speechSourceFeature}`);
}
for (const fullSongFeature of ['FULL SONG', 'songSections', 'PRE-CHORUS', 'INTERLUDE', 'BRIDGE']) {
  if (!entryJavaScript.includes(fullSongFeature)) fail(`production bundle is missing full-song structure: ${fullSongFeature}`);
}
for (const ensembleFeature of ['harmonyTargetHz', 'harmonyGainScale', 'STACKED', 'DOUBLE', 'HARMONY']) {
  if (!entryJavaScript.includes(ensembleFeature)) fail(`production bundle is missing Vocal Ensemble feature: ${ensembleFeature}`);
}
for (const productionSuiteFeature of ['AUTO COMPOSE v4', 'compose-vocal-director', 'compose-export-wav', '16-BIT WAV EXPORTED']) {
  if (!entryJavaScript.includes(productionSuiteFeature)) fail(`production bundle is missing Auto Compose v4 production suite: ${productionSuiteFeature}`);
}
for (const mixMasterFeature of ['stereoWidth', 'lowEndDuck', 'masterDrive', 'WIDTH']) {
  if (!entryJavaScript.includes(mixMasterFeature)) fail(`production bundle is missing Mix & Master v1: ${mixMasterFeature}`);
}
for (const lyricsV2Feature of ['青い空を見上げた', '未来はここから始まる', 'lyricLine']) {
  if (!entryJavaScript.includes(lyricsV2Feature)) fail(`production bundle is missing Japanese Lyrics v2: ${lyricsV2Feature}`);
}
for (const instrumentsV2Feature of ['rhythm-guitar', 'synth-pad', 'brass', 'synth-lead']) {
  if (!entryJavaScript.includes(instrumentsV2Feature)) fail(`production bundle is missing Arrangement Instruments v2: ${instrumentsV2Feature}`);
}
for (const directorFeature of ['EMOTIONAL', 'INTIMATE', 'ensembleScale', 'releaseScale']) {
  if (!entryJavaScript.includes(directorFeature)) fail(`production bundle is missing Vocal Director v1: ${directorFeature}`);
}
for (const exportFeature of ['sound-wave-song-v1', 'audio/wav', 'RIFF', 'PROJECT JSON EXPORTED']) {
  if (!entryJavaScript.includes(exportFeature)) fail(`production bundle is missing Song Export feature: ${exportFeature}`);
}
for (const karaokeLyricsFeature of ['KARAOKE LYRICS', 'compose-lyrics-panel', 'compose-lyrics-current', 'compose-lyrics-mora', 'karaoke-progress']) {
  if (!entryJavaScript.includes(karaokeLyricsFeature)) fail(`production bundle is missing Karaoke Lyrics Panel feature: ${karaokeLyricsFeature}`);
}

const serviceWorker = readFileSync(join(distDir, 'service-worker.js'), 'utf8');
for (const swFreshnessFeature of ["CACHE_PREFIX = 'sound-wave-'", "endsWith('/version.json')", "cache: 'no-store'", "'/assets/'"]) {
  if (!serviceWorker.includes(swFreshnessFeature)) fail(`service worker is missing freshness feature: ${swFreshnessFeature}`);
}

const vocalWorklet = readFileSync(join(distDir, 'vocal-worklet.js'), 'utf8');
for (const workletSpeechFeature of ['speechTiltState', 'speechSourceMix', 'speechSourceTilt', 'speechCoarticulation', 'speechPulseNoise']) {
  if (!vocalWorklet.includes(workletSpeechFeature)) fail(`vocal worklet is missing speech source feature: ${workletSpeechFeature}`);
}
try { new Function(vocalWorklet); } catch (error) {
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

console.log(`[validate:prod] OK — ${jsRefs.length} entry JS bundle(s), ${cssRefs.length} entry CSS bundle(s), Auto Compose v4 Production Suite + Karaoke Lyrics Panel + Mix/Master v1 + Japanese Lyrics v2 + Arrangement Instruments v2 + Vocal Director v1 + Project/WAV Export + Full Song + Vocal Ensemble + v20.x/v21.x vocal safety stack`);
