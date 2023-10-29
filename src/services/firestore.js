const {db, admin} = require('./firebase');
const {hash} = require("../utils/crypto");

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
  try {
    data.updateTimestamp = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('forms').doc(docId).set(data, {merge: true});
  } catch (error) {
    console.error(error);
  }
}

/**
 * Firestoreにsubmissionを保存する
 * @param {string} formKey
 * @param {object} data
 * @returns {Promise<void>}
 */
async function saveSubmission(formKey, data) {
  try {
    const docRef = await db.collection('forms')
        .doc(formKey)
        .collection('submissions')
        .add(data);
    console.log('submission save succeeded:', docRef.id);
  } catch (error) {
    console.error(error);
  }
}

async function saveAIGeneratedResponse(formId, data, docId = null) {
  try {
    if (!docId) {
      const docRef = await db.collection('forms')
          .doc(formId)
          .collection('ai-generated-responses')
          .add(data);
      console.log('ai-generated-response save succeeded:', docRef.id);
    } else {
      await db.collection('forms')
          .doc(formId)
          .collection('ai-generated-responses')
          .doc(docId)
          .set(data, {merge: true});
      console.log('ai-generated-response update succeeded:', docId);
    }
  } catch (error) {
    console.error(error);
  }
}

async function getLatestPromptResponse(formId, systemPrompt, prompt) {
  try {
    const docRef = await db.collection('forms')
        .doc(formId)
        .collection('ai-generated-responses')
        .where('systemPrompt', '==', hash(systemPrompt))
        .where('prompt', '==', hash(prompt))
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
    if (docRef.empty) {
      return null;
    } else {
      return docRef.docs[0].data();
    }
  } catch (error) {
    console.error(error);
    return null;
  }
}

function hashPrompt(prompt) {
  const hash = crypto.createHash('sha256');
  hash.update(prompt);
  return hash.digest('hex');
}

module.exports = {
  generateFormsDocumentId,
  saveForm,
  saveSubmission,
  saveAIGeneratedResponse,
  getLatestPromptResponse,
};
