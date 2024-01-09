const {takeScreenshot, setField, waitForSelector, waitForTimeout, setFieldByIndex} = require('./puppeteer');
const {INPUT_RESULT_COMPLETE, INPUT_RESULT_ERROR, INPUT_RESULT_NOT_SUBMIT_FOR_DEBUG,
  INPUT_RESULT_SUBMIT_SELECTOR_NOT_FOUND, INPUT_RESULT_FORM_INPUT_FORMAT_INVALID,
} = require('./result');

/**
 * 全フィールドに対して入力処理を行う関数
 * @param {object} page
 * @param {object} formData
 * @param {object} inputData
 * @param {object} iframe
 * @param {string} formTag
 * @return {Promise<void>}
 */
async function fillFormFields(page, formData, inputData, iframe, formTag) {
  console.log('fillFormFields');
  for (const field of formData.fields) {
    if (!field.name) {
      console.warn('No name found for field:', field);
      // continue;
    }
    if (!field.value && field.value !== '') {
      console.warn('No value found for field:', field);
      continue;
    }
    if (field.value === 'nothing_else') {
      console.log('Skip field value for nothing_else:', field);
      continue;
    }
    const sendValue = (
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
    await handleFieldInput(page, field, sendValue, iframe, formTag);
  }
}

/**
 * フィールドごとに入力処理を行う関数
 * @param {object} page
 * @param {object} field
 * @param {string} sendValue
 * @param {object} iframe
 * @param {string} formTag
 * @return {Promise<void>}
 */
async function handleFieldInput(page, field, sendValue, iframe, formTag) {
  if (field.index !== undefined) {
    console.log('handleFieldInputByIndex', field)
    await setFieldByIndex(page, field, sendValue, iframe, formTag);
    return;
  }
  const selector = getSelector(field, 'name', formTag); // セレクタを取得
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
  await setField(page, selector, field.tag, field.name, field.type, sendValue, iframe);

  // 1秒から2秒のランダムな待機時間を追加(自動入力待機など)
  const milliseconds = Math.floor(Math.random() * 1000) + 1000;
  await new Promise((r) => setTimeout(r, milliseconds));
}

/**
 * セレクタを取得する関数
 * @param {object} field
 * @param {string} attr
 * @param {string} formTag
 * @return {null|string}
 */
function getSelector(field, attr = 'name', formTag) {
  const tag = field.tag;
  const value = field[attr];
  if (tag === 'a') {
    const onclick = field.onclick;
    if (onclick) {
      return `${formTag} ${tag}[onclick="${onclick}"]`;
    }
    const href = field.href;
    if (href) {
      return `${formTag} ${tag}[href="${href}"]`;
    }
    return `${formTag} ${tag}`;
  } else if (!tag || !value) {
    return null;
  }
  return `${formTag} ${tag}[${attr}="${value}"]`;
}

/**
 * フォームを送信する関数
 * @param {object} page
 * @param {string} submit
 * @param {object} iframe
 * @param {string} formTag
 * @return {Promise<string>}
 */
async function submitForm(page, submit, iframe, formTag) {
  console.log('submitForm');
  // スクリーンショットを撮る
  await takeScreenshot(page, 'input-before-submit');
  // viewportを元に戻す
  await new Promise((r) => setTimeout(r, 1000));

  const target = iframe.isIn ? iframe.frame : page;
  console.log("target is ", iframe.isIn ? "iframe" : "page");

  try {
    const submitSelector = getSelector(submit, submit.class ? 'class' : 'type', formTag);
    console.log('submitSelector', submitSelector);
    try {
      await waitForSelector(target, submitSelector);
    } catch (e) {
      console.warn('No submit selector found:', submit);
      return INPUT_RESULT_SUBMIT_SELECTOR_NOT_FOUND;
    }
    // デバッグの場合は送信処理をスキップ
    if (process.env.DEBUG === 'true') {
      console.log('Not submit for debug');
      const submitSelectorValue = await target.$eval(submitSelector, (el) => el.value);
      console.log('submitSelectorValue', submitSelectorValue);
      return INPUT_RESULT_NOT_SUBMIT_FOR_DEBUG;
    }
    // MutationObserverをセット
    await setupDialogAndMutationObserver(target);
    // 送信ボタンクリック
    await target.click(submitSelector);
    await takeScreenshot(page, 'input-submit-clicked');

    // 送信結果の失敗・成功を確認する
    // 成功: Thanksテキストが表示される or ページ遷移 or 時間経過
    // 失敗: エラーテキストが表示される or window.alertのダイアログが表示される
    const mutationFailed = 'mutationFailed';
    const mutationSuccess = 'mutationSuccess';
    const result = await Promise.race([
      target.waitForFunction(() => window.__mutationSuccess === true).then(() => mutationSuccess),
      target.waitForFunction(() => window.__mutationFailed === true).then(() => mutationFailed),
      target.waitForNavigation({timeout: 20000}).then(() => 'navigation'),
      waitForTimeout(target, 10000).then(() => 'timeout'),
    ]);
    if (result === mutationFailed) {
      console.warn('入力エラーを検知');
      return INPUT_RESULT_FORM_INPUT_FORMAT_INVALID;
    }
    // 成功
    return INPUT_RESULT_COMPLETE;
  } catch (e) {
    console.error(e);
    // 失敗
    return INPUT_RESULT_ERROR;
  }
}

async function setupDialogAndMutationObserver(page) {
  // フォームの変更を監視 TODO formの変更を確認するでいいのか検証
  const failedTexts = ['エラー', '必須', '未入力', '入力されて', '入力して', 'できません', '誤り', '異な', '不正', '不備', 'もう一度', '問題', '漏れ', 'もれ', '選択'];
  const thanksTexts = ['有難う', '有り難う', '有りがとう', 'ありがとう', '完了', '送信', 'Thank You', 'Thanks'];
  await page.evaluate(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (['childList', 'characterData'].includes(mutation.type)) {
          const formText = document.body.innerText;
          window.__mutationFailed = failedTexts.some((failedText) => formText.includes(failedText));
          window.__mutationSuccess = thanksTexts.some((thanksText) => formText.includes(thanksText));
        }
      }
    });
    observer.observe(document.querySelector('form'), {childList: true, characterData: true, subtree: true});
  });
  page.on('dialog', async (dialog) => {
    console.log('Dialog Message:', dialog.message());
    // await dialog.dismiss();
    window.__mutationFailed = true;
  });
}

module.exports = {
  fillFormFields,
  submitForm,
};
