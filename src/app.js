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
  const ssDataList = await getUrls();

  // URL分割
  const chunks = chunkArray(ssDataList);

  // ブラウザ立ち上げ
  const browser = await launchBrowser();

  for (const chunk of chunks) {
    const promises = chunk.map((ssData) => run(browser, ssData));
    await Promise.all(promises);
  }
  browser.close();
}

// URLごとの処理
async function run(browser, ssData) {
  const url = ssData.url;
  console.log('run:', url);
  let page;

  try {
    // ページを開く
    page = await newPage(browser);
    await goto(page, url);

    // 問い合わせ処理実行
    const processor = new PageProcessor(page, url);
    await processor.pageProcess();

    // 結果を保存
    const results = processor.getResults();
    await saveResult(
        url,
        ssData,
        results.formMapping,
        results.fields,
        results.submit,
        results.inputResult,
        results.confirmResult,
        results.mappingPrompt,
        results.state,
        results.result,
    );
  } catch (e) {
    console.error(e);
    await saveResult(
        url,
        ssData,
        null,
        null,
        "",
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
 * @param {object} ssData
 * @param {object} formMappingData
 * @param {object} fields
 * @param {string} submit
 * @param {string} inputResult
 * @param {string} confirmResult
 * @param {string} mappingPrompt
 * @param {string} state
 * @param {string} result
 * @param {string} errorMessage
 * @returns {Promise<void>}
 */
async function saveResult(
    url,
    ssData,
    formMappingData,
    fields,
    submit,
    inputResult,
    confirmResult,
    mappingPrompt,
    state,
    result,
    errorMessage = "",
) {
  // Firestoreのformコレクションに保存するデータ
  const formData = {
    url: url,
    fields: fields, // 元フォーム
    submit: submit, // 元フォーム
  };
  // Firestoreのsubmissionサブコレクションに保存するデータ
  const submissionData = {
    errorMessage: errorMessage,
    formMappingData: formMappingData, // GPT-4が整形したマッピング
    inputResult: inputResult,
    confirmResult: confirmResult,
    prompt: mappingPrompt,
    result: result,
    state: state,
    submittedAt: TimeManager.getInstance().getISOString(),
  };
  await saveResultToFirestore(url, formData, submissionData);
  await saveResultToSpreadsheet(url, inputResult, result, ssData);
}

main().catch(console.error);
