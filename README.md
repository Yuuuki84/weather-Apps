# Luna & Elma — 天気 & ニュース (PWA 対応)

シンプルで美しい天気 + ニュース Web App です。
都市名または現在地から最新の天気情報を取得し、カテゴリ別ニュースと AI アシスタントを提供します。

**公開 URL:** https://yuuuki84.github.io/weather-Apps/

---

## 機能一覧

### 天気

| 機能 | 内容 |
|------|------|
| 都市検索 | 日本語・英語対応、オートコンプリート付き |
| 現在地取得 | GPS ボタンで自動取得 |
| 検索履歴 | 最大 8 件・ローカル保存 |
| お気に入り都市 | 最大 10 件・クラウド同期 |
| URL 共有 | `?city=都市名` パラメータ対応 |
| 大阪エリア対応 | 梅田・なんばなど主要エリアを大阪市として認識 |

**表示データ**

| 項目 | 内容 |
|------|------|
| 気温 | 現在・体感・最低 / 最高 |
| 天気 | アイコン + 日本語説明 |
| 湿度・気圧・視程・雲量 | 各数値 |
| 風速・風向 | m/s + 16 方位 |
| 雨量・雪量 | mm/h |
| 日の出・日の入 | 現地時刻 |
| 週間予報 | 気象庁（JMA）API 連携 |
| 波情報 | Open-Meteo 連携（波高・周期） |
| 大気質 | AQI 表示 |
| 雨雲レーダー | RainViewer / Windy マップ |

**天気アドバイス（ルールベース自動生成）**

| アドバイス | 内容 |
|-----------|------|
| お出かけ | 外出適性・傘の必要性 |
| 洗濯 | 外干し / 室内干し判定 |
| 花粉・大気 | 季節と天気から飛散リスク推定 |
| 服装 | 気温別おすすめコーデ |
| UV・日焼け | 日差しの強さと対策 |
| 体調・健康 | 熱中症・凍結などのリスク |

---

### ニュース

- **ソース**: Yahoo Japan RSS（1次）→ Google News RSS（自動フォールバック）
- **15 カテゴリタブ**（横スクロール対応）

| カテゴリ | カテゴリ | カテゴリ |
|---------|---------|---------|
| トップ | 国内 | 国際 |
| 政治 | 経済 | テクノロジー |
| サイエンス | スポーツ | エンタメ |
| 健康 | ビジネス | グルメ |
| 旅行 | 地域 | 災害 |

**ニュース機能詳細**

| 機能 | 内容 |
|------|------|
| ブックマーク | 最大 50 件・クラウド同期 |
| 既読管理 | 最大 300 件・クラウド同期、未読のみ表示フィルター |
| バッジカウント | タブごとに未読件数を表示 |
| AI 要約 | Cloudflare Workers AI による記事要約（7日キャッシュ） |
| スワイプ操作 | 左スワイプ → 既読、右スワイプ → ブックマーク |
| 遅延ロード | IntersectionObserver で 6 件ずつ追加 |
| オフラインキャッシュ | localStorage に保存し圏外でも閲覧可能 |
| 15 分キャッシュ | 過剰なリクエストを抑制 |

---

### AI チャット（Luna & Elma）

- **モデル**: `@cf/meta/llama-3.1-8b-instruct`（Cloudflare Workers AI）
- 現在の天気データをコンテキストとして渡し、天気に関連した自然な日本語で応答
- 会話履歴を直近 10 件保持
- チャット履歴のローカル保存（最大 20 件）

---

### UI・演出

**テーマ・カスタマイズ（UIカスタマイズモーダル）**

| 機能 | 内容 |
|------|------|
| ライト / ダークモード | 手動切替（OS 設定に自動対応） |
| アクセントカラー | 6 プリセット + フルカラー hue スライダー |
| 角丸スタイル | シャープ / デフォルト / ラウンドの 3 段階 |
| フォントサイズ | 小 / 中 / 大の 3 段階 |
| 背景テーマ | 9 種類（下記参照） |

**背景テーマ一覧**

| テーマ | イメージカラー |
|--------|--------------|
| Cosmic（デフォルト） | 深宇宙・インディゴ |
| Midnight | 深夜・コールドネイビー |
| Aurora | オーロラ・グリーン / パープル |
| Sunset | 夕焼け・アンバー / ローズ |
| Ocean | 深海・シアン / ティール |
| Cherry（桜） | 桜ピンク |
| Forest（森） | 深緑 |
| Lavender（ラベンダー） | 薄紫 |
| Galaxy（銀河） | 宇宙・ディープパープル |

**動的背景・演出**

