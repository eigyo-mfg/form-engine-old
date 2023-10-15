const {takeScreenshot} = require('./puppeteer');
const {INPUT_RESULT_COMPLETE, INPUT_RESULT_ERROR} = require('./result');

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
    if (!field.name) continue;
    const valueToSend = inputData[field.name];

    if (
      valueToSend === undefined &&
      field.type !== 'radio' &&
      field.type !== 'checkbox' &&
      field.type !== 'select'
    ) {
      continue;
    }
    await handleFieldInput(page, field, valueToSend);
  }
}

/**
 * フィールドごとに入力処理を行う関数
 * @param {object} page
 * @param {object} field
 * @param {string} valueToSend
 * @return {Promise<void>}
 */
async function handleFieldInput(page, field, valueToSend) {
  const selector = getSelector(field); // セレクタを取得
  console.log(
      'Handling field:', field.name,
      'Selector:', selector,
      'Value:', valueToSend,
  );
  // セレクタがnullの場合、処理をスキップ
  if (selector === null) {
    console.warn('No selector found for field:', field);
    return;
  }

  switch (field.type) {
    case 'text':
    case 'email':
    case 'date':
    case 'month':
    case 'number':
    case 'tel':
    case 'time':
    case 'url':
    case 'week':
      // 現在の値を取得
      const currentValue = await page.$eval(selector, (el) => el.value);
      // 現在の値が送信する値と同じであればスキップ
      if (currentValue === valueToSend) {
        return;
      }
      await page.type(selector, valueToSend); // 値を入力
      break;
    case 'textarea':
      await page.focus(selector); // テキストエリアにフォーカスを当てる
      await page.$eval(selector, (el) => (el.value = '')); // 現在の値をクリア
      await page.type(selector, valueToSend); // 新しい値を入力
      break;
    case 'radio':
      const selectedRadioValue = field.values[0].selectValue; // 選択する値を取得
      await page.click(
          `input[name="${field.value}"][value="${selectedRadioValue}"]`,
      ); // ラジオボタンを選択
      break;
    case 'checkbox':
      const checkboxSelector = `input[name="${field.value}"]`;
      // チェックボックスの現在の状態を取得
      const isChecked = await page.$eval(checkboxSelector, (el) => el.checked);
      if (!isChecked) {
        // チェックボックスが選択されていない場合のみクリック
        const selectedCheckboxValue = field.values[0].selectValue; // 選択する値を取得
        if (selectedCheckboxValue) {
          // チェックボックスが選択されている場合
          await page.click(
              `input[name="${field.value}"][value="${selectedCheckboxValue}"]`,
          );
        }
      }
      break;
    case 'select':
      // 選択する値を取得
      const selectedSelectValue = field.values[0].selectValue;
      // セレクトボックスを選択
      await page.select(`select[name="${field.value}"]`, selectedSelectValue);
      break;
    // 他のタイプに対応する場合、ここに追加のケースを追加します
  }
  // 3秒から5秒のランダムな待機時間を追加
  const milliseconds = Math.floor(Math.random() * 3000) + 2000;
  await new Promise((r) => setTimeout(r, milliseconds));
}

/**
 * セレクタを取得する関数
 * @param {object} field
 * @return {null|string}
 */
function getSelector(field) {
  switch (field.type) {
    case 'text':
    case 'email':
    case 'date':
    case 'month':
    case 'number':
    case 'tel':
    case 'time':
    case 'url':
    case 'week':
      return `input[name="${field.value}"]`;
    case 'textarea':
      return `textarea[name="${field.value}"]`;
    case 'select':
      return `select[name="${field.value}"]`;
    case 'radio':
      return `input[name="${field.value}"]`; // ラジオボタンのセレクタを返す
    case 'checkbox':
      return `input[name="${field.value}"]`; // チェックボックスのセレクタを返す
    // 他のタイプに対応する場合、ここに追加のケースを追加します
    default:
      return null;
  }
}

/**
 * フォームを送信する関数
 * @param {object} page
 * @param {object} formData
 * @return {Promise<string>}
 */
async function submitForm(page, formData) {
  console.log('submitForm');
  // スクリーンショットを撮る
  await takeScreenshot(page, 'input');

  // viewportを元に戻す
  await page.setViewport({width: 800, height: 600});
  await new Promise((r) => setTimeout(r, 1000));

  // submitボタンをクリック
  return INPUT_RESULT_COMPLETE; // TODO
  await page.click(formData.submit);
  console.log(formData.submit);

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
