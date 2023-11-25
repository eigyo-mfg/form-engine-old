// firestore.js
const admin = require('firebase-admin');
const serviceAccount = require('/Users/nishishimamotoshu/開発PJ/form-engine/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

module.exports = db;
