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


## 2026-11-05 追加: 会話音声の品質検証・タイムコード付き字幕

VOICE LABの「4人会話スタジオ」で会話を生成すると、次の操作が可能です。

1. **会話WAVを保存**：従来のまま。音声は端末で生成。
2. **話者付きSRT字幕を保存**：各発話のA/B/C/D、開始・終了時刻、台本をSRT字幕に変換。時刻は「生成したPCMの構成上の位置」であり、ASRが検出した実際の音声開始時刻とは異なる場合があります。iPhoneだけで使用可能。
3. **ローカル品質チェック**：各発話のPCMを端末内で解析し、音量、クリッピング、長い無音、極端に短い発話、同じ話者の音量変化を警告。AIによる自然さ判定ではなく、参考の音響指標。
4. **VibeVoice-ASR JSONの貼り付け**：Microsoft公開ASR推論結果の`segments`（`start_time/end_time/speaker_id/text`など）を取り込み、生成台本と比較。各発話のCER、欠落発話、話者IDの変化を確認。ASRを起動する環境は別途必要。公式の「Start time / End time / Speaker ID / Content」キーにも対応。
5. **任意のGPU自動認識**：`extras/vibevoice_asr_server.py`を、自分で管理するLinux/NVIDIA GPUサーバーで実行した場合だけ利用できます。音声WAVは送信ボタンと明示的な同意がある場合のみサーバーに送られます。

### GPUのVibeVoice-ASR連携（オプション）

公式公開リポジトリを利用します。VibeVoice-ASR（7B）の公式推論のドキュメント:
https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-asr.md

公式CUDA実行環境にて:

```sh
git clone https://github.com/microsoft/VibeVoice.git
cd VibeVoice
pip install -e .
pip install fastapi uvicorn python-multipart
```

別途モデル`microsoft/VibeVoice-ASR`を公式手順に従って取得できるNVIDIA GPU環境が必要です。

```sh
export VIBE_ASR_REPO=/absolute/path/to/VibeVoice
export VIBE_ASR_MODEL=microsoft/VibeVoice-ASR
export VIBE_ASR_TOKEN='24文字以上の強力なランダム秘密トークン'
export VIBE_ASR_CORS_ORIGIN=https://yz4git.github.io
python /absolute/path/to/sound-wave/extras/vibevoice_asr_server.py
```

アダプターは公式の`VibeVoiceASRProcessor`/`VibeVoiceASRForConditionalGeneration`を呼び、`post_process_transcription`でWho/When/WhatをJSONにします。追加用語のヒントは公式プロセッサーの`context_info`へ送ります。トークンが必要な`POST /api/vibe-asr`を実装しました。公開接続はTLS終端・アクセス制御・レート制限を付けたリバースプロキシで保護してください。サーバー自体は`127.0.0.1:7873`にのみ待ち受けます。

iPhone側は`https://your-gpu.example`（または`/api/vibe-asr`を含むURL）とトークンを指定します。会話WAVは120秒・12MB以下。実行したユーザーが明示同意し、ボタンを押した場合にのみ送信。ASR結果はブラウザ内で照合します。

**重要な限界:**

- GPUでの実VibeVoice-ASR音声認識は未検証。ブラウザのJSテストとビルドが成功しても、NVIDIA CUDA上の音声認識結果を保証できません。
- ASRが出す話者IDはA/B/C/Dと番号が一致しません。時間の重なりから推定対応しているため、隣り合う短い発話や誤認識では誤判定する可能性があります。
- 認識されなかった発話は「未認識」と表示し、正しく読み上げた扱いにしません。数値は信頼できる自然さの尺度ではありません。
- 公式の長文VibeVoice-TTSモデルをSound Wave内に組み込んだわけではなく、ブラウザでは今までどおりKokoroを使います。


## 2026-11-05 夜: Realtime日本語のKokoroブラインド比較を追加

