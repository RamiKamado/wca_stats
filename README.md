# WCA 個人成績ビューア

WCA（World Cube Association）の公式記録から、選手ごとの成績と統計を表示するWebアプリです。
氏名かWCA ID（数字4桁＋英字4文字＋数字2桁）を入力すると、その選手の記録を取得して表示します。

- 自己ベストと世界・大陸・国内ランキング、表彰台回数
- 種目ごとの成績サマリー、記録の推移グラフ、ソルブ分布
- 種目ごとの記録ランキング Top 100（単発・平均）
- WCAの個人ページと同じ形式の成績履歴（新しい順）と NR・CR・WR バッジ
- 年別の参加大会数、国・地域別の参加数、大会別の全記録

サーバーは不要で、HTML・JavaScriptだけで動きます。GitHub Pages にそのまま置けます。

## ファイル構成

```
index.html             アプリ本体
manifest.webmanifest   ホーム画面に追加したときの名前・アイコン・全画面表示の設定
sw.js                  オフライン対応（アプリ本体と一度見た選手のデータをキャッシュ）
icons/                 ホーム画面・タブ用のアイコン
.nojekyll              GitHub Pages でファイルをそのまま配信するための空ファイル
```

## GitHub Pages で公開する

1. GitHub で新しいリポジトリを作ります（例: `wca-stats`、Public）。
2. このフォルダの中身をすべてリポジトリのルートに置きます。`icons` フォルダと `.nojekyll` も忘れずに。
   - ブラウザだけで行う場合: リポジトリの「Add file → Upload files」にファイルとフォルダをドラッグ＆ドロップして「Commit changes」。
   - コマンドで行う場合:
     ```bash
     git init
     git add .
     git commit -m "WCA 個人成績ビューア"
     git branch -M main
     git remote add origin https://github.com/<ユーザー名>/wca-stats.git
     git push -u origin main
     ```
3. リポジトリの「Settings → Pages」を開き、「Build and deployment」の Source を **Deploy from a branch**、Branch を **main / (root)** にして「Save」。
4. 1〜2分後に `https://<ユーザー名>.github.io/wca-stats/` で公開されます。

特定の選手を直接開くURLも使えます: `https://<ユーザー名>.github.io/wca-stats/?id=<WCA ID>`

## iPhone でアプリのように使う

1. iPhone の **Safari** で公開したURLを開きます。
2. 共有ボタン（□に↑）→「**ホーム画面に追加**」を選びます。「Webアプリとして開く」という項目が表示される場合はオンのままにします。
3. 「追加」をタップすると、ホーム画面に「WCA Stats」のアイコンができます。

このアイコンから起動すると、Safari のアドレスバーや下のツールバーがない全画面で開きます。
最後に見ていた選手が次回起動時にも表示され、一度表示した選手は電波がない場所でも見られます。

全画面にならないときは、次を確認してください。
- Safari 以外のブラウザから追加していないか（iOSの一部のブラウザでは全画面にならないことがあります）
- `https://` のURLで開いているか（ファイルを直接開いた場合は全画面になりません）
- 設定を変えた後は、ホーム画面のアイコンを一度削除してから追加し直す

## 更新するとき

`index.html` を差し替えたら、`sw.js` の先頭にある `VERSION`（例: `"v1"` → `"v2"`）も上げてください。
ホーム画面のアプリで古い画面が残るのを防げます。

## データについて

- 成績データ: WCA公式の公開データをもとにした [wca-rest-api](https://github.com/robiningelbrecht/wca-rest-api)（GitHub上のミラー、通常1日1回更新）
- 名前検索と NR・CR・WR の記録バッジ: [WCA公式API](https://www.worldcubeassociation.org/)

このアプリはWCAの公式サービスではありません。最新・正式な記録はWCA公式サイトの個人ページで確認してください。
