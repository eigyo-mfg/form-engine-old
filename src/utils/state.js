const {requestDetermineState} = require("../services/openai");
const {generateFormsDocumentId} = require("../services/firestore");
const {extractJson} = require("./string");
const {removeAttributes, removeHeaderFooterSidebar} = require("./formParser");
const STATE_UNKNOWN = 'UNKNOWN';
const STATE_INPUT = 'INPUT';
const STATE_CONFIRM = 'CONFIRM';
const STATE_COMPLETE = 'COMPLETE';
const STATE_ERROR = 'ERROR';
const STATE_DONE = 'DONE';

async function currentState(page, fields, formId) {
  const cleanedHtmlTextContent = await cleanHtmlContent(page);
  console.log("cleanedHtmlTextContent:", cleanedHtmlTextContent);
  const { isAllTextFieldsExist, isAllTextFieldHiddenOrReadonly } = await checkTextFields(page, fields);
  const hasSubmitButton = await checkSubmitButton(page);
  const currentState = await determineState(page, cleanedHtmlTextContent, isAllTextFieldsExist, isAllTextFieldHiddenOrReadonly, hasSubmitButton, formId);
  console.log(currentState);
  return currentState;
}

// HTMLコンテンツのクリーニング
async function cleanHtmlContent(page) {
  console.log('cleanHtmlContent');
  // 最も階層が深いdivを取得 (ヘッダーやサイドバー、フッターなどのテキストが含まれていない部分を取得したいため)
  const deepestDiv = await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('div'));
    let maxChildren = 0;
    let deepestDiv = null;

    divs.forEach(div => {
      const childrenCount = div.getElementsByTagName('*').length;
      if (childrenCount > maxChildren) {
        maxChildren = childrenCount;
        deepestDiv = div;
      }
    });

    return deepestDiv ? deepestDiv.outerHTML : null;
  });

  const mainDiv = removeHeaderFooterSidebar(deepestDiv);
  const cleaned = removeAttributes(mainDiv);

  return cleaned;
}

// テキストフィールドのチェック
async function checkTextFields(page, fields) {
  // 最初の2つのテキストフィールドを取得
  const textFields = fields.filter(field => field.type === 'text').slice(0, 2);
  // 全てのテキストフィールドが存在するかどうかをチェック
  const isAllTextFieldsExist = (await Promise.all(
      textFields.map(async field => {
        const selector = `input[name="${field.name}"]`;
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          return true;
        } catch {
          // セレクタが見つからなかった場合はfalseを返す
          return false;
        }
      })
  )).every(Boolean);

  // 全てhidden,readonlyの場合はtrueを返す
  const isAllTextFieldHiddenOrReadonly = textFields.every(field => {
    const selector = `input[name="${field.name}"]`;
    const element = page.$(selector);
    if (element !== null) {
      return element.type === 'hidden' || element.readOnly;
    } else {
      return false; // セレクタに一致する要素がない場合の値
    }
  })

  return { isAllTextFieldsExist, isAllTextFieldHiddenOrReadonly };
}

//送信ボタンを探す
async function checkSubmitButton(page) {
  return await page.$('input[type="submit"], button[type="submit"]') !== null;
}

/**
 * どのページにいるか状態を判定（一部GPT-3.5を使用）
 * @param {Page} page
 * @param {string} cleanedHtmlTextContent
 * @param {boolean} isAllTextFieldsExist
 * @param {boolean} isAllTextFieldHiddenOrReadonly
 * @param {boolean} hasSubmitButton
 * @param {string} formId
 * @returns {Promise<string|string>}
 */

async function determineState(page, cleanedHtmlTextContent, isAllTextFieldsExist, isAllTextFieldHiddenOrReadonly, hasSubmitButton, formId) {
  // デバッグモードの場合は、送信処理を行わなず、入力状態から変わらずにエラーになるので、完了状態を返す
  if (process.env.DEBUG === 'true') {
    console.log('Complete for debug')
    return STATE_COMPLETE;
  }

  console.log(
    "isAllTextFieldsExist:", isAllTextFieldsExist,
    "isAllTextFieldHiddenOrReadonly:", isAllTextFieldHiddenOrReadonly,
    "hasSubmitButton:", hasSubmitButton
  );
  // 条件に基づいて状態を判定
  // 送信ボタンがある
  if (hasSubmitButton) {
    // 全てのテキストフィールドがhiddenまたはreadonly or 全てのテキストフィールドが存在しない
    if (isAllTextFieldHiddenOrReadonly || !isAllTextFieldsExist) {
      return STATE_CONFIRM;
    }
  }

  // URLに特定の文字列が含まれるか確認
  const currentUrl = page.url();
  const urlStates = [
    { urls: ['confirm', 'check'], state: STATE_CONFIRM },
    { urls: ['complete', 'thanks', 'finish', 'done'], state: STATE_COMPLETE },
  ];
  for (let urlState of urlStates) {
    if (urlState.urls.some(url => currentUrl.includes(url))) {
      return urlState.state;
    }
  }

  // GPT-3.5を使用して状態を判定
  return determineStateWithChatGPT(page, cleanedHtmlTextContent, formId);
}

async function determineStateWithChatGPT(page, cleanedHtmlTextContent, formId) {
  console.log("determineStateWithChatGPT");
  // 応答に基づいて状態を返す
  const responseMessage = await requestDetermineState(cleanedHtmlTextContent, formId);
  const responseContent = extractJson(responseMessage);
  const result = responseContent["result"];
  if (result === "failure") {
    return STATE_UNKNOWN;
  }
  const state = responseContent["state"];
  switch (state) {
    case 'confirm':
      return STATE_CONFIRM;
    case 'complete':
      return STATE_COMPLETE;
    case 'error':
      return STATE_ERROR;
    default:
      return STATE_UNKNOWN;
  }
}


module.exports = {
  STATE_UNKNOWN,
  STATE_INPUT,
  STATE_CONFIRM,
  STATE_COMPLETE,
  STATE_ERROR,
  STATE_DONE,
  currentState,
};
