# life-game

人生ゲーム風 3D ボードゲーム。設計は docs/DESIGN.md を正とする。

## 技術スタック（変更禁止）

Vite 8 / TypeScript 6 / three.js 0.186 / Vitest / Node 20.19。UI はフレームワークなしの HTML + CSS。

## 構成

- `src/core` 純粋 TS のゲームルール。three.js・DOM に依存しない。必ずテストを付ける
- `src/data` 盤面・職業・イベントのデータ
- `src/view` three.js 描画。`src/ui` HTML オーバーレイ。`src/input` Gamepad / キーボード
- `src/app.ts` が各層をつなぐ

## ルール

- 公開予定のため、原作の名称・ロゴ・デザイン・文面を使わない。固有名はオリジナル
- 依存方向は view/ui/input → core の一方向
- マス・職業・イベントはデータファイルに置き、ルールにハードコードしない
- `npm run check` が通ってからコミット
- この環境では PATH 上の `python3`（mise/rye のシム）が固まる。Python を使うときは必ず `/opt/homebrew/bin/python3` を直接指定し、npm install が node-gyp で止まる場合は `npm_config_python=/opt/homebrew/bin/python3` を設定する

## 役割

設計 Fable、実装 Opus サブエージェント、レビュー Fable + Codex

## 入力

Switch の Joy-Con（横持ち、片側 1 本）を主対象。Pro コントローラーとキーボードも対応
