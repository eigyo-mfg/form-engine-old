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