| 機能 | 内容 |
|------|------|
| 天気連動 Orb | 晴れ・曇り・雨・雪・雷で背景グラデーションが変化 |
| 季節パーティクル | 春（桜）/ 夏（ほたる）/ 秋（紅葉）/ 冬（雪）の Canvas アニメーション |
| 雨・雪エフェクト | 天気に応じた Canvas パーティクル |
| ボタンリプル | クリック時に波紋エフェクト |
| 検索バースト | 検索ボタンタップ時にスパークエフェクト |

**その他 UI 機能**

| 機能 | 内容 |
|------|------|
| スケルトンローディング | 天気・ニュースカード |
| プルリフレッシュ（PTR） | スマホ向けスワイプ更新 |
| 雨・雪バナー | 降水時に警告バナーを表示 |
| 気象庁警報バナー | 警報・注意報発令時に自動表示 |
| スクロールトップボタン | 400px 以上スクロールで表示 |
| オンボーディング | 初回起動時のチュートリアル |

---

### モバイル底部ナビゲーション

スマートフォン操作に最適化した固定底部タブバー（≤768px で表示）。

| タブ | 内容 |
|------|------|
| 🌤 天気 | 検索・お気に入り・天気情報 |
| 📰 ニュース | ニュース一覧 |
| 💬 AI | AI チャット |
| ⚙️ 設定 | 単位・フォントサイズ・カスタマイズ |

- iPhone ノッチ対応（`env(safe-area-inset-bottom)`）
- 最後に表示していたタブを localStorage に記憶

---

### PWA

| 機能 | 内容 |
|------|------|
| Service Worker | Stale-While-Revalidate（静的アセット）+ TTL キャッシュ（API） |
| インストール | ホーム画面追加プロンプト |
| オフライン対応 | キャッシュからフォールバック |
| Web Push 通知 | 天気アラート通知 |
| アプリショートカット | manifest に 3 種類登録済 |

**キャッシュ TTL**

| 対象 | TTL |
|------|-----|
| 天気 API | 10 分 |
| ニュース RSS | 15 分 |
| 静的アセット | Stale-While-Revalidate（即返却 + バックグラウンド更新） |

---

### 認証・クラウド同期（Supabase）

- Google OAuth / メール・パスワード認証
- ログアウト時にローカルデータを完全クリア（セキュリティ対応）
- Row Level Security（RLS）によりユーザーデータを厳密に分離

| 同期データ | 内容 |
|-----------|------|
| お気に入り都市 | 最大 10 件 |
| ニュースブックマーク | 最大 50 件 |
| 既読 URL | 最大 300 件 |
| テーマ・単位・UI 設定 | カラー・角丸・フォントサイズ含む |
| ニュースカテゴリ | 最後に見たタブ |
| 検索履歴 | 最大 8 件 |

---

### パフォーマンス・最適化

**モバイル発熱対策**

| 対策 | 内容 |
|------|------|
| Canvas FPS 削減 | 季節パーティクル 8fps・雨雪 12fps（デスクトップは高品質維持） |
| パーティクル数削減 | 季節パーティクル最大 5 個・雨 25 個・雪 10 個 |
| backdrop-filter 除去 | モバイルで完全除去（GPU 再合成の最大負荷源） |
| Canvas 自動停止 | タブ非表示時・バックグラウンド時に完全停止 |
| スクロール監視廃止 | `scroll` イベント → `IntersectionObserver` に置換 |
| リスナーリーク修正 | ニュースカードのスワイプを WeakMap + 委譲方式に変更 |

**レンダリング最適化**

| 対策 | 内容 |
|------|------|
| `contain: layout paint` | Orb アニメーションの再描画範囲を限定 |
| `will-change: transform` | GPU コンポジタ専用スレッドで処理 |
| `overscroll-behavior: contain` | 横スクロール時のページ誤操作を防止 |
| `scroll-snap` | 時間予報・ニュースタブの横スクロール精度向上 |
| `touch-action: manipulation` | タップ 300ms 遅延を完全除去 |
| 入力デバウンス（250ms） | オートコンプリートの DOM 多重更新を抑制 |
| ニュースリスナー重複防止 | 再描画ごとのリスナー蓄積を完全排除 |

---

## 使用技術・外部サービス

