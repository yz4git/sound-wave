# NemotronLabs RE-USE 参考の録音修復ワークスペース

## 導入した内容

参考元: [NVIDIA NemotronLabs RE-USE](https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE)、[笑い声を保持する派生版](https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE-laughter)

RE-USEは**入力音声の修復モデル**です。話し方や音声そのものを生成するTTSでも、日本語のイントネーション推定モデルでもありません。音声の雑音・残響・クリッピング・コーデック歪みなどを修復し、発話内容や話者の特徴を維持することを目指します。日本語への効果は要実機評価（NVIDIAの公開学習データには日本語の明記がありません）。

SOUND WAVE の VOICE LAB に「RE-USE参考 · 録音音声の修復と原音A/B」を追加しました。

- **iPhone内 · 原音を守る軽補正**は別途作成した小規模な処理で、**本物のRE-USEではありません**。波形内の静かなところだけを最大11dB程度減衰し、音が出ているところは維持します。無音でない単語は切りません。元々静かな録音や大きく音割れしている音声には自動加工をしません。残響の除去、音割れの再構築、欠損音の復元などの機能はありません。
- **本物のRE-USE · 自分のGPUサーバー**では、利用者が指定した別のLinux/NVIDIA GPUサーバーへ録音WAVを送ります。アップロードは「修復する」を押した時だけ実行します。サーバーは別途用意する必要があります。
- 原音と修復音のiPhone標準再生、修復WAVの保存、修復音声を既存のVOICE IMPRINT分析へ渡す操作を追加しました。VOICE IMPRINTはDSPエンジンの簡易声質特徴抽出で、ゼロショット音声クローンではありません。
- モデルはアプリのロード時にダウンロードされません。既存のKokoro／VOX LOCAL音声生成パスや保存音声には自動適用しません。

## iPhoneだけで使う

1. https://yz4git.github.io/sound-wave/latest.html を開き、VOICE LABを起動。
2. 「RE-USE参考 · 録音音声の修復と原音A/B」を開く。
3. iPhoneの「ファイル」などから20秒以内の録音を選ぶ。
4. 「iPhone内 · 原音を守る軽補正」を選び「取り込んだ音声を修復する」。
5. 原音／補正音を聴き比べる。変化を感じない、あるいは変化を望まない音声は修復不要です。

入出力は最大12MBの音声です。内部処理は最大48kHz、モノラルです。入力がステレオの場合、チャンネル平均でモノラル化します。これは編集済み動画の音声や、同時発話の分離を保証するものではありません。

## NVIDIAの本物のRE-USEを実行する場合

モデルは2026年10月22日更新、約9.6Mパラメータで、公開推論にはLinux/NVIDIA GPU、CUDA/Triton等が必要です。iPhone Safariに`model.safetensors`をコピーしても動きません。

公式モデル環境で `inference.sh` の実行が成功することを**先に確認**してください。公式READMEの手順でモデルを取得し、公式環境のPythonにFastAPI、uvicorn、python-multipartをインストールします。

    huggingface-cli download nvidia/NVIDIA-NemotronLabs-RE-USE --local-dir ./NemotronLabs_REUSE
    cd ./NemotronLabs_REUSE
    sh inference.sh

公式モデルのディレクトリを指定し、SOUND WAVE側のオプションサーバーを起動します。

    export REUSE_MODEL_DIR=/absolute/path/to/NemotronLabs_REUSE
    export REUSE_API_TOKEN='24文字以上の長いランダムな秘密のトークン'
    export REUSE_CORS_ORIGIN='https://yz4git.github.io'
    python /absolute/path/to/sound-wave/extras/nemotron_reuse_server.py

実装はモデル重みを配布せず、**公式`inference.py`の`--input_folder`、`--output_folder`、`--config`コマンド**を呼び出すラッパーです。モデルとレシピの構造が更新された場合には動作確認・調整が必要です。モデルを利用した実GPU推論の完走はこの実装環境では未検証です。

サーバーは`127.0.0.1:7871`のみで起動。別途アクセス制御とHTTPSリバースプロキシを用意し、外部からは`https://your-gpu.example/api/enhance`に到達できるようにしてください。サーバーは認証付きの音声を上限20秒まで受信し、**音声WAVそのものを返します**。メッセージJSONやBase64は返しません。

サーバーを一般公開したまま無認証で運用しないでください。トークンはブラウザの設定に保存しませんが、HTTPSの送信先には音声データが渡ります。自分が管理するサーバー以外へ私的な録音を送信しないでください。

笑い声の品質を重視する場合は、サーバーの公式モデルディレクトリを `nvidia/NVIDIA-NemotronLabs-RE-USE-laughter` に置き換えてください。出力比較後も元のファイルは維持されます。

## 評価のポイント

- 原音と修復音で発話の言葉、音の始まりと終わり、話者の雰囲気、笑い声・息づかいが変わっていないかを聴き比べる。
- もともと明瞭なKokoroの声に、ノイズ除去モデルを常時適用すると逆効果の可能性があります。
- 改善結果は音量だけで判断せず、できるだけ同じ再生環境・音量で比較する。
- 使用条件は NVIDIA側の [OpenMDW 1.1](https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE) を確認。参考コードをSound Waveに複製していません。
