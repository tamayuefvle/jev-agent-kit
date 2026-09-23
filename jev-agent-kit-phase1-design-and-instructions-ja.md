# jev-agent-kit Phase 1 — 設計書・実装指示書

作成日：2026-09-23 / 設計版：1.0 / 対象実装者：GPT-6 Sol、reasoning effort high

## 0. この依頼の到達点

独立リポジトリに、プロジェクトに依存しないJev共通ランタイム・CLI・設定スキーマを構築する。ビルド済みパッケージを一時的な別プロジェクトへインストールし、公開APIとCLIを使えることまで確認する。

本書は実装前の設計・指示であり、実装済み報告ではない。BOS・bos-homeの現在のソースは調査していない。それらのパス、状態、フック、モデル切替機能を推測して組み込まない。

今回の成果は「Phase 1の基盤完成」であり、「5スキル完成」「BOS連携完成」「判断品質の実証」ではない。

## 1. 採用する構成と範囲

### 1.1 決定事項

| 項目 | 決定 |
|---|---|
| 仮リポジトリ名・パッケージ名 | jev-agent-kit。名前の公開登録可否は未確認 |
| 初期バージョン | 0.1.0、package.jsonはprivate: true |
| 配布確認 | npm packによるtarballを別ディレクトリへインストール |
| 言語・実行環境 | TypeScript strict、ESM、Node.js 24系を初版のサポート対象とする |
| 管理 | npm、package-lock.jsonをコミット |
| パッケージ構成 | 単一パッケージ。monorepo化しない |
| CLI名 | jev-kit |
| 設定 | jev-kit.config.json。実行可能なTS/JS設定は初版では扱わない |
| 設定の契約 | JSON Schema Draft-07とAjv。型・デフォルトの重複による不一致をテストで防ぐ |
| HTTP | Node標準fetch。テストではtransportを注入する |
| 初版の姿勢 | 判断結果の返却のみ。操作実行・承認・モデル切替を行わない |

依存バージョンは実装時に公式情報を確認し、互換性のある具体的なバージョンとlockfileを記録する。「最新」という指定だけで再現性を済ませない。

### 1.2 今回実装するもの

1. Choice・Score・Noulの型、リクエスト検証、応答検証。
2. Jev HTTPクライアントと一貫した結果・エラー形式。
3. JSON設定ファイルの読込、デフォルト適用、検証。
4. init / config validate / doctor / evaluate / help / versionコマンド。
5. 任意のメタデータログ。生の入力・回答本文は保存しない。
6. 合成データによる例、契約テスト、CLI・パッケージ導入テスト。
7. README、設計記録、API根拠、変更履歴、将来の役割一覧。

### 1.3 次段階へ残すもの

5役割のSKILL.md、役割固有の質問・閾値、decideサブコマンド、検索、ファイル順位付け、履歴圧縮、実行前フック、MCPサーバー、エージェント自動起動、モデル自動切替、BOS・bos-homeの編集、IDEAやゲート遷移、Web UI、DB、ダッシュボード、結果キャッシュ、汎用プラグイン機構、公開npm配布。

将来の役割IDは context-select / work-route / action-review / evidence-check / context-retain としてdocs/roadmap.mdに記録するだけでよい。未実装のコマンドや空のスキルを「使えるもの」として配布しない。

## 2. 境界と依存方向

CLI → 設定・入力検証 → 共通ランタイム → Jev transport → 応答検証 → 結果

- ランタイムはBOS、bos-home、Cursor、Codexに依存しない。
- CLIだけがargv、stdin/stdout、終了コードを扱う。
- ランタイムはprocess.exitを呼ばず、インポート時のファイル・ネットワーク操作をしない。
- エラーで上位LLMを勝手に呼ばない。呼出元へ「失敗」を返し、既存処理への復帰は呼出元が決める。
- API通信の成否と、判断内容の正しさを混同しない。
- リポジトリを自動巡回せず、明示されたJSON入力だけを送る。

想定配置：

