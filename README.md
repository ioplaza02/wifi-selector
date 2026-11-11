# Wi-Fiセレクター

I-O DATAのWi-Fiルーター・Wi-Fiアクセスポイント・LTEルーターを、必要な仕様から絞り込む社内向けツールです。

- 公開URL：https://ioplaza02.github.io/wifi-selector/
- パスワード：app.js の `SITE_PASSWORD`（簡易的な鍵で、本物のセキュリティではありません）

## ファイル構成

| ファイル | 役割 |
|---|---|
| index.html / style.css / app.js | 画面（素のHTML/CSS/JavaScript） |
| data/products.json | 商品データ（仕様の○×はここが正） |
| scripts/scrape.mjs | 公式サイトから変わりやすい情報を取得して products.json を更新 |
| scripts/health-check.mjs | 更新結果のチェック（問題があればPRとIssueで通知） |
| .github/workflows/scrape.yml | 毎日 3:00（日本時間）に自動実行 |

## 自動で更新されるもの

- 販売中／生産終了（公式の一覧ページに載っているか、商品ページの「生産終了」表記）
- JANコード、価格（税込・税抜）
- IPv6（IPoE）対応状況（公式「IPv6（IPoE）接続 動作確認済みサービス一覧＆対応機器」）

## 人が確認するもの（Issueで届きます）

- 新しい型番が一覧に出たとき → 仕様を確認して data/products.json に追加
- 販売中の商品が1割以上減ったとき（商品数が少ないため、1機種の生産終了でも通知されます）
- IPv6対応表の見出しの並びや列数が変わったとき（列ずれ防止のため、その日はIPv6のデータを更新しません）
- IPv6で「対応」→「×」に変わったとき

## 手動で実行する場合

```
node scripts/scrape.mjs
node scripts/health-check.mjs
```
