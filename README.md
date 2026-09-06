# Hanabi Album-Sync

Slack `#02_課外_frc_ベストショットコンペ` の Snaps / Shorts / Films 投稿を、Google Driveへ原本保存し、Web Album・審査・過去Migrationまで一つにまとめるアプリです。

## Implemented MVP

- Slack Events APIでスレッド返信を検知し、署名検証後にSync Jobを作成
- Snaps / Shorts / Films の親投稿を自動判定
- 1返信に複数添付されたSlack Fileを1 Assetずつ保存
- Google Driveに `YEAR / ISO-WEEK / CATEGORY` を自動作成し、resumable uploadで原本保存
- Slack File IDによる冪等取り込み
- Supabase PostgreSQLのデータモデル / RLS
- Supabase Google OAuthログイン + Viewer / Judge / Admin権限
- Web Album（画像・動画プレビュー、Slack/Drive導線、Winner表示）
- Judge Shortlist
- Admin Winner確定 → Slackへ受賞者mention + 作品本体を自動投稿
- 受賞Slack投稿失敗時のFAILED保持 / Retry / 二重投稿防止
- 過去Slackチャンネル履歴のMigrationキック + QStashによるページ継続
- Admin画面でMigration / Sync Job / Winner通知状態を確認

## 1. Supabase

Supabase projectを作成し、SQL EditorまたはCLIで `supabase/migrations/0001_init.sql` を適用してください。Auth > ProvidersでGoogleを有効化し、callback URLに以下を追加します。

```
https://YOUR_DOMAIN/auth/callback
http://localhost:3000/auth/callback
```

## 2. Google Drive

Google Cloudでservice accountを作成し、Drive APIを有効化します。Album-Syncのroot folder `1IjbvFgbkLge5FcfR31p11Njbp-_xr8Fh` をservice accountのemailへ編集権限で共有してください。service-account JSONは1行JSONとして `GOOGLE_SERVICE_ACCOUNT_JSON` に入れます。

## 3. Slack App

Bot scopesの目安:

```
channels:history
files:read
files:write
users:read
users:read.email
chat:write
```

チャンネル種別によっては `groups:history` も必要です。Botを `C093FCBUZC7` に参加させます。

Events Request URL:

```
https://YOUR_DOMAIN/api/slack/events
```

message eventを購読してください。Signing SecretとBot Tokenは環境変数へ保存します。

## 4. Async queue

Vercel運用ではQStashを設定してください。Slack webhookは即Job化し、Drive転送を別requestで処理します。`QSTASH_TOKEN`, `PUBLIC_BASE_URL`, `INTERNAL_JOB_SECRET` を設定します。

QStash未設定時、新規SlackイベントはDBにQUEUEDとして残ります。Winner確定だけは同期fallbackでSlack通知まで実行します。MigrationはQStash必須です。

## 5. Environment

`.env.example` を `.env.local` へコピーして埋めます。`ADMIN_EMAILS` と `JUDGE_EMAILS` はカンマ区切りです。

## 6. Run

```bash
npm install
npm run dev
```

## Notes for the next refactor

現版は「仕様v0.2を端から端まで通す」ことを優先した実装です。大容量動画はSlack→Node memory→Driveとなるため、次の改善では一時object storage / streaming uploadへ分離してください。またMigration workerの並列数・429 backoff・message_changed同期・監査ログは次の強化ポイントです。