公式VibeVoice-Realtime-0.5Bは**単一話者用**で、英語中心に訓練されています。2025年12月公開の追加実験プリセットに日本語音声がありますが、日本語での発音・自然さの品質はMicrosoft公式でも保証されていません。最大10分程度の長文に対応するモデルですが、iPhone内で同じ時間のPCMを扱うのは負荷が大きいため、Sound Waveでは**12〜180文字の日本語文章、70秒以下・12MB以下の比較WAV**に制限しました。

### iPhoneで比較する方法（自前GPUサーバー不要）

1. Microsoftの[公式Realtime Colab](https://colab.research.google.com/github/microsoft/VibeVoice/blob/main/demo/vibevoice_realtime_colab.ipynb)を開き、同じ日本語原稿を使ってVibeVoice-Realtime音声を生成し、WAVをiPhoneのファイルに保存する。日本語用実験音声を使用する場合は、公式の`demo/download_experimental_voices.sh`と現行ノートブックの対応状況を確認する。Colabではアカウントや実行枠が必要な場合があります。
2. [Sound Wave](https://yz4git.github.io/sound-wave/latest.html)でVOICE LAB → VOX LOCAL · NO SERVERを選ぶ。
3. 「VibeVoice-Realtime 日本語A/B · WAV持ち込み」を開く。Colabで使った日本語原稿をそのまま貼り付け、生成WAVを選択。
4. 「音量を合わせてブラインド比較」を押す。iPhoneのKokoroが**同一原稿**を生成します（初回はモデルの読み込みが必要）。
5. A/Bはランダム配置でモデル名を伏せています。自然さ、発音、文章のつながりのいずれかを選んで投票するとA/Bのモデル名が表示されます。

**モデルに送る音声データはありません。** VibeVoice音声はWAVをiPhone内で読み取るだけで、音声ファイル自体はアップロード・永続保存されません。Kokoroは従来どおり端末上のモデルを使用します。※ Microsoft Colab側で音声を生成する過程は、Colabのクラウドサービス上で実行されます。

### 品質比較の仕組み

`src/voice/VibeRealtimeCompare.ts`で、両モデルのPCMをそれぞれ測定し、平均RMSの幾何平均を共通の目標にして**増幅は最大約4dBまで**の控えめな音量マッチングをします。音量差が残る場合や再生時間差が1.5倍以上ある場合、長い無音がある場合は注意を出します。元のWAVは改変せず、比較用のコピーのみ加工します。元の文章を「同じもの」として生成したかは利用者が確認する必要があります。

この比較からは機械的に「どちらが高品質か」を決めません。VibeVoiceの声プリセットとKokoroの話者は同一人物ではないため、音色の好みと日本語の発音・リズムを混同しないよう注意が必要です。発音辞書を登録している場合、Kokoro側には辞書が適用されるため、それも評価条件の差となります。

### 公式GPUで一括生成する場合

Microsoftの[公式コマンド例](https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-realtime-0.5b.md)と[推論スクリプト](https://github.com/microsoft/VibeVoice/blob/main/demo/realtime_model_inference_from_file.py)を利用します。公式追加プリセットは次のコマンドで取得します。

```sh
bash demo/download_experimental_voices.sh
python demo/realtime_model_inference_from_file.py \
  --model_path microsoft/VibeVoice-Realtime-0.5B \
  --txt_path /path/to/japanese-plain-text.txt \
  --speaker_name THE_EXACT_INSTALLED_JAPANESE_PRESET_NAME \
  --output_dir ./outputs
```

`--speaker_name`は、ダウンロードした実験プリセット内の`.pt`ファイル名（拡張子なし）を確認して指定してください。適当な名前にすると、公式スクリプトは別の音声を自動選択することがあるため、無指定・不正名のまま日本語比較には使わないでください。

### 比較後に改善すべき点

発音がより自然だった文、語尾が不自然だった文、長文で息切れ・読み飛ばしが起こった文を集め、同じ台本で繰り返しA/B確認してください。**iPhoneの比較画面は完成していますが、VibeVoiceのGPU推論とiPhone実機での聴感評価は未検証です。** GPUやColabが準備できない場合、独自の音声生成機能が増えたわけではありません。