```text
src/
  index.ts
  contracts/
  config/
  runtime/
  cli/
schemas/jev-kit.config.schema.json
examples/
tests/
docs/design.md
docs/api-contract.md
docs/roadmap.md
README.md
CHANGELOG.md
package.json
package-lock.json
tsconfig.json
```

ファイル数の帳尻合わせは不要。責務が明確なら小さくまとめてよい。

## 3. 外部APIと内部契約

### 3.1 公式仕様の確認事項

2026-09-23時点の公式APIは POST https://api.typesafe.ai/v1/systemone、Bearer認証。要求はstate / model / questions、応答はmodel / answers / usageを中心に構成される。NoulはYesの確率で、独立したconfidenceを持たない。ChoiceとScoreには確率分布とconfidenceがある。[S1][S2]

Scoreは順序付き水準の評価であり、単純な0〜1の品質値ではない。[S3]

実装開始時に公式API・各primitiveページを確認する。仕様が変わっていればdocs/api-contract.mdに差分と採用仕様を記録する。第三者サイトの互換APIや架空のSDKを代用しない。

### 3.2 初版でサポートする入力の部分集合

入力ファイルの形式は次とする。modelは設定から取得し、入力ファイルによる上書きは認めない。

```json
{
  "state": "保存ボタンを押すとエラーになる。",
  "questions": {
    "needs_investigation": {
      "type": "noul",
      "instructions": "原因が特定されていない不具合報告か？"
    }
  }
}
```

- state：string / JSON object / JSON array。null・単独数値・単独booleanは受け付けない。
- instructions：初版は空でないstringのみ。公式の構造化instructionsは将来拡張と明記。
- Noul criteria：任意。指定時はtrue / falseの空でない説明文字列を両方要求。
- Choice criteria：2〜255候補、候補説明は空でない文字列。本キットの意図的な入力制限。
- Score criteria：2〜10個の空でない説明文字列。
- questions：1〜64件を本キットの初版上限とする。公式上限とは呼ばない。
- question ID / Choice候補ID：英数字開始、以降英数字・ハイフン・アンダースコア、1〜64文字。__proto__ / constructor / prototypeは禁止。マップ処理はown propertyのみ使用。
- 空白だけのstate文字列、未知の制御フィールド、不正な型を拒否。
- JSONに含まれるテキストは評価対象データであり、CLIへの命令として実行しない。

### 3.3 公開TypeScript API

公開関数は少数に固定する。

```ts
loadConfig(path: string): Promise<ConfigResult>
validateConfig(value: unknown): ConfigResult
evaluate(
  input: unknown,
  config: ValidatedConfig,
  options?: { signal?: AbortSignal }
): Promise<EvaluationResult>
```

本番APIは既定transportを使用。テスト用transport / clock / sleepの差替えは内部のfactoryに集約し、初版の公開APIとして過剰に一般化しない。

想定される運用エラーはdiscriminated unionで返す。未知の例外はCLI最上位で安全なINTERNAL_ERRORへ変換する。TypeScript型だけを信用せず実行時にも検証する。

### 3.4 CLIの結果形式

成功例（数値は仕様説明用の合成例）：

```json
{
  "schemaVersion": 1,
  "command": "evaluate",
  "ok": true,
  "data": {
    "requestedModel": "jev-latest",
    "resolvedModel": "example-model",
    "answers": {
      "needs_investigation": { "type": "noul", "noul": 0.91 }
    },
    "usage": { "input_tokens": 100, "output_tokens": 10 }
  },
  "meta": { "durationMs": 150, "attempts": 1 }
}
```

失敗例：

```json
{
  "schemaVersion": 1,
  "command": "evaluate",
  "ok": false,
  "error": {
    "code": "AUTH_MISSING",
    "message": "指定された認証用環境変数が設定されていません。",
    "retryable": false
  },
  "meta": { "durationMs": 0, "attempts": 0 }
}
```

