const {takeScreenshot, setField, waitForSelector} = require('./puppeteer');
const {INPUT_RESULT_COMPLETE, INPUT_RESULT_ERROR, INPUT_RESULT_NOT_SUBMIT_FOR_DEBUG,
  INPUT_RESULT_SUBMIT_SELECTOR_NOT_FOUND
} = require('./result');

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
  await setField(page, selector, field.tag, field.name, field.type, sendValue);

  // 1秒から2秒のランダムな待機時間を追加(自動入力待機など)
  const milliseconds = Math.floor(Math.random() * 1000) + 1000;
  await new Promise((r) => setTimeout(r, milliseconds));
}

/**
 * セレクタを取得する関数
 * @param {object} field
 * @param {string} attr
 * @param {boolean} includeFormTag
 * @return {null|string}
 */
function getSelector(field, attr = 'name', includeFormTag = false) {
  const tag = field.tag;
  const value = field[attr];
  if (!tag || !value) {
    return null;
  }
  return `${includeFormTag ? 'form ' : ''}${tag}[${attr}="${value}"]`;
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
  await takeScreenshot(page, 'input-before-submit');
  // viewportを元に戻す
  await page.setViewport({width: 800, height: 600});
  await new Promise((r) => setTimeout(r, 1000));

  // デバッグの場合は送信処理をスキップ
  if (process.env.DEBUG === 'true') {
    console.log('Not submit for debug')
    const submitSelector = getSelector(submit, 'type', true);
    await waitForSelector(page, submitSelector).catch(() => {
      return INPUT_RESULT_SUBMIT_SELECTOR_NOT_FOUND;
    });
    console.log("submitSelector", submitSelector);
    const submitSelectorValue = await page.$eval(submitSelector, el => el.value);
    console.log("submitSelectorValue", submitSelectorValue);
    return INPUT_RESULT_NOT_SUBMIT_FOR_DEBUG;
  }

  try {
    const submitSelector = getSelector(submit, 'type', true);
    console.log("submitSelector", submitSelector);
    await waitForSelector(page, submitSelector).catch(() => {
      return INPUT_RESULT_SUBMIT_SELECTOR_NOT_FOUND;
    });
    // MutationObserverをセット
    await setupCheckThanksMutationObserver(page);
    // 送信ボタンクリック
    await page.click(submitSelector);
    await takeScreenshot(page, 'input-submit-clicked');

    // 送信結果の完了を確認する(Thanksテキストが表示される or ページ遷移
    const result = await Promise.race([
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
  // フォームの変更を監視 TODO formの変更を確認するでいいのか検証
  await page.evaluate(() => {
    const observer = new MutationObserver(mutations => {
      for(let mutation of mutations) {
        if(['childList', 'characterData'].includes(mutation.type)) {
          let formText = document.body.innerText;
          const thanksTexts = ['有難う','有り難う','有りがとう','ありがとう','完了','送信しました','送信されました','Thank You'];
          window.__mutationSuccess = thanksTexts.some(thanksText => formText.includes(thanksText));
        }
      }
    });
    observer.observe(document.querySelector('form'), { childList: true, characterData: true, subtree: true });
  });
}

module.exports = {
  fillFormFields,
  submitForm,
};
