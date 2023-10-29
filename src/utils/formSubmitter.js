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
        field.type === 'radio' ||
        field.type === 'checkbox' ||
        field.tag === 'select'
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
 * @return {null|string}
 */
function getSelector(field) {
  const tag = field.tag;
  const name = field.name;
  if (!tag || !name) {
    return null;
  }
  return `${tag}[name="${name}"]`;
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
  } else {
    return
    await page.click(submit);
  }
  console.log(submit);

  // 送信完了を検知するセレクター
  const contactForm7CompleteSelector = '.wpcf7-mail-sent-ok';
  const responseOutputSelector = '.wpcf7-response-output';
  const screenReaderResponseSelector =
    '.screen-reader-response p[role="status"]'; // 新しいセレクター

  // タイムアウトを設定
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 10000));

  // ページ遷移と送信完了の検知
  const completePromise = page.waitForSelector(contactForm7CompleteSelector, {
    timeout: 10000,
  });
  const responsePromise = page.waitForSelector(responseOutputSelector, {
    timeout: 10000,
  });
  const newCompletePromise = page.waitForSelector(
      screenReaderResponseSelector,
      {timeout: 10000},
  );

  // タイムアウト、送信完了、送信結果のいずれかが発生するまで待つ
  await Promise.race([
    timeoutPromise,
    completePromise,
    responsePromise,
    newCompletePromise,
  ]);

  // 送信完了を確認
  const isComplete = await page.$(contactForm7CompleteSelector);
  if (isComplete) {
    return INPUT_RESULT_COMPLETE;
  }

  // 送信結果のテキストを確認（既存のセレクター）
  const responseElement = await page.$(responseOutputSelector);
  if (responseElement) {
    const textContent = await page.evaluate(
        (el) => el.textContent,
        responseElement,
    );
    if (
      textContent.includes('有難う') ||
      textContent.includes('有り難う') ||
      textContent.includes('有りがとう') ||
      textContent.includes('ありがとう') ||
      textContent.includes('完了') ||
      textContent.includes('Thank You')
    ) {
      return INPUT_RESULT_COMPLETE;
    }
  }

  // 送信結果のテキストを確認（新しいセレクター）
  const newResponseElement = await page.$(screenReaderResponseSelector);
  if (newResponseElement) {
    const newTextContent = await page.evaluate(
        (el) => el.textContent,
        newResponseElement,
    );
    if (
      newTextContent.includes('有難う') ||
      newTextContent.includes('有り難う') ||
      newTextContent.includes('有りがとう') ||
      newTextContent.includes('ありがとう') ||
      newTextContent.includes('Thank You')
    ) {
      return INPUT_RESULT_COMPLETE;
    }
  }
  // タイムアウトが発生した場合、または送信完了セレクターまたは送信結果セレクターが見つからなかった場合、何も返さずに関数を終了
  return INPUT_RESULT_ERROR;
}

module.exports = {
  fillFormFields,
  submitForm,
};