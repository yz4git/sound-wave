/**
 * User-facing wait states for browser TTS. These indicate work stages and
 * elapsed time only; they never invent an inference percentage or ETA.
 */
export type SpeechWaitEngine = 'neural' | 'vox-local' | 'voxcpm2';
export type SpeechWaitStage = 'preparing' | 'cache' | 'loading' | 'generating' | 'refining' | 'connecting' | 'audio';

const STAGES: Record<SpeechWaitStage, string> = {
  preparing: '音声の準備中',
  cache: '保存済み音声を確認中',
  loading: '音声モデルを読み込み中',
  generating: '音声を生成中',
  refining: '音声を仕上げています',
  connecting: '音声サーバーの応答待ち',
  audio: '音声出力の開始待ち',
};

export function speechWaitStageFromStatus(message: string, previous: SpeechWaitStage): SpeechWaitStage {
  const value = message.toUpperCase();
  if (/WAITING FOR AUDIO|AUDIO OUTPUT|AUDIOCONTEXT|AUDIO UNLOCK/.test(value)) return 'audio';
  if (/RECONSTRUCT|RESAMPL|REFIN|MERG|UPSAMPL|COMPOS/.test(value)) return 'refining';
  if (/LOADING|LOAD MODEL|MODEL DOWNLOAD|DOWNLOADING|INITIALIZING/.test(value)) return 'loading';
  if (/CHECKING SAVED|SAVED PHRASE|CACHED|REUSING SAVED|CHECKING CACHE/.test(value)) return 'cache';
  if (/CONNECT|SERVER|REQUESTING|WAITING RESPONSE/.test(value)) return 'connecting';
  if (/GENERAT|SYNTHES|RENDER|INFEREN|PROCESSING|TOKEN IDS|PHONEMES/.test(value)) return 'generating';
  return previous;
}

export function speechWaitView(
  engine: SpeechWaitEngine,
  stage: SpeechWaitStage,
  elapsedSeconds: number,
): { headline: string; explanation: string; attention: boolean } {
  const seconds = Math.max(0, Math.floor(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0));
  const headline = `${STAGES[stage]} · ${seconds}秒経過`;
  const engineName = engine === 'vox-local' ? 'VOX LOCAL' : engine === 'neural' ? 'NEURAL HQ' : 'VOXCPM2';
  if (seconds >= 90) {
    return {
      headline,
      explanation: `${engineName}：90秒以上経過しています。処理が継続中か、応答が止まっている可能性があります。STOPで中止し、短い文章で再試行してください。`,
      attention: true,
    };
  }
  if (seconds >= 30) {
    return {
      headline,
      explanation: stage === 'loading'
        ? '初回のモデル取得や読み込みが長引いています。通信状況と端末メモリをご確認ください。停止する場合はSTOP。'
        : 'まだ音声の開始を確認できていません。iPhoneでの初回生成は長時間かかる場合があります。STOPで中断できます。',
      attention: true,
    };
  }
  if (stage === 'loading') {
    return {
      headline,
      explanation: '初回はモデルのダウンロード・初期化が必要です。正確な進捗率は取得できません。STOPで中断できます。',
      attention: false,
    };
  }
  if (stage === 'generating') {
    return { headline, explanation: '端末で音声を計算中です。完了後に再生が始まります。STOPで中断できます。', attention: false };
  }
  if (stage === 'cache') {
    return { headline, explanation: '保存済みの音声があれば、モデル生成を省略します。', attention: false };
  }
  if (stage === 'refining') {
    return { headline, explanation: '生成した音声の調整と再生準備を行っています。', attention: false };
  }
  if (stage === 'audio') {
    return { headline, explanation: '音声データは準備済みです。iPhoneの音声再生機能を開始しています。長く続く場合はSTOPから再生し直してください。', attention: false };
  }
  if (stage === 'connecting') {
    return { headline, explanation: 'サーバーの応答を待っています。ネットワーク接続をご確認ください。', attention: false };
  }
  return {
    headline,
    explanation: '文章と音声設定を準備しています。続けて読み込み・生成の状態を表示します。',
    attention: false,
  };
}
