# Haas-ASRを利用した Sound Wave の聞き取りチェック

参考: https://github.com/third-intelligence/Haas-ASR

**これは音声認識（ASR）を用いた品質検査です。TTSモデルの置き換えではありません。** 日本語CERは読み取れた文字の比較で、会話の自然さを直接測定しません。

## iPhoneのみで利用
VOICE LAB → VOX LOCAL（iPhone互換OFF）→ SPEAK →「日本語の聞き取り・間をチェック」を展開。無音時間と長い無音区間を端末内で確認できます。ほかのASRで認識した文章があれば貼り付けて簡易CERを計算できます。

簡易CERはUnicode NFKC・小文字化・句読点と空白の除去を使います。かな柔軟評価はさらにカタカナをひらがなに変換します。Haasの公式jacerとは異なるのでベンチマーク得点として引用できません。

## Haas-ja-v1.0を使った自動認識（Linux NVIDIA GPUが別途必要）
HaasはFastConformer/TDTの約616Mパラメータモデルです。Linux、NVIDIA GPU、CUDA/Tritonを必要とするため、iPhoneブラウザ内では動きません。

公式リポジトリをGPUマシンで準備:

    git clone https://github.com/third-intelligence/Haas-ASR.git
    cd Haas-ASR
    uv sync --group demo
    uv pip install --python .venv/bin/python python-multipart

Sound Waveの extras/haas_audit_server.py をGPUマシンに用意。**強いトークンを設定し、127.0.0.1で起動してください。**

    export HAAS_API_TOKEN='20文字以上の長いランダムな秘密トークン'
    export HAAS_CORS_ORIGIN='https://yz4git.github.io'
    uv run --with python-multipart python /path/to/sound-wave/extras/haas_audit_server.py

認証・アクセス制御のあるHTTPSリバースプロキシを設定して https://your-gpu.example/api/transcribe を公開します。Sound WaveにURLとトークンを入力し、送信ボタンを押した場合に限り生成WAVを送信します。トークンは保存されません。

**注意:** Haas公式デモはWebSocket /ws/longform を利用します。この追加アダプターは別のHTTP POST /api/transcribe を提供します。公式のWebSocket URLをそのまま入力しても動きません。GitHub PagesからHTTPのAPIには接続できません。

## 評価とセキュリティ
- CERの高さはASR自体の誤認識や同音異義語の表記差でも変わります。TTSの発音欠陥と断定できません。
- 無音区間の解析は20ms RMSで行い、0.42秒以上を長い間として数えます。音声自体は変更しません。
- HaasのVocabularyは固有名詞の認識を助けますが、語を誤挿入する可能性があります。発音の品質比較では原則としてブーストを使いません。
- 生成音声を送る先とトークンはユーザーの管理下に置き、一般公開のGPUサーバーを無認証で運用しないでください。
- オリジナルHaasコードとモデルはApache 2.0ライセンス。Sound WaveにHaasライブラリをバンドルするのではなく、任意のGPU側で別プロセスとして使用します。