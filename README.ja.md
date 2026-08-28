# Pi Desktop

[English](./README.md) | [简体中文](./README.zh-CN.md) | [Русский](./README.ru.md)

[pi コーディングエージェント](https://github.com/earendil-works/pi) のローカルブラウザー UI です。Pi Desktop は pi と同じローカル設定とセッションファイルを使用し、ブラウザーから会話の検索と再開、エージェントの実行、モデルやリソースの設定、プロジェクトファイルの確認を行えます。

![構造化された Markdown、ツール呼び出し、プロジェクトナビゲーションとともに pi セッションを表示する Pi Desktop](https://raw.githubusercontent.com/mafousoftware/pi-desktop/main/docs/screenshot.png)

## 機能

- **セッションワークスペース**：プロジェクトごとに会話を閲覧、再開、名前変更、エクスポート、削除し、実行状態、コンテキスト使用量、コスト、コンパクション情報を確認できます。
- **2 種類の分岐**：**New session** は以前のメッセージから独立したセッションファイルを作成し、**Edit from here** は現在のセッション内にブランチを作成します。
- **プロジェクトファイルツール**：ファイルの閲覧とアップロード、Git Diff の確認、ソース、Markdown、画像、音声、PDF、DOCX のプレビューに対応し、変更時は自動更新されます。
- **Git worktree**：同じリポジトリのセッションをまとめたまま、サイドバーからチェックアウトを切り替えられます。
- **Web での設定**：Pi Desktop を離れずに、Provider のログインと API Key、モデル、モデルテスト、プラグインパッケージ、スキルを管理できます。
- **英語と簡体字中国語の UI**：初回はブラウザーの言語に従い、トップバーから言語を切り替えられます。

## クイックスタート

推奨される方法は、[GitHub Releases ページ](https://github.com/coder-nil/pi-desktop/releases)から最新のデスクトップアプリをダウンロードすることです。お使いのプラットフォームのパッケージを選んで起動してください。Node.js と npm は必要ありません。

ソースからビルドする場合は、Node.js 22.19.0 以降、Rust、Tauri CLI 2.8.4 を用意します：

```bash
git clone https://github.com/coder-nil/pi-desktop.git
cd pi-desktop
npm ci
cargo install tauri-cli --version 2.8.4 --locked
```

対応するプラットフォームで次のコマンドを実行します：

```bash
npm run desktop:build:mac       # 現在の Mac アーキテクチャ向けアプリ
npm run desktop:build:windows  # Windows インストーラー
npm run desktop:build:linux    # Linux パッケージ
```

GitHub Releases では、Apple Silicon（`arm64`）版と Intel（`x64`）版の macOS パッケージを個別に提供します。対応する Mac では、`npm run desktop:build:mac:arm64` または `npm run desktop:build:mac:x64` で対象を明示できます。明示的な target の生成物は `src-tauri/target/<target>/release/bundle/`、現在のホスト target の生成物は `src-tauri/target/release/bundle/` にあります。モデル Provider が未設定の場合は、**Models** パネルを開いてログインするか API Key を追加してください。

GitHub Releases で配布する macOS パッケージは、証明書不要の ad-hoc 署名を使用します。これはアプリケーションバンドルの意図しない変更を検出できますが、Apple が信頼する開発者 ID を証明するものではなく、インターネットからのダウンロードを Gatekeeper に自動承認させることもできません。Pi Desktop を「アプリケーション」にドラッグした後、初回起動前にダウンロード隔離属性を明示的に削除してください：

```bash
xattr -dr com.apple.quarantine "/Applications/Pi Desktop.app"
```

このコマンドは、本プロジェクトの公式 GitHub Releases ページからダウンロードしたパッケージに対してのみ実行してください。警告なしでダブルクリックインストールを行うには、有料の Apple Developer ID と公証が必要です。

各 macOS リリースには対応する `SHA256SUMS-macos-*.txt` も含まれます。DMG と同じディレクトリにダウンロードし、隔離属性を削除する前に `shasum -a 256 -c SHA256SUMS-macos-arm64.txt`（Intel 版では `macos-x64` ファイル）を実行してパッケージを検証してください。

## 設定

ポートとホスト名では、コマンドラインオプションが対応する環境変数より優先されます。`--no-open` と `PI_WEB_NO_OPEN=1` は、どちらを指定してもブラウザーの自動起動が無効になります。

| オプションまたは環境変数 | 用途 | デフォルト |
| --- | --- | --- |
| `--port <port>`、`-p <port>`、または `PORT` | サーバーポート | `30141` |
| `--hostname <host>`、`-H <host>`、または `PI_WEB_HOSTNAME` | バインドするホスト名 | `127.0.0.1` |
| `--no-open` または `PI_WEB_NO_OPEN=1` | ブラウザーを自動的に開かない | 自動的に開く |
| `PI_WEB_ALLOWED_HOSTS` | 追加で許可するプロキシまたはカスタムホスト名。複数指定はカンマ区切りで完全一致 | 未設定 |
| `PI_WEB_PASSWORD` | HTTP Basic Auth を有効化。ユーザー名は常に `pi` | 認証なし |

例：

```bash
pi-desktop -p 8080 --no-open
```

### リモートアクセス

ループバック以外のアドレスにバインドすると、高い権限の操作を実行できるエージェントがネットワークに公開されます。`PI_WEB_PASSWORD` が設定されていない場合、Pi Desktop はループバック以外からのリクエストを拒否します。信頼できる LAN で使用する場合も、十分に長いランダムなパスワードを設定してください：

```bash
PI_WEB_PASSWORD='十分に長いランダムなパスワード' pi-desktop --hostname 0.0.0.0
```

Basic Auth は転送中のパスワードを暗号化しません。平文 HTTP で Pi Desktop をインターネットに公開せず、信頼できるリバースプロキシによる HTTPS または信頼できる VPN を使用してください。リバースプロキシが外部ホスト名を転送する場合は、その名前を完全一致で `PI_WEB_ALLOWED_HOSTS` に追加します。リモートアクセスには引き続きパスワードが必要で、この許可リストは Pi Desktop のバインド先を変更しません。

### HTTP プロキシ

サーバー側のモデルリクエストと API リクエストは、標準の `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 環境変数を使用します。

macOS または Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npm run dev
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npm run dev
```

## 注意事項

- **エージェントデータ**：Pi Desktop はデフォルトで `~/.pi/agent` の pi データを読み込みます。セッションファイルは `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl` にあります。別の pi エージェントディレクトリを使用するには `PI_CODING_AGENT_DIR` を設定してください。
- **ファイルシステムへのアクセス**：Pi Desktop はエージェントデータディレクトリと、セッションに記録された作業ディレクトリを読み取れる必要があります。既存の pi セッションを共有する場合は、pi と同じファイルシステム環境で Pi Desktop を実行してください。
- **共有設定**：Models パネルは pi のモデル、設定、認証情報ストレージを使用するため、変更は両方のインターフェースに反映されます。
- **ファイルアクセスの範囲**：ファイルブラウザーは、Pi Desktop で選択した作業ディレクトリと、既知のプロジェクトまたはセッションルートに限定されます。汎用のファイルシステムブラウザーではありません。
- **Git worktree**：スイッチャーの表示条件、worktree の作成、削除時の動作については [Worktrees in Pi Desktop](./docs/worktrees.md) を参照してください。

## 開発

```bash
npm install
npm run dev
```

開発サーバーは [http://127.0.0.1:30141](http://127.0.0.1:30141) で動作します。一般的なチェックは次のコマンドで実行します：

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

通常の開発中は `next build` または `npm run build` を実行しないでください。`.next/` に書き込まれ、開発サーバーに影響する可能性があります。ビルドはリリース作業時にのみ実行してください。

コントリビューター向けガイド：[Internationalization](./docs/i18n.md) と [Release process](./docs/release.md)。

## リポジトリ構成

```text
app/             Next.js UI と API ルート
components/      React UI コンポーネント
hooks/           クライアントの状態と操作に関する hooks
lib/             セッション、エージェント、モデル、ファイル、Git、セキュリティのロジック
public/          静的アセットと PWA ファイル
bin/             npm CLI エントリポイントと起動オプションの解析
docs/            ユーザーおよびコントリビューター向けの個別ガイド
```

アーキテクチャの説明と詳細なファイルマップについては [AGENTS.md](./AGENTS.md) を参照してください。

## ライセンス

[MIT](./LICENSE)
