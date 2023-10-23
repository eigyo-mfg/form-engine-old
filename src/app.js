require('dotenv').config();
const {getUrls} = require('./services/spreadsheet');
const {launchBrowser, newPage, goto} = require('./utils/puppeteer');
const {chunkArray} = require('./utils/array');
const {TimeManager} = require('./utils/time');
const {PageProcessor} = require('./utils/pageProcessor');
const {
  saveResultToFirestore,
  saveResultToSpreadsheet, RESULT_ERROR,
} = require('./utils/result');

// メイン関数
async function main() {
  // TimeManagerインスタンスを生成
  TimeManager.getInstance();

  // スプレッドシートからデータを取得
  const urls = await getUrls();

  // URL分割
  const chunks = chunkArray(urls);

  // ブラウザ立ち上げ
  const browser = await launchBrowser();

  for (const chunk of chunks) {
    const promises = chunk.map((url) => run(browser, url));
    await Promise.all(promises);
  }
  browser.close();
}

// URLごとの処理
async function run(browser, url) {
  console.log('run:', url);
  let page;

  try {
    // ページを開く
    page = await newPage(browser);
    await goto(page, url);

    // 問い合わせ処理実行
    const processor = new PageProcessor(page);
    await processor.pageProcess();

    // 結果を保存
    const results = processor.getResults();
    await saveResult(
        url,
        results.formMapping,
        results.fields,
        results.submit,
        results.inputResult,
        results.mappingPrompt,
        results.state,
        results.result,
    );
  } catch (e) {
    await saveResult(
        url,
        null,
        null,
        "",
        "",
        "",
        "",
        RESULT_ERROR,
        e.message,
    );
  } finally {
    await page.close();
  }
}

/**
 * 実行結果を保存する
 * @param {string} url
 * @param {object} formMappingData
 * @param {object} fields
 * @param {string} submit
 * @param {string} inputResult
 * @param {string} mappingPrompt
 * @param {string} state
 * @param {string} result
 * @param {string} errorMessage
 * @returns {Promise<void>}
 */
async function saveResult(
    url,
    formMappingData,
    fields,
    submit,
    inputResult,
    mappingPrompt,
    state,
    result,
    errorMessage = "",
) {
  const formData = {
    url: url,
    formMappingData: formMappingData, // GPT-4が整形したマッピング
    fields: fields, // 元フォーム
    submit: submit, // 元フォーム
  };
  const submissionData = {
    inputResult: inputResult,
    prompt: mappingPrompt,
    submittedAt: TimeManager.getInstance().getISOString(),
    state: state,
    result: result,
    errorMessage: errorMessage,
  };
  await saveResultToFirestore(url, formData, submissionData);
  await saveResultToSpreadsheet(url, result);
}

main().catch(console.error);
