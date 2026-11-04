# VibeVoice研究とSOUND WAVEの会話スタジオ（2026-11-05）

## 公式参照資料

- Microsoft: https://github.com/microsoft/VibeVoice
- 技術概要: https://www.microsoft.com/en-us/research/publication/vibevoice-expressive-podcast-generation-with-next-token-diffusion/
- VibeVoice-Realtime-0.5B: https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-realtime-0.5b.md
- VibeVoice-ASR: https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-asr.md
- 長文TTS: https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-tts.md
- MITライセンス: https://github.com/microsoft/VibeVoice/blob/main/LICENSE

## 技術的な発見

MicrosoftのVibeVoiceは**連続音声トークナイザー（7.5Hz）**と、長い文脈を扱う言語モデル・次トークン拡散による音声生成を組み合わせ、話者IDと発話順序を一貫した構造として扱います。論文の初期結果は最大30分・4話者で、公開されている長文TTS 1.5Bの説明には最大90分・4話者の記載があります。

**注意：Microsoftの公式TTS推論コードは2025-09-05に削除**されました。旧VibeVoice-TTS 1.5Bは主に英語・中国語で学習された研究モデルで、日本語TTSとして正式にサポートされません。声の不正模倣・なりすまし対策もあり、声の取り扱いには同意が必要です。

一方、**VibeVoice-Realtime-0.5B**は公式で配布が続いており、英語向けの単一話者・長文ストリーミングに対応。実験用として日本語音声プリセットも公開されていますが、公式では多言語の挙動が未十分検証とされています。発話開始まで約200〜300msという数値は公式開発環境での参考値であり、iPhone Safariでの性能ではありません。

**VibeVoice-ASR 7B**は多言語（日本語を含む）・話者分離・時刻付き文字起こしをまとめて扱えるモデル。特定の専門用語をホットワードで指定可能。2026年9月公開のASR-Streamingは10言語・逐次認識、2026年7月公開のVibeVoice-ASR-BitNetはCPUのための量子化実装で、Safariにそのままインストールできることを意味しません。

## 今回Sound Waveに追加した実装

Sound Wave / VOICE LABの **VOX LOCAL · NO SERVER** 設定内に **「4人会話スタジオ · VibeVoice参考」** を追加しました。

- A / B / C / D の4人までの話者IDを使い、`A: こんにちは。`、`[B] はい。`、`speaker_3: ...` の形式で台本を入力
- 最大10発話、全体420文字、1発話140文字。重いiPhone推論でメモリ不足になりにくいよう制限しています
- 各話者に独立した音声プリセット（柔らかい、自然、明瞭、ささやき、力強い）を割り当てて**話者が再登場しても同じ設定を使用**
- 話者の交代で約0.18〜0.27秒の間、同話者での継続では約0.13秒の間を設計
- 既存のVOX LOCAL/Kokoroで発話を順次生成し、**音声波形が完成してから**原音を保持してつなげる。長すぎるデジタル無音のみ保守的に調整
- 話者ごとの発話位置をタップしてiPhone標準プレーヤーで確認し、会話全体をWAVで保存
- 発音辞書は各発話にも適用。日本語の長文はモデルの入力上限を越えない位置で区切る
- ブラウザ内処理のみ。VibeVoiceモデルやマイクの録音を自動でダウンロード・アップロードしません
- 既存のSPEAK・VOICE IMPRINT・Ming-3.0比較・Haas ASR・Neural HQには変更を加えません

**これはVibeVoiceの音響モデルを再現したものではありません。** Kokoroは発話ごとに独立生成されるため、VibeVoiceが学習により実現した高度な発話横断の韻律連続性や自然な相づちを同等に保証するものでもありません。特に長い会話の同一話者の声質一致は実際に耳で評価してください。

### 台本例

```text
A: おはようございます。今日はどうしましょうか？
B: そうですね。まずは音声の品質を確認しましょう。
A: いいですね。一緒に試してみましょう。
C: 私も参加します。
```

## 今後の候補

1. 連続文脈を渡せるネイティブTTSが使えるようになれば、1発話ずつ独立生成する代わりに連続生成を比較
2. ASR結果の`Who / When / What`形式を取り込み、時間軸の自然さと文字認識精度を比較（現在のHaasの単一転写との違い）
3. VibeVoice-Realtime日本語の実験用プリセットについて、対応GPUサーバーで録音例を作り、同一台本を公平に比較する。現状は未接続、未検証
4. iPhoneではKokoroを維持して実測FPS・生成待ち時間・PCMメモリ消費を改善

研究の数値や配布状況は日々更新され得ます。MicrosoftのREADMEとモデルカードを参照してください。
