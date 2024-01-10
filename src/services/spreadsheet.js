module.exports = {
  fetchInputData,
  getUrls: getSSData,
  getSymbol,
  updateSpreadsheet,
};

const cacheManager = require('../utils/cacheManager');
const {
  INPUT_RESULT_COMPLETE,
  INPUT_RESULT_FORM_NOT_FOUND,
  INPUT_RESULT_ERROR, INPUT_RESULT_NOT_SUBMIT_FOR_DEBUG, RESULT_SUCCESS, RESULT_ERROR, INPUT_RESULT_EXIST_RECAPTCHA,
  INPUT_RESULT_MAPPING_ERROR, INPUT_RESULT_GET_FIELDS_ERROR, INPUT_RESULT_FILL_FORM_ERROR,
  INPUT_RESULT_SUBMIT_BUTTON_NOT_FOUND,
  INPUT_RESULT_SUBMIT_SELECTOR_NOT_FOUND,
} = require('../utils/result');
const {gsapi} = require("./google");
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// スプレッドシートからデータを取得する関数
async function fetchSpreadsheetData(range) {
  const cacheKey = `ss:${range}`;
  let data = cacheManager.get(cacheKey);
  if (!data) {
    // キャッシュがなければ、APIを叩いてデータを取得し、キャッシュをセットする
    const request = {
      spreadsheetId: SPREADSHEET_ID,
      range: range,
    };
    const response = await gsapi.spreadsheets.values.get(request);
    data = response.data.values;
    cacheManager.set(cacheKey, data);
  }
  // キャッシュがあれば、キャッシュデータを返す
  return data;
}

// スプレッドシートから入力内容を呼び出す関数
async function fetchInputData() {
  console.log('fetchInputData');
  const range = 'input!A2:B';
  const rows = await fetchSpreadsheetData(range);
  const data = parseRowData(rows);
  console.log('parseRowData:', data);
  // 空入力用のデータを追加
  data.nothing_else = '';
  return data;
}

async function getSSData() {
  const range = 'Sheet1!D2:E';
  const rows = await fetchSpreadsheetData(range);
  const urls = rows
      .map((row, index) => {
        return {
          rowNumber: index + 2, // Headerの分を+1
          url: row[0],
          result: row[1],
        };
      })
      .filter((row) => !row.result); // E列(results)に値がないものだけをフィルタリング; // D列()の値（URL）だけを取得
  console.log('urls:', urls);
  return urls;
}

// スプレッドシートからのデータをRowからObjectに変換する関数
function parseRowData(rows) {
  return rows.reduce((acc, row) => {
    const key = row[0];
    let value = row[1];
    if (key === 'inquiry_content') {
      value = value.replace(/\\n/g, '\n');
    }
    acc[key] = value;
    return acc;
  }, {});
}

// URLに対応する行番号を取得する関数
async function getRowNumberForUrl(url) {
  const request = {
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!D2:D', // D列を指定
  };

  const response = await gsapi.spreadsheets.values.get(request);
  // const urls = response.data.values.map((row) => generateDocumentId(row[0])); // D列の値（URL）を変換
  const urls = response.data.values.map((row) => row[0]); // D列の値（URL）を変換

  // 部分一致でURLを検索（ここでは先頭10文字で比較）
  const partialUrl = url.substring(0, 10);
  const rowIndex = urls.findIndex((u) => u.substring(0, 10) === partialUrl);

  if (rowIndex === -1) return null; // 見つからない場合はnullを返す

  return rowIndex + 2; // 行番号は2から始まるため、インデックスに2を足す
}

/**
 * 結果を記号に変換する
 * @param {string} inputResult
 * @param {string} result
 * @return {string}
 */
function getSymbol(inputResult, result) {
  console.log('inputResult:', inputResult, 'result:', result);
  switch (inputResult) {
    case INPUT_RESULT_COMPLETE:
      switch (result) {
        case RESULT_SUCCESS:
          return '⚪︎';
        case RESULT_ERROR:
          return '△';
        default:
          return 'Unknown';
      }
    case INPUT_RESULT_ERROR:
    case INPUT_RESULT_MAPPING_ERROR:
    case INPUT_RESULT_GET_FIELDS_ERROR:
    case INPUT_RESULT_FILL_FORM_ERROR:
    case INPUT_RESULT_SUBMIT_SELECTOR_NOT_FOUND:
      return '×';
    case INPUT_RESULT_SUBMIT_BUTTON_NOT_FOUND:
      return '送信ボタンの検出に失敗';
    case INPUT_RESULT_EXIST_RECAPTCHA:
      return 'リキャプチャ';
    case INPUT_RESULT_FORM_NOT_FOUND:
      return 'フォームが存在しない'
    case INPUT_RESULT_NOT_SUBMIT_FOR_DEBUG:
      return '-';
    default:
      return 'Unknown';
  }
}

async function updateSpreadsheet(range, values) {
  console.log('updateSpreadsheet:', range, values);
  const request = {
    spreadsheetId: SPREADSHEET_ID,
    range: range,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: values,
    },
  };
  return await gsapi.spreadsheets.values.update(request);
}
