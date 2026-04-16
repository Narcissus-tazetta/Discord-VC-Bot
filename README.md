# vc-bot

Discordの一時VC作成ボットです。

## できること

- `/duo` `/trio` `/quad`: 人数プリセットで一時VC作成
- `/create`: 名前・人数を指定して一時VC作成
- `/allow` `/deny`: 自分の一時VCの参加権限を更新
- `/setup`: 一時VCを作るカテゴリをサーバーごとに設定

## 必要なもの

- Bun
- PostgreSQL（`DATABASE_URL`）
- Discord Bot Token / Client ID

## 使い方

1. 依存関係をインストール
    ```bash
    bun install
    ```
2. 環境変数を設定
    ```bash
    cp .env.example .env
    ```
3. 起動（開発）
    ```bash
    bun run dev
    ```

## 環境変数

- `BOT_TOKEN`
- `CLIENT_ID`
- `DATABASE_URL`
- `VOICE_CATEGORY_ID`（任意）
- `AUTO_DELETE_DELAY_MS`（既定: `60000`）
- `CHANNEL_PREFIX`（既定: `tempvc`）
