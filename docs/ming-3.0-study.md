# Ming-3.0シリーズ調査とSOUND WAVEへの適用（2026-11-04）

## 公式資料
- [inclusionAI/Ming-3.0-tts](https://github.com/inclusionAI/Ming-3.0-tts)
- [Ming-3.0-tts-0.5b](https://huggingface.co/inclusionAI/Ming-3.0-tts-0.5b)
- [Ming-3.0-tts-tiny](https://huggingface.co/inclusionAI/Ming-3.0-tts-tiny)
- [Ming-3.0-audio-flash](https://github.com/inclusionAI/Ming-3.0-audio-flash)
- [Ming-3.0-asr](https://github.com/inclusionAI/Ming-3.0-asr)

## 調査で確認したこと

- **Ming-3.0-TTS-0.5B:** 約5億パラメータのdense日本語対応モデル。
- **Ming-3.0-TTS-tiny:** 7.9B total / 1.3B activeのMoEモデル。多話者 `podcast` タスクも対応。
- **Ming-3.0-ASR-tiny:** 音声認識。主対象は中国語と英語で、日本語TTSの評価器としてすぐに使えるわけではない。
- **Ming-3.0-audio-tiny / audio-flash:** 音声理解・認識・対話。主対象は中国語と英語で、フラッシュは126B total / 6.5B activeと大型。

TTSの公式READMEによる日本語MiniMaxAIテストの文字誤り率（CER）は **Ming-tiny 3.427%、Ming-0.5B 3.765%、VoxCPM2 4.358%**。同一の表内比較であり、聴感品質や日本語アクセントの良さの保証ではない。

**必須の制約:** TTSでは「日本語 `MULTILINGUAL`」タスクを使い、参照音声とその書き起こしを渡します。`VOICE_DESIGN`、`FREEFORM`、`BASIC`、`EMOTION`、`paralinguistic` などは別タスクで、任意に組み合わせられません。14種類の笑いやため息のインラインタグについては中国語・英語が対象。tinyの `podcast` タスクを、日本語の複数話者音声としてそのまま保証するものではありません。

モデルおよび公開コードはinclusionAIのMITライセンス。モデルごとのカードとその他の付属コードの条件も確認してください。使用者の権限のない声を取り込まないでください。

## SOUND WAVEに実装したこと

VOICE LAB内「Ming-3.0 日本語TTS · GPU比較」（折りたたみ）を追加。既存のKokoro / VOX LOCAL / iPhone標準音声の実装は変更せず、完全に任意の実験機能として切り離しています。

1. GPUサーバーの `0.5b` または `tiny` を選択
2. 使用権限のある参照音声（WAV・iPhoneで再生できるm4a等、元ファイル12MB以内・0.5〜20秒）と、録音中で実際に話している日本語テキストを入力。端末内で16bit PCM WAVに変換してから送信（送信用WAV上限8MB）
3. 自分が管理するHTTPS API URLとトークンを入力し、送信に同意
4. 「現在の文章をMing-3.0で生成」を押すと、参照WAVと入力した文章を指定GPUに送信して日本語のWAV音声を生成
5. iPhoneのネイティブ音声コントロールで再生・WAV保存。**同じ文章で、既に生成済みのVOX LOCAL WAVがある場合のみ**比較用のプレーヤーも表示

ブラウザが勝手にモデルや録音データをダウンロード／アップロードすることはありません。API設定・トークンやWAVをlocalStorageへ永続化しません。アプリを閉じる際に参照ファイル選択とトークンをクリアします。

## GPUサーバー構築

**注意: 実際のGPU上での動作検証は未実施。** inference関連の公開Python APIに合わせた独立アダプター `extras/ming_tts_server.py` を実装しました。

公式モデルの重みは大きく、公式の0.5B推論はH800-80GB/H20-96GBを利用した例が掲載されています。iPhone Safariは推論を実行せず、リモートのWAVを受け取るだけです。

Linux/NVIDIA GPU上で公式リポジトリを準備します:

    git clone https://github.com/inclusionAI/Ming-3.0-tts.git
    cd Ming-3.0-tts
    pip install -r requirements.txt
    pip install fastapi uvicorn python-multipart
    hf download inclusionAI/Ming-3.0-tts-0.5b --local-dir ./Ming-3.0-tts-0.5b
    python tools/preflight.py --model_path ./Ming-3.0-tts-0.5b

`tiny`では `requirements-tiny.txt` と `tools/preflight_tiny.py` に替え、`Ming-3.0-tts-tiny` の重みを取得します。Python、PyTorch、CUDAなどのバージョンも公式tinyガイドに合わせてください。

**0.5B構成例**:

    export MING_REPO_PATH=/absolute/path/Ming-3.0-tts
    export MING_MODEL_PATH=/absolute/path/Ming-3.0-tts/Ming-3.0-tts-0.5b
    export MING_TTS_VARIANT=0.5b
    export MING_TTS_API_TOKEN='24文字以上のランダムな長い秘密トークン'
    export MING_TTS_CORS_ORIGIN='https://yz4git.github.io'
    python /absolute/path/sound-wave/extras/ming_tts_server.py

- `127.0.0.1:7872` を外部HTTPSリバースプロキシで保護し、`https://your-gpu.example/api/ming-tts` へ公開してください。ユーザーに入力するURLはドメインだけでも、`/api/ming-tts` 付きでも使えます。
- FastAPIは `multipart/form-data` の `text`, `prompt_text`, `variant`, `audio` を受け取ります。Bearerトークン認証必須。WAVを返します。
- 一つのサーバーは `MING_TTS_VARIANT` で固定され、違うモデル指定にはHTTP 400を返します。1回に一つずつGPU生成します。
- 日本語推論は0.5Bで公式 `MingTTS.synthesize(task="MULTILINGUAL", language_id="Japanese", prompt_wav_path=..., prompt_text=..., use_spk_emb=True)` を使用。tinyでは公式 `MingTinyTTS.generate(task="multilingual",target_language="Japanese",prompt_wav=...,prompt_text=...)` を使用。
- 入力WAVは16bit PCM、1〜2ch、8〜48kHz、0.5〜20秒、8MB以下。対応外ファイルはブラウザで直接変換せず、事前に変換してください。
- ネットワーク通信は明示ボタンを押した時のみ。HTTPS・CORSとGPU認証を設定してください。APIはアクセス制限を設け、参照音声を提供する人の同意を得てください。

## 今後の改善に使える考え方

1. **声質設計と話し方制御は別タスク**として扱う。VOX LOCALの説明文と抑揚設定が、モデルのサポート範囲を越えているかをUIで明示する。
2. **人物・感情・ため息等を無条件で混在させず**、用途ごとの音声生成パイプラインとA/Bを作る。
3. **同じ日本語文章で実録比較**し、CERだけではなく自然さ、語尾、固有名詞の読み、声質の持続性を人間が評価する。
4. 将来GPU接続が利用可能なら、単なるDSP補正でできない「話し方をモデル側で生成する」音声の試験対象にする。

**この実装はMingのGPU推論結果を利用する実験インターフェイスであり、モデルをiPhoneに移植したものではありません。**
