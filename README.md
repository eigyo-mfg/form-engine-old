# Setup
```zsh
$ cp .env.example .env
$ npm install
# serviceAccountKey.jsonを配置
```

# Run
```zsh
# run
$ npm run start

# debug
$ npm run debug

# lint
$ npm run lint

# format
$ npm run format
```

# Code Structure
```
├── src
│   ├── services
│   │   ├── firebase.js # firebaseの初期化
│   │   ├── firestore # firestoreの操作
│   │   ├── openai # OpenAI APIの操作
│   │   └── spreadsheet # spreadsheetの操作
│   ├── utils
│   │   ├── array.js # array utils
│   │   ├── cacheManager.js # キャッシュ管理
│   │   ├── formParser.js # フォームの解析
│   │   ├── formSubmitter.js # フォームの送信
│   │   ├── pageProcessor.js # pageの一連の
│   │   ├── result.js # 実行結果登録
│   │   ├── state.js # 状態管理
│   │   └── time.js # 時間管理
│   ├── app.js # メイン処理
├── .env
├── serviceAccountKey.json # firebaseの認証情報
…
```

# デバッグモードについて
`npm run debug`コマンドを実行することで、検証用として実行します。
デバッグモードの実行では、process.env.DEBUGの値をtrueにし、下記の処理が異なります。
- 問い合わせ送信処理を行わない
- 状態判定処理を行わず、完了にする
- 過去に実行したChatGPTへのリクエストと同じプロンプトの場合、ChatGPTへのリクエストを送らず、Firestoreから過去の結果を取得する