const {db, admin} = require('./firebase');

function getLatestResultForUrl(url) {
  const submissionsCollectionRef = db.collection('submissions');
  const querySnapshot = submissionsCollectionRef
      .where('url', '==', url)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();
  if (querySnapshot.empty) {
    return 'NONE'; // TODO
  }
}

// URLをFirestoreのデータとして扱えるように変換
function generateFormsDocumentId(url) {
  if (!url) {
    console.error('URL is undefined or null');
    return ''; // URLがundefinedまたはnullの場合、空文字列を返す
  }
  // URLの最後がスラッシュで終わっている場合、それを削除
  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  // プロトコル部分を削除
  url = url.replace(/^https?:\/\//, '');
  return url.replace(/\//g, '__');
}
async function saveForm(docId, data) {
  console.log('saveForm: ', data);
  try {
    data.updateTimestamp = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('forms').doc(docId).set(data, {merge: true});
    console.log('saveForm: ', data);
  } catch (error) {
    console.error(error);
  }
}

/**
 * Firestoreにsubmissionを保存する
 * @param {object} data
 * @returns {Promise<void>}
 */
async function saveSubmission(data) {
  console.log('saveSubmission:', data);
  try {
    await db.collection('submissions').add(data);
    console.log('submission save succeeded:', data);
  } catch (error) {
    console.error(error);
  }
}

module.exports = {
  generateFormsDocumentId,
  saveForm,
  saveSubmission,
};
