const {requestDetermineState} = require("../services/openai");
const {extractJson} = require("./string");
const {removeAttributes, removeHeaderFooterSidebar} = require("./formParser");
const {INPUT_RESULT_FORM_INPUT_FORMAT_INVALID, INPUT_RESULT_SUBMIT_SELECTOR_NOT_FOUND, CONFIRM_RESULT_ERROR,
  INPUT_RESULT_EXIST_RECAPTCHA, INPUT_RESULT_FORM_NOT_FOUND
} = require("./result");
const {isContactForm7, isSucceedSendContactForm7} = require("./contactForm7");
const STATE_UNKNOWN = 'UNKNOWN';
const STATE_INPUT = 'INPUT';
const STATE_CONFIRM = 'CONFIRM';
const STATE_COMPLETE = 'COMPLETE';
const STATE_ERROR = 'ERROR';
const STATE_DONE = 'DONE';

/**
 * 現在の状態を取得する
 * @param {Page} page
 * @param {object} fields
 * @param {string} lastStateUrl
 * @param {string} inputResult
 * @param {string} confirmResult
 * @param {string} formId
 * @returns {Promise<string>}
 */
async function currentState(page, fields, lastStateUrl, inputResult, confirmResult, formId) {
  // デバッグモードの場合は、送信処理を行わなず、入力状態から変わらずにエラーになるので、完了状態を返す
  if (process.env.DEBUG === 'true') {
    console.log('Complete for debug')
    return STATE_COMPLETE;
  }

  // inputで失敗している場合は、エラー状態を返す
  if (inputResult === INPUT_RESULT_FORM_INPUT_FORMAT_INVALID ||
      inputResult === INPUT_RESULT_SUBMIT_SELECTOR_NOT_FOUND ||
      inputResult === INPUT_RESULT_EXIST_RECAPTCHA ||
      inputResult === INPUT_RESULT_FORM_NOT_FOUND) {
    return STATE_ERROR;
  }
  // confirmで失敗している場合は、エラー状態を返す
  if (confirmResult === CONFIRM_RESULT_ERROR) {
    return STATE_ERROR;
  }

  // Contact Form 7の場合は、完了状態を確認する
  const isCf7 = await isContactForm7(page);
  if (isCf7) {
    const isSucceedSendCf7 = await isSucceedSendContactForm7(page);
    if (isSucceedSendCf7) {
      return STATE_COMPLETE;
    }
  }

  // URLから状態を判定する
  const stateByUrl = await checkStateByUrl(page, lastStateUrl);
  if (stateByUrl !== null) {
    return stateByUrl;
  }

  // 送信ボタンを取得
  const submitElements = await getSubmitButtons(page);
  // エラー状態か確認する
  const isError = await checkErrorState(page, submitElements);
  if (isError) {
    return STATE_ERROR;
  }

  // ChatGPTで使うHTMLコンテンツを取得
  const cleanedHtmlTextContent = await cleanHtmlContent(page);
  console.log("cleanedHtmlTextContent:", cleanedHtmlTextContent);

  // GPT-3.5を使用して状態を判定
  return determineStateWithChatGPT(page, cleanedHtmlTextContent, formId);
}

/**
 * URLから状態を判定する
 * @param {Page} page
 * @param {string} lastStateUrl
 * @returns {Promise<string>}
 */
async function checkStateByUrl(page, lastStateUrl){
  // URLが変わっているか確認する
  const currentUrl = page.url();
  if (currentUrl === lastStateUrl) {
    return null;
  }
  // URLに特定の文字列が含まれるか確認
  const urlStates = [
    { urls: ['confirm', 'check'], state: STATE_CONFIRM },
    { urls: ['complete', 'thanks', 'finish', 'done'], state: STATE_COMPLETE },
  ];
  for (let urlState of urlStates) {
    if (urlState.urls.some(url => currentUrl.includes(url))) {
      return urlState.state;
    }
  }
  return null;
}

/**
 * エラー状態か確認する
 * @param {Page} page
 * @param {Array<Element>} submitElements
 * @returns {Promise<boolean>}
 */
async function checkErrorState(page, submitElements) {
  if (submitElements.length !== 0) {
    // submitボタンのテキスト取得
    const submitButtonTexts = await getSubmitButtonText(submitElements);
    // submitボタンのテキストに、「確認」または「次へ」が含まれるか
    const confirmTexts = ['確認', '次へ'];
    if (submitButtonTexts.some(text => confirmTexts.some(confirmText => text.includes(confirmText)))) {
      // submitボタンのテキストに、「送信」が含まれるか
      if (!submitButtonTexts.some(text => text.includes('送信'))) {
        // 入力画面から変わっていない
        return true
      }
    }
  }

  // :invalid要素が存在する場合は、エラー状態と判定する
  const invalidElements = await page.$$('input:invalid');
  return invalidElements.length !== 0;
}

// async function currentState(page, fields, formId) {
//   const cleanedHtmlTextContent = await cleanHtmlContent(page);
//   console.log("cleanedHtmlTextContent:", cleanedHtmlTextContent);
//   const { isAllTextFieldsExist, isAllTextFieldHiddenOrReadonly } = await checkTextFields(page, fields);
//   const hasSubmitButton = await checkSubmitButton(page);
//   const currentState = await determineState(page, cleanedHtmlTextContent, isAllTextFieldsExist, isAllTextFieldHiddenOrReadonly, hasSubmitButton, formId);
//   console.log(currentState);
//   return currentState;
// }

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

/**
 * 送信ボタンの要素を全て取得
 * @param {Page} page
 * @returns {Promise<Array<Element>>}
 */
async function getSubmitButtons(page) {
  const selector = 'input[type="submit"], button[type="submit"]';
  const elements = await page.$$(selector);
  return elements;
}

/**
 * 送信ボタンのテキストを取得
 * @param {Array<Element>} submitElements
 * @returns {Promise<Array<string>>}
 */
async function getSubmitButtonText(submitElements){
  // console.log('getSubmitButtonText');
  // const submitText = await submitElement.evaluate(element => element.textContent);
  // return submitText;
  return Promise.all(submitElements.map(async element => {
      const submitText = await element.evaluate(element => element.textContent);
      return submitText;
  }));
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

  const isCf7 = await isContactForm7(this.page);
  if (isCf7) {
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
