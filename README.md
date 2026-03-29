# vc-bot

Discordの一時VCボットです。`/duo` `/trio` `/quad` で一時VCを作成し、空室が60秒続くと自動削除します。

## セットアップ

1. 依存関係をインストール

```bash
bun install
```

2. 環境変数を作成

```bash
cp .env.example .env
```

3. `.env` を編集

- `BOT_TOKEN`: Botトークン
- `CLIENT_ID`: Application ID
- `VOICE_CATEGORY_ID`: 初期カテゴリID（任意。未設定なら `/setup` で設定）
- `AUTO_DELETE_DELAY_MS`: 空室後の削除待機時間（既定60000）
- `CHANNEL_PREFIX`: 一時VC名の接頭辞（既定tempvc）

4. ボットに必要な権限

- View Channels
- Connect
- Speak
- Move Members
- Manage Channels
- Use Slash Commands

5. 起動

```bash
bun run dev
```

## 動作

- `/setup category:<カテゴリ>`: このサーバーの一時VC作成先カテゴリを設定（Manage Server権限が必要）
- `/duo name:<名前> access:<全員|限定> allow_user:<ユーザー> allow_role:<ロール> target1..target5:<ユーザーまたはロール>`: 上限2人の一時VCを作成
- `/trio name:<名前> access:<全員|限定> allow_user:<ユーザー> allow_role:<ロール> target1..target5:<ユーザーまたはロール>`: 上限3人の一時VCを作成
- `/quad name:<名前> access:<全員|限定> allow_user:<ユーザー> allow_role:<ロール> target1..target5:<ユーザーまたはロール>`: 上限4人の一時VCを作成
- `/allow allow_user:<ユーザー> allow_role:<ロール> target1..target5:<ユーザーまたはロール>`: 自分の一時VCに複数対象を許可
- `/deny allow_user:<ユーザー> allow_role:<ロール> target1..target5:<ユーザーまたはロール>`: 自分の一時VCに複数対象を拒否

`access` は任意で、未指定時は `全員(public)` になります。`access` が `限定` の場合は、`allow_user` または `allow_role` のどちらか1つ以上が必須です。

作成されたVCは `access` で指定した範囲のみ閲覧・接続可能です。コマンド応答はephemeralで実行者にのみ表示されます。
一時VCの追跡情報は保存されるため、Bot再起動後も空室検知による自動削除が継続されます。

## 型チェック

```bash
bun run typecheck
```

## ビルド

```bash
bun run build
```

## Koyebデプロイ

1. このリポジトリをGitHubへpush
2. Koyebで `Create App` -> `GitHub` を選択
3. このリポジトリを選択
4. Service Type は `Worker` を選択
5. Build Method は `Dockerfile` を選択（リポジトリ直下の `Dockerfile` を使用）
6. Environment Variables を設定

- `BOT_TOKEN`
- `CLIENT_ID`
- `VOICE_CATEGORY_ID`（任意）
- `AUTO_DELETE_DELAY_MS`（例: `60000`）
- `CHANNEL_PREFIX`（例: `tempvc`）

7. Deploy を実行

注意:

- このBotはHTTPサーバーを立てないため、Koyebでは `Worker` として動かす。
- `data/` 配下の保存データは再デプロイや再配置で失われる可能性がある。
- 永続性が必要なら `VOICE_CATEGORY_ID` を環境変数で固定し、`/setup` 依存を減らす運用がおすすめ。