- okは処理成功であり、回答の正解・操作の許可ではない。
- エラーにanswersを混ぜず、失敗時に肯定値や合格値を補完しない。
- APIの生エラー本文、Authorization、入力本文、スタックトレースは出力しない。
- schemaVersion / command / ok / metaはJSON出力の共通エンベロープ。dataはコマンド別。
- validateやdoctorも機械処理できる結果を返す。help/versionのみ通常のテキストでよい。

### 3.5 応答検証

- HTTP 200でもJSON不正、必須項目不足、型違いならPROVIDER_CONTRACT_ERROR。
- 質問と回答のID集合・typeが一致すること。
- Noulの値、確率、confidenceは有限値で0〜1。
- Choiceの選択値と分布のキーは要求候補と一致。選択値は最大確率の候補のいずれか。
- Scoreの値は0〜水準数−1。分布・legendのキーは0始まりの文字列インデックスと一致。legendの説明は文字列。
- 確率の和は許容誤差1e-3で1。Scoreと分布加重平均の差も1e-3以内。これは本キットの検証方針であり、実APIの丸めが異なる場合は根拠とテストを伴って調整する。
- usageの入力・出力トークン数は非負整数。
- providerの追加メタデータは拒否せず、利用せずに除外する。設定・キット入力は未知項目を拒否する。

## 4. 設定スキーマ

initが生成する既定設定：

```json
{
  "schemaVersion": 1,
  "projectId": "sample-project",
  "provider": {
    "model": "jev-latest",
    "apiKeyEnv": "TYPESAFE_API_KEY"
  },
  "runtime": {
    "requestTimeoutMs": 10000,
    "totalTimeoutMs": 30000,
    "maxRetries": 0,
    "maxInputBytes": 262144
  },
  "telemetry": {
    "enabled": false,
    "path": ".jev-kit/events.jsonl"
  }
}
```

- JSONのみ。前回答で例示したjev-kit.config.tsは将来案とし、初版では採用しない。
- schemaVersionとprojectIdは必須。他はセクション単位・フィールド単位で既定値を補完後に検証する。
- schemaVersionは1のみ。未知のキーを拒否し、AjvのcoerceTypes/removeAdditionalは無効。
- projectIdは1〜64文字、英数字開始、英数字・ハイフン・アンダースコアのみ。
- modelは空白なしの空でない文字列。モデル名を公式の不変リストとして埋め込まない。
- apiKeyEnvは環境変数名でありキー本体ではない。値はtrimして空ならAUTH_MISSING。
- maxRetriesは0〜2、maxInputBytesは1KiB〜1MiB、timeoutは1〜120秒、requestTimeoutMs ≤ totalTimeoutMs。
- API URLは公式HTTPS endpointに固定。任意ホスト設定、リダイレクト追従、.env自動読込は実装しない。
- ログpathは設定ファイル所在ディレクトリ内の相対パスのみ。..、絶対パス、シンボリックリンクによる外部逸脱を拒否する。
- 既定設定は利便性のためaliasモデルを使う。再現性が必要な利用者にはモデルバージョン固定をREADMEで案内し、requested/resolved両方を結果に残す。
- プロジェクト名から機能やポリシーを切り替えない。

schemas/jev-kit.config.schema.jsonはnpm packに含める。型、既定値、実行時の挙動と一致することを例とテストで確認する。

## 5. CLI仕様

| コマンド | 動作 | 通信 |
|---|---|---|
| jev-kit init [--config PATH] | 設定を新規生成。既存なら失敗。AGENTS.md等は触らない | なし |
| jev-kit config validate [--config PATH] | 設定の読込・検証 | なし |
| jev-kit doctor [--config PATH] | Node、設定、キーの有無を診断。キー値は出さない | なし |
| jev-kit evaluate --input FILE [--config PATH] | JSONを検証してJevへ送信 | あり |
| jev-kit evaluate --input - [--config PATH] | stdinからJSONを読み送信 | あり |
| jev-kit evaluate --input FILE --dry-run | JSONと設定を検証。認証不要、回答を生成しない | なし |
| jev-kit --help / --version | 利用法・版を表示 | なし |

