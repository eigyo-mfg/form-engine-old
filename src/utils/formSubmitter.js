const {takeScreenshot, setField} = require('./puppeteer');
const {INPUT_RESULT_COMPLETE, INPUT_RESULT_ERROR, INPUT_RESULT_NOT_SUBMIT_FOR_DEBUG} = require('./result');

/**
 * 全フィールドに対して入力処理を行う関数
 * @param {object} page
 * @param {object} formData
 * @param {object} inputData
 * @return {Promise<void>}
 */
async function fillFormFields(page, formData, inputData) {
  console.log('fillFormFields');
  for (const field of formData.fields) {
    if (!field.name) {
      console.warn('No name found for field:', field)
      continue;
    }
    if (!field.value) {
      console.warn('No value found for field:', field)
      continue;
    }
    let sendValue = (
        (field.type === 'radio' ||
        field.type === 'checkbox' ||
        field.tag === 'select') &&
        !inputData[field.value]
    ) ? field.value : inputData[field.value];

    // inquiry_content フィールドの場合、元の内容に戻す TODO 必要な処理か確認
    // if (field.value === 'inquiry_content') {
    //   sendValue = inputData.inquiry_content;
    // }

    // フィールドに値がない場合、処理をスキップ
    if (!sendValue && field.type !== 'radio' && field.type !== 'checkbox' && field.tag !== 'select') {
      continue;
    }
    // フィールドに値がある場合、入力処理を行う
    await handleFieldInput(page, field, sendValue);
  }
}

/**
 * フィールドごとに入力処理を行う関数
 * @param {object} page
 * @param {object} field
 * @param {string} sendValue
 * @return {Promise<void>}
 */
async function handleFieldInput(page, field, sendValue) {
  const selector = getSelector(field); // セレクタを取得
  console.log(
      'Handling field:', field.name,
      'Selector:', selector,
      'Value:', sendValue,
  );
  // セレクタがnullの場合、処理をスキップ
  if (selector === null) {
    console.warn('No selector found for field:', field);
    return;
  }

  // フィールドのタイプに応じて処理を分岐
  await setField(page, selector, field.tag, field.type, sendValue);

  // 2秒から3秒のランダムな待機時間を追加(自動入力待機など)
  const milliseconds = Math.floor(Math.random() * 1000) + 2000;
  await new Promise((r) => setTimeout(r, milliseconds));
}

/**
 * セレクタを取得する関数
 * @param {object} field
 * @param {string} attr
 * @return {null|string}
 */
function getSelector(field, attr = 'name') {
  const tag = field.tag;
  const value = field[attr];
  if (!tag || !value) {
    return null;
  }
  return `${tag}[${attr}="${value}"]`;
}

/**
 * フォームを送信する関数
 * @param {object} page
 * @param {string} submit
 * @return {Promise<string>}
 */
async function submitForm(page, submit) {
  console.log('submitForm');
  // スクリーンショットを撮る
  await takeScreenshot(page, 'input');
  // viewportを元に戻す
  await page.setViewport({width: 800, height: 600});
  await new Promise((r) => setTimeout(r, 1000));

  // submitボタンをクリック
  if (process.env.DEBUG === 'true') {
    return INPUT_RESULT_NOT_SUBMIT_FOR_DEBUG;
  }

  try {
    const submitSelector = `form ${getSelector(submit, 'type')}`;
    console.log("submitSelector", submitSelector);
    // MutationObserverをセット
    await setupCheckThanksMutationObserver(page);
    await page.waitForTimeout(3000);
    // 送信ボタンクリック
    await page.click(submitSelector);
    await takeScreenshot(page, 'check-submit');

    // 送信結果の完了を確認する(Thanksテキストが表示される or ページ遷移
    let result = await Promise.race([
      page.waitForFunction(() => window.__mutationSuccess === true).then(() => 'mutationSuccess'),
      page.waitForNavigation({timeout: 10000}).then(() => 'navigation'),
    ]);
    console.log('result', result)
    // 成功
    return INPUT_RESULT_COMPLETE
  } catch (e) {
    console.error(e);
    // 失敗
    return INPUT_RESULT_ERROR;
  }
}

async function setupCheckThanksMutationObserver (page) {
  await page.evaluate(() => {
    const observer = new MutationObserver(mutations => {
      for(let mutation of mutations) {
        if(mutation.type === 'childList') {
          let pageText = document.body.innerText;
          window.__mutationSuccess = checkThanksText(pageText);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
const checkThanksText = (text) => {
  const thanksTexts = ['有難う','有り難う','有りがとう','ありがとう','完了','Thank You'];
  return thanksTexts.some(thanksText => text.includes(thanksText));
};

module.exports = {
  fillFormFields,
  submitForm,
};
