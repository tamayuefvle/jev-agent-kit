# jev-agent-kit Phase 1 実装計画

作成日: 2026-09-23

根拠: [Phase 1 設計・実装指示書](./jev-agent-kit-phase1-design-and-instructions-ja.md)

## 到達点と現在地

TypeScript strict・ESM・Node.js 24の単一パッケージとして、Jevの3種類の質問を評価する公開API、JSON設定、`jev-kit` CLIを実装する。実際に`npm pack`したtarballを独立した2つの一時プロジェクトへ導入し、API・CLI・同梱schemaが使えるところまでをPhase 1完了条件とする。5役割のスキル、BOS連携、判断品質の実証は今回の完了条件に含めない。

作業先はユーザー指定の[GitHubリポジトリ](https://github.com/tamayuefvle/jev-agent-kit)。2026-09-23の確認時点では公開・空リポジトリで、認証中のGitHubアカウントは所有者`tamayuefvle`と一致した。現ディレクトリには設計書と本計画だけがあり、ローカルGitリポジトリと実装はまだない。Node v24.15.0、npm v11.12.1、Git、GitHub CLIは利用可能。APIキーの有無は未確認であり、実装時も値を表示せず確認する。

2026-09-23に[TypeSafe API reference](https://docs.typesafe.ai/api)、[Score](https://docs.typesafe.ai/primitives/score)、[Confidence](https://docs.typesafe.ai/confidence)を確認した。`POST /v1/systemone`、Bearer認証、`state/model/questions`、回答の`model/answers/usage`、Noul・Choice・Scoreの基本形は設計書と一致する。公式APIが許す構造化`instructions`等よりも、初版の入力を文字列に狭めるのは本キットの判断である。実装時にも公式仕様を再確認し、差分を`docs/api-contract.md`へ記録する。

## 実装順序

| 段階 | 実装と確認 | 完了条件 |
|---|---|---|
| 0. 作業境界 | 親階層の指示と既存ファイルを確認。現ディレクトリで独立Gitリポジトリを初期化し、指定済みの空remoteを`origin`に設定する。`.gitignore`を用意し、既存ファイルを保持する。 | `origin`が`https://github.com/tamayuefvle/jev-agent-kit.git`を指し、公開先と作業範囲が確定する。 |
| 1. API契約と土台 | 公式仕様とキット独自の制限を`docs/api-contract.md`とADRに分離して記録。`package.json`、TypeScript、ESM、ビルド、公開exports、CLI bin、schema同梱、テスト基盤を作る。依存は互換性を調べて具体的な版をlockfileに固定する。 | `npm run build`でJSと型宣言が生成され、package importでCLIが起動しない。 |
| 2. 設定と入力 | Draft-07 schema、Ajv、既定値適用、`loadConfig`/`validateConfig`、3種類の質問の実行時検証を実装。未知の制御項目、危険なキー、不正JSON値、サイズ超過を拒否する。 | A01、A02が通り、生成設定・型・schema・実際の既定値が一致する。 |
| 3. 評価ランタイム | 固定HTTPS endpointへのfetch、認証、要求サイズ制限、応答の読込制限と契約検証、結果・エラーunionを実装。内部factoryでtransport・時計・待機を注入する。 | 正常な3種と混在要求が処理され、壊れた応答やAPI失敗を成功扱いしない。A03、A06を満たす。 |
| 4. 期限と再試行 | AbortSignal、要求・総期限、応答読込中の中断、指定statusだけの最大2回再試行、指数バックオフ・jitter・Retry-Afterを実装。 | 偽時計と注入transportでA05を通し、通信しない経路は呼出回数0を確認する。 |
| 5. CLIとログ | `init`、`config validate`、`doctor`、`evaluate`、dry-run、help/versionを実装。JSON1文書のstdout、終了コード、stderrの秘匿、任意のメタデータJSONLログを実装する。 | A04、A07、A08を通す。ログ失敗は警告となり、APIを再送しない。 |
| 6. 配布と引渡し | README、合成例、CHANGELOG、`docs/design.md`、`docs/roadmap.md`、CIを整備。実tarballを空白入りパスを含む2つの一時プロジェクトへ導入する。`npm run check`と公開前の秘密情報・同梱物検査を実行し、意味単位でcommitする。指定remoteへpushして同期を確認する。 | A09〜A12とA01〜A08の証拠がそろい、Git状態と同期状態を報告できる。 |

コミットは「土台と契約」「設定・入力と検証」「HTTPランタイムと検証」「CLI・配布・文書と検証」の意味単位を目安にする。必要なテストは各実装と一緒に入れる。

## 実装時に先に固定する細部

1. **公開型とエラー表**: `ConfigResult`、`EvaluationResult`、各`code`、終了コードの対応を先に定義する。`evaluate`には検証済み設定だけを渡せる型を用意し、公開境界では実行時の不正値も安全に拒否する。失敗結果に`answers`を含めない。
2. **設定のパス検証**: `validateConfig(value)`は構造と相対パスの字句検証を行う。実ファイルに対するシンボリックリンクの逸脱検査は、設定ファイル所在ディレクトリを持つ`loadConfig(path)`とログ書込直前で行う。既定値適用後に相関制約（要求期限≤総期限）を検証する。
3. **入力のJSON境界**: CLIは読込中にバイト数を制限し、ランタイムはシリアライズ後のHTTP要求全体を再計測する。公開APIに渡る循環参照、非有限数、関数等も入力エラーとして扱う。`state`の内容は評価対象データとして保持し、質問などの制御構造だけを厳格に検証する。
4. **応答検証**: 質問ID集合とtype、Choice候補、Score水準、分布・confidence・usageを検証してから返す。和とScore加重平均の許容誤差`1e-3`はキット独自の条件としてテストする。実APIの丸めと合わなければ、根拠を記録してから条件を見直す。
5. **通信と秘匿**: `redirect: 'error'`、本文1MiB上限、総期限に再試行待機を含める。401/403、422、再試行可能status、通信例外、キャンセル、期限切れ、契約違反を区別する。APIキー、入力、応答の生本文を結果・ログ・テスト失敗表示へ流さない。
6. **副作用の境界**: `init`は排他的に新規作成する。dry-runとdoctorは認証通信を行わない。telemetryは既定で無効にし、有効時にも許可項目だけを記録する。ログの失敗は評価結果の`meta.warnings`へ記録する。

## 検証と証拠

| 証拠単位 | 対応する受入条件 | 実行方法 |
|---|---|---|
| 設定・入力の契約テスト | A01、A02、A04 | schema、既定値、未知項目、危険なキー、各上下限、通信0回を確認。 |
| 応答・失敗経路の契約テスト | A03、A05、A06 | 合成応答と注入transport・偽時計で3種の正常系、壊れた応答、timeout、キャンセル、再試行を確認。 |
| CLI・ログの統合テスト | A07、A08 | 子プロセスでstdoutのJSON件数、終了コード、stderr・ログの秘匿、ログ書込失敗後のAPI呼出回数を確認。 |
| tarball導入テスト | A09、A10、A11 | `npm pack`の実物を別の2ディレクトリに導入。異なるprojectId、公開import、CLI、schema、README例、同梱物を確認。 |
| live smoke記録 | A12 | 専用APIキーが明示提供された場合だけ、合成データと3種の質問を1要求、再試行0で実行。提供されなければ`NOT_RUN`。 |

`npm run check`はtypecheck・テスト・build・pack検証をまとめる。標準テストはAPIキー不要で外部通信しない。Linux/Windows CIをGitHub利用可能時に設定し、未実行OSは未確認として報告する。最後にA01〜A12をPASS/FAIL/NOT_RUNと証拠パスへ対応付ける。

## 引渡し条件

最終報告には、成果状態、作業パス・branch・開始/終了SHA・指定remoteとの同期状態、公開APIとCLIの使い方、A01〜A12の証拠、tarballの導入結果、live/APIキー/OSの未確認事項を載せる。同期時に認証や接続が失敗してもローカル実装・検証・commitを保持し、失敗を明示する。将来の5役割は`docs/roadmap.md`へ記録し、Phase 2で着手する2役割の候補と必要な接続点を最終報告に示す。今回使える機能として表示しない。