- --config省略時はcwd/jev-kit.config.jsonのみ。親ディレクトリの自動探索や設定マージは行わない。
- --inputの相対パスはcwd基準。ログpathは設定ファイル基準。READMEに差を明記。
- evaluateの--inputは必須。指定のない状態でstdin待ちしない。
- ファイル・stdinともバイト上限を読込中に適用し、超過時は送信しない。
- ランタイムでもシリアライズ後の全HTTP要求サイズをmaxInputBytesで検証する。byte上限はtoken上限の保証ではない。
- initは排他的作成で競合時も上書きしない。--forceは実装しない。
- --dry-runはstatus: validated、questionCount、requestBytes、requestedModelのみを返す。answersやresolvedModelは返さない。
- CLIのJSON出力はstdoutに1文書のみ。通知はstderr。失敗もJSONで返す。
- 不明な引数・サブコマンドはUSAGE_ERROR。無視しない。

終了コード：0=成功、2=引数/設定/入力、3=認証欠落/拒否、4=通信/タイムアウト/サービス失敗、5=応答契約不一致、6=ローカルI/Oまたは内部障害、130=明示的キャンセル。

doctorのキー未設定はok:false、exit 3。診断結果にonlineChecked:falseを明示する。キーが存在しても有効性・アクセス権・モデル存在を確認したと報告しない。

## 6. HTTP・失敗時の動作

- AbortSignalで通信、応答本文読込、待機を中断可能にする。応答読込までtimeoutに含める。
- 総期限は初回通信から再試行待機・本文読込まで全体に適用。
- 応答本文は1MiBを初版上限として読込中に制限する。
- redirect: error。認証情報を転送先へ渡さない。
- 再試行対象はHTTP 429 / 529 / 502 / 503 / 504のみ。
- 認証拒否、入力拒否、不正JSON、契約不一致、キャンセル、ネットワーク例外、タイムアウトは初版では再試行しない。
- maxRetries既定0。明示設定で有効化した場合は最大2回、全attemptsは最大3。
- 待機は指数バックオフ＋jitter。Retry-Afterの秒数/HTTP日付を尊重し、総期限を超えるなら早期再試行せず期限超過を返す。
- 再送で追加課金が起きうることをREADMEに記載。架空のidempotency機構を追加しない。
- 401/403はAUTH_REJECTED、422はPROVIDER_INPUT_REJECTED、その他HTTP失敗はPROVIDER_HTTP_ERRORに分類。安全なstatus数値は含めてよい。
- 想定外例外はINTERNAL_ERROR。成功へ変換しない。

## 7. ログと計測

既定ではファイルログなし。telemetry.enabled=true時だけ1評価につき1行のJSONLを書き込む。

許可する記録：日時、キット版、projectId、requested/resolved model、成否、エラーコード、質問件数、所要時間、attempts、providerが返したusage。

記録しないもの：state、instructions、criteria、回答マップ、入力パス、APIキー、環境変数一覧、生HTTP本文、プロンプト全文。モデル名等の自由文字列が安全とは限らないため、既知の認証値が混入した場合にも出力しない防御を行う。

課金額の定数を埋め込まない。複数attempts時のusageは最終応答分であり、総請求額ではないことを明記。ログ書込失敗は評価を再実行せず、結果meta.warningsへTELEMETRY_WRITE_FAILEDを付ける。

初版は低頻度のCLI利用を対象とする。並列プロセスでのログ完全性を保証するDB等は導入しない。ログは判断や承認の台帳として使わない。

## 8. パッケージ・移植性

