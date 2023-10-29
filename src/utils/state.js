const {requestDetermineState} = require("../services/openai");
const STATE_UNKNOWN = 'UNKNOWN';
const STATE_INPUT = 'INPUT';
const STATE_CONFIRM = 'CONFIRM';
const STATE_COMPLETE = 'COMPLETE';
const STATE_ERROR = 'ERROR';
const STATE_DONE = 'DONE';

async function currentState(page, fields) {
  // console.log("fields in currentState:", fields);
  const cleanedHtmlTextContent = await cleanHtmlContent(page);
  const { isAllTextFieldsExist, isAnyTextFieldHiddenOrReadonly } = await checkTextFields(page, fields);
  const hasSubmitButton = await checkSubmitButton(page);
  const currentState = await determineState(page, cleanedHtmlTextContent, isAllTextFieldsExist, isAnyTextFieldHiddenOrReadonly, hasSubmitButton);
  console.log(currentState);
  return currentState;
}

// HTMLコンテンツのクリーニング
async function cleanHtmlContent(page) {
  console.log('cleanHtmlContent');
  const bodyHandle = await page.$('body');
  const htmlTextContent = await page.evaluate(body => {
    // スクリプトタグを取得
    const scriptTags = body.querySelectorAll('script');

    // スクリプトタグの内容を空にする
    scriptTags.forEach(script => {
      script.textContent = '';
    });

    // その後、残りのテキストコンテンツを取得
    return body.textContent;
  }, bodyHandle);

  await bodyHandle.dispose();

  return htmlTextContent
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .trim();
}

// テキストフィールドのチェック
async function checkTextFields(page, fields) {
  const textFields = fields.filter(field => field.type === 'text').slice(0, 2); // 最初の2つのテキストフィールドを取得
  const hasTextFields = await Promise.all(
      textFields.map(async field => {
        const selector = `input[name="${field.name}"]`;
        const element = await page.$(selector);
        return element !== null;
      })
  );
  const isAllTextFieldsExist = hasTextFields.every(exist => exist);
  //hidden,readonlyが含まれているかチェック
  const isAnyTextFieldHiddenOrReadonly = await Promise.all(
      textFields.map(async field => {
        const element = await page.$(`input[name="${field.name}"]`);
        if (element !== null) {
          return await page.$eval(`input[name="${field.name}"]`, el => el.type === 'hidden' || el.readOnly);
        } else {
          return false; // セレクタに一致する要素がない場合の値
        }
      })
  );
  return { isAllTextFieldsExist, isAnyTextFieldHiddenOrReadonly };
}

//送信ボタンを探す
async function checkSubmitButton(page) {
  return await page.$('input[type="submit"], button[type="submit"]') !== null;
}

//どのページにいるか状態を判定（一部GPT-3.5を使用）
async function determineState(page, cleanedHtmlTextContent, isAllTextFieldsExist, isAnyTextFieldHiddenOrReadonly, hasSubmitButton) {
  if (process.env.DEBUG === 'true') {
    console.log('Complete for debug')
    return STATE_COMPLETE;
  }

  // 条件に基づいて状態を判定
  const hasAnyTextHiddenOrReadOnly = isAnyTextFieldHiddenOrReadonly.some(val => val);
  if (isAllTextFieldsExist) {
    if (hasSubmitButton) {
      return hasAnyTextHiddenOrReadOnly ? STATE_CONFIRM : STATE_INPUT;
    }
  } else {
    if (hasSubmitButton) {
      return STATE_CONFIRM;
    } else {
      return determineStateWithChatGPT(page, cleanedHtmlTextContent)
    }
  }
  return STATE_UNKNOWN;
}

async function determineStateWithChatGPT(page, cleanedHtmlTextContent) {
  const currentPageUrl = page.url();
  // 応答に基づいて状態を返す
  const responseMessage = await requestDetermineState(currentPageUrl, cleanedHtmlTextContent);
  const responseContentString = responseMessage.content.match(/\{[^\}]+\}/)[0];
  const responseContent = JSON.parse(responseContentString);
  const state = responseContent["位置"];
  if (state === '完了') {
    return STATE_COMPLETE;
  }
  if (state === 'エラー') {
    return STATE_ERROR;
  }
  return STATE_UNKNOWN;
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
