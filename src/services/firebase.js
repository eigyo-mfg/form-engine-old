const admin = require('firebase-admin');

// プロジェクトのルートディレクトリからの相対パスを指定します。
const serviceAccount = require('./../../serviceAccountKey.json');
// admin.initializeApp({
//   projectId: serviceAccount.project_id,
//   privateKey: serviceAccount.private_key,
//   clientEmail: serviceAccount.client_email,
// });
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

module.exports = {
  admin,
  db,
};