- package.jsonにtype:module、bin、exports、types、engines、filesを正しく定義。
- npm run buildでdistと型宣言を生成。CLIにshebangを付ける。
- npm run checkでtypecheck / tests / build / pack検証を実行できるようにする。
- packageのimportからCLIが起動しないこと、同梱schemaをcwdに依存せず読めることを確認。
- tarballにdist、schema、必要なREADME・例を含め、.env、ログ、秘密情報、作業用データは含めない。
- テストでは新規一時ディレクトリ2個へ同じtarballを導入し、異なるprojectIdの設定が干渉しないことを確認する。これはBOS実機連携の代用ではない。
- Windows/WSLを想定し、shell文字列連結に依存しない。パスに空白がある場所でCLIを確認。
- GitHubを使用できる場合、Node 24のLinux/Windows CIを用意。未実行OSを対応確認済みとしない。
- install/postinstallでネットワーク通信やスキル配置を行わない。

## 9. 必須検証と受入条件

| ID | 検証・合格条件 |
|---|---|
| A01 | 設定生成、未知項目拒否、版不一致拒否、既存設定非上書き、既定値適用が確認できる |
| A02 | 3種の入力、混在要求、上下限、空候補、誤型、危険なマップキーを検証する |
| A03 | 3種の正常応答、ID欠落・追加、type不一致、分布不整合、不正数値を検証する |
| A04 | 認証欠落・不正入力・dry-run・doctorでネットワーク呼出回数が0 |
| A05 | timeout、キャンセル、再試行上限、Retry-After、総期限を偽時計/注入transportで検証 |
| A06 | 不正応答・API失敗でok:trueや代替の肯定回答を返さない |
| A07 | stdoutがJSON1件、終了コードが仕様通り、stderr/ログに秘密値・入力本文が出ない |
| A08 | ログ無効時は無書込。有効時は許可項目のみ。書込失敗で二重API呼出しをしない |
| A09 | npm packの実tarballを別プロジェクトへ導入し、公開import・CLI・schemaが動く |
| A10 | 2利用プロジェクトの設定が干渉せず、BOS等への依存文字列・絶対パスがない |
| A11 | READMEのコマンド例が動き、標準テストがAPIキーなし・外部通信なしで通る |
| A12 | live検証は別コマンド。未実行ならNOT_RUNと記録し、モック成功と区別する |

最低限必要な失敗経路を検証し、カバレッジの数字だけを目的にテストを増やさない。stubで結果を固定したまま「実装完了」にしない。

live smokeは、明示的にその用途へ提供されたAPIキーがある場合のみ、合成テキストと3種の質問を1要求にまとめて実施する。再試行0。業務データは使わない。キーがなければ基盤実装・オフライン検証を最後まで進め、live未確認と報告する。

## 10. 実装手順・コミット

1. 作業場所、AGENTS.md、Git状態、Node/npm、GitHub接続を確認する。キー値を表示しない。
2. 専用ディレクトリに独立リポジトリを用意。既存BOS配下にnested repoを作らない。
3. 公式仕様を確認し、docs/api-contract.mdとADRを記録する。
4. package・型・schema・設定・検証処理を作る。
5. HTTPランタイムと失敗経路を実装・検証する。
6. CLIとREADME、合成例を実装する。
7. tarball導入検証、CI、受入条件を確認する。
8. 意味のある単位でcommitし、利用可能な適切なremoteへpush、同期を確認する。

推奨コミット単位は scaffold/contracts → runtime → CLI/package/docs/tests。各コミットに必要なテストを含め、最後にテストをまとめて帳尻合わせしない。

専用remoteがある場合は所有者・用途・公開範囲を確認して使う。新設が必要なら、認証済みの本人所有と確認できる個人アカウントにprivateのjev-agent-kitを作成する。組織を推測して選ばない。名前が競合する既存repoを上書き・流用しない。対象所有者が不明、認証不可などの場合はローカル実装とcommitを完了してから、その具体的な不足だけを報告する。

push前に秘密情報・不要成果物・差分を確認する。force push、履歴書換え、既存作業のreset/clean、無断公開、npm publish、Release/tag作成は今回行わない。remote pushの失敗を成功と報告しない。

## 11. 実装者への貼り付け用指示

以下の指示と本書全体を実装者へ渡す。