| 技術 / サービス | 用途 | 料金 |
|---------------|------|------|
| [OpenWeatherMap](https://openweathermap.org/) | 天気データ | 無料プラン（月 100 万件） |
| 気象庁（JMA）API | 週間予報・警報 | 無料・公式 |
| [Open-Meteo](https://open-meteo.com/) | 波情報 | 無料 |
| Yahoo Japan RSS | ニュース 1 次ソース | 無料 |
| Google News RSS | ニュース フォールバック | 無料 |
| [rss2json.com](https://rss2json.com/) | RSS → JSON 変換（CORS 対応） | 無料プラン |
| [Cloudflare Workers AI](https://ai.cloudflare.com/) | AI チャット・記事要約 | 無料プラン |
| [Supabase](https://supabase.com/) | 認証・クラウド同期 | 無料プラン（Northeast Asia / Tokyo リージョン） |
| [GitHub Pages](https://pages.github.com/) | ホスティング | 無料 |
| Vanilla JS / HTML / CSS | フロントエンド | — |
| [Chart.js](https://www.chartjs.org/) | 気温グラフ | 無料 |
| [Leaflet.js](https://leafletjs.com/) | 雨雲レーダーマップ | 無料 |

---

## ファイル構成

```
Weather-2-App/
├── index.html          # UI・全 CSS（デザイントークン・レスポンシブ対応）
├── app.js              # フロントエンドロジック（天気・ニュース・チャット・PWA）
├── config.js           # API キー・設定（公開リポジトリには含めない）
├── config.example.js   # config.js のテンプレート
├── supabase.js         # Supabase 認証・クラウド同期
├── sw.js               # Service Worker（TTL キャッシュ・Stale-While-Revalidate）
├── init-sw.js          # Service Worker 登録
├── manifest.json       # PWA マニフェスト
├── icon-192.svg        # PWA アイコン
├── privacy.html        # プライバシーポリシー
├── _headers            # Cloudflare Pages / GitHub Pages ヘッダー設定
└── chat-worker/        # Cloudflare Workers バックエンド
    ├── src/
    │   └── index.js    # /api/chat・/api/summarize エンドポイント
    └── wrangler.toml   # Workers 設定
```

---

## ローカル環境での起動

```bash
git clone https://github.com/Yuuuki84/Weather-2-App.git
cd Weather-2-App
cp config.example.js config.js
# config.js に各 API キーを設定
```

`index.html` をブラウザで開く（Live Server 推奨）。

---

## 必要な API キー

| キー | 取得先 |
|------|--------|
| `OPENWEATHER_API_KEY` | [openweathermap.org/api](https://openweathermap.org/api) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | [supabase.com](https://supabase.com/) |
| `CHAT_API_URL` | Cloudflare Workers デプロイ後の URL |

---

## Cloudflare Workers のデプロイ

```bash
cd chat-worker
npm install
npx wrangler deploy
```

デプロイ後に表示される URL を `config.js` の `CHAT_API_URL` に設定します。

---

## ブランチ運用

```
main        ← 本番（GitHub Pages に公開）
  └── develop     ← 開発集約
        └── feature/xxx  ← 機能・修正ごとの作業ブランチ
```

作業は必ず `feature/*` → `develop` → `main` の順でマージします。

---

## 実装履歴（主要変更）

| バージョン | 内容 |
|-----------|------|
| 初期 | 天気検索・Gemini AI アドバイス・GNews API ニュース |
| UX 改善 | キャッシュ永続化・PTR・バッジ・プライバシーポリシー・オンボーディング |
| ニュース刷新 | GNews/Currents/WorldNewsAPI 廃止 → Yahoo + Google RSS に移行 |
| モバイル対応 | 2 行ヘッダー・44px タップターゲット・設定ドロップダウン fixed 配置 |
| ニュース拡張 | 15 カテゴリタブ（横スクロール）・ブックマーク・既読・AI 要約 |
| 品質改善 | ブックマーク 2 重登録バグ修正・innerHTML 廃止・SW TTL NaN 修正 |
| セキュリティ | iframe sandbox 設定・ログアウト時データクリア・Supabase SRI 修正 |
| 季節演出 | 春（桜）/ 夏（ほたる）/ 秋（紅葉）/ 冬（雪）の季節パーティクル |
| バグ修正 | お気に入り誤登録・クラウドデータ不正復元・Google ログイン失敗を修正 |
| UI カスタマイズ | アクセントカラー・角丸・フォントサイズ・背景テーマ 9 種・ボタンアニメーション |
| モバイル底部ナビ | 天気 / ニュース / AI / 設定タブを画面下部に固定（Yahoo ニュース風） |
| ライトモード修正 | 背景テーマ適用時にライトモード背景が暗くなる CSS 競合を解消 |
| モバイル最適化 | タッチターゲット拡大・tap highlight 除去・scroll-snap・overscroll 制御 |
| 発熱対策 | backdrop-filter 除去・パーティクル削減・scroll → IntersectionObserver・リスナーリーク修正 |

---

## ライセンス

MIT License

---

*Built with Claude (Anthropic)*