> あなたはGPT-6 Sol、reasoning effort highで、jev-agent-kitのPhase 1を実装する担当者です。モデル・推論設定は実行環境側で指定されたものを使い、自分で変更済みと主張しないでください。
>
> 本書の到達点は、独立リポジトリの共通ランタイム・CLI・設定スキーマを完成し、実tarballを別プロジェクトへ導入できることを示すことです。調査・計画だけで終了せず、実装、必要な検証、ドキュメント、commit、可能なremote同期まで進めてください。
>
> 最初に作業場所と既存指示を確認し、既存変更を保護してください。BOS・bos-homeは今回編集しません。本書の範囲を超えて5スキル、モデル切替、承認ゲート、MCPやUIを作らないでください。将来拡張はdocs/roadmap.mdに残してください。
>
> 公式TypeSafe APIを再確認して仕様を実装してください。仮のSDK・endpoint・回答項目を発明しないでください。設定はJSON、基盤は単一のTypeScript ESMパッケージ、CLI名はjev-kitとします。公開契約と同梱schemaの整合性を保ってください。
>
> 通常の設計判断は本書に沿って自律的に解決してください。APIキーやネット接続がなくても、依存関係を用意できる範囲で実装とオフライン検証を進め、live未確認を明示してください。API依存の未確認をモック成功で置き換えて報告しないでください。
>
> 失敗時に成功・許可・合格を捏造しないでください。使用したキーやユーザーデータをソース、ログ、テストfixture、報告に含めないでください。固定費用や性能改善の数値を根拠なく書かないでください。
>
> 受入条件A01〜A12を実行証拠へ対応付け、npm packした実物を別ディレクトリから使ってください。実APIだけでなく、認証欠落、壊れた応答、キャンセル、再試行、JSON出力、Windowsパスを意識した確認を行ってください。
>
> 変更は意味のある単位でcommitし、専用remoteへ同期してください。新規remoteの作成条件・公開範囲は本書に従ってください。接続先を確定できなければローカル成果を完成させたうえで、同期に必要な情報だけを報告してください。mainの保護や既存レビュー規則を回避しないでください。
>
> 最終報告は次の形式にしてください。実行していない検証はNOT_RUN、失敗はFAILとし、理由を併記してください。
>
> 1. Outcome：IMPLEMENTED / PARTIAL / BLOCKEDと理由
> 2. Repository：作業パス、remote、branch、開始/終了SHA、Git状態、push同期状態
> 3. Implemented：共通ランタイム・設定・CLI・配布に分けた変更内容
> 4. Usage：init、validate、doctor、dry-run、evaluateの実行例
> 5. Verification：A01〜A12、実行コマンド、結果、証拠へのパス。合成・mock・liveを区別
> 6. Package：生成tarball、導入先テスト、同梱内容の検証結果
> 7. Limitations：実API・OS・認証など未確認事項
> 8. Next：Phase 2で着手する2役割と必要な接続点。今回実装したと主張しない

## 12. 設計上の注意

最大活用は呼出回数の最大化ではない。Phase 1では小さい入力・失敗を隠さない契約・計測を整え、Phase 2以降で品質と全体費用を比較する。

本書のtimeout、サイズ上限、再試行既定、CLI名、ファイル構成、検証許容誤差はプロジェクト独自の設計であり、Jev公式仕様と混同しない。

## 13. 参照資料

確認日：2026-09-23。実装時に再確認する。

- [S1] TypeSafe API reference: https://docs.typesafe.ai/api
- [S2] TypeSafe Confidence: https://docs.typesafe.ai/confidence
- [S3] TypeSafe Score: https://docs.typesafe.ai/primitives/score
- [S4] TypeSafe Introduction: https://docs.typesafe.ai/introduction
- [S5] TypeSafe Agent skill（Phase 2以降の参考）: https://docs.typesafe.ai/agent-skill

公式仕様に関する説明と、このパッケージ独自の設計判断を区別して利用すること。
