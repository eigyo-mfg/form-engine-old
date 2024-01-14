const {
  saveSubmission,
  saveForm,
  generateFormsDocumentId,
} = require('../services/firestore');
const {
  getSymbol,
  updateSpreadsheet,
} = require('../services/spreadsheet');
const {TimeManager} = require('./time');
const INPUT_RESULT_COMPLETE = 'COMPLETE';
const INPUT_RESULT_ERROR = 'ERROR';
const INPUT_RESULT_NONE = 'NONE';
const INPUT_RESULT_FORM_NOT_FOUND = 'FORM_NOT_FOUND';
const INPUT_RESULT_SUBMIT_BUTTON_NOT_FOUND = 'SUBMIT_BUTTON_NOT_FOUND';
const INPUT_RESULT_FILL_FORM_ERROR = 'FILL_FORM_ERROR';
const INPUT_RESULT_MAPPING_ERROR = 'MAPPING_ERROR';
const INPUT_RESULT_GET_FIELDS_ERROR = 'GET_FIELDS_ERROR';
const INPUT_RESULT_FORM_INPUT_FORMAT_INVALID = 'FORM_INPUT_FORMAT_INVALID';
const INPUT_RESULT_SUBMIT_SELECTOR_NOT_FOUND = 'SUBMIT_SELECTOR_NOT_FOUND';
const INPUT_RESULT_NOT_SUBMIT_FOR_DEBUG = 'NOT_SUBMIT_FOR_DEBUG';
const INPUT_RESULT_SUBMIT_SELECTOR_CLICK_FAILED = 'SUBMIT_SELECTOR_CLICK_FAILED';
const INPUT_RESULT_EXIST_RECAPTCHA = 'EXIST_RECAPTCHA';
const CONFIRM_RESULT_NONE = 'NONE';
const CONFIRM_RESULT_SUCCESS = 'SUCCESS';
const CONFIRM_RESULT_ERROR = 'ERROR';
const CONFIRM_SUBMIT_BUTTON_NOT_FOUND = 'SUBMIT_BUTTON_NOT_FOUND';
const CONFIRM_RESULT_NOT_SUBMIT_FOR_DEBUG = 'NOT_SUBMIT_FOR_DEBUG';
const RESULT_SUCCESS = 'SUCCESS';
const RESULT_ERROR = 'ERROR';

/**
 * Firestoreに結果を保存する
 * @param {string} url
 * @param {object} formData
 * @param {object} submissionData
 * @return {Promise<void>}
 */
async function saveResultToFirestore(url, formData, submissionData) {
  const docId = generateFormsDocumentId(url);
  await saveForm(docId, formData);
  await saveSubmission(docId, {
    ...submissionData,
    formId: docId,
  });
}

/**
 * スプレッドシートに結果を保存する
 * @param {string} url
 * @param {string} inputResult
 * @param {string} result
 * @param {object} ssData
 * @param {string} screenshotUrl
 * @return {Promise<void>}
 */
async function saveResultToSpreadsheet(url, inputResult, result, ssData, screenshotUrl) {
  try {
    const rowNumber = ssData.rowNumber;
    const symbol = getSymbol(inputResult, result); // 結果を記号に直す
    const date = TimeManager.getInstance().getFormattedDate();

    const range = `Sheet1!E${rowNumber}:G${rowNumber}`; // E列~G列の対応する行を指定
    const values = [[symbol, date, screenshotUrl]];
    await updateSpreadsheet(range, values);
  } catch (e) {
    console.error('Error while updating spreadsheet', e);
  }
}

module.exports = {
  INPUT_RESULT_COMPLETE,
  INPUT_RESULT_ERROR,
  INPUT_RESULT_NONE,
  INPUT_RESULT_FORM_NOT_FOUND,
  INPUT_RESULT_SUBMIT_BUTTON_NOT_FOUND,
  INPUT_RESULT_FILL_FORM_ERROR,
  INPUT_RESULT_MAPPING_ERROR,
  INPUT_RESULT_GET_FIELDS_ERROR,
  INPUT_RESULT_FORM_INPUT_FORMAT_INVALID,
  INPUT_RESULT_SUBMIT_SELECTOR_NOT_FOUND,
  INPUT_RESULT_NOT_SUBMIT_FOR_DEBUG,
  INPUT_RESULT_SUBMIT_SELECTOR_CLICK_FAILED,
  INPUT_RESULT_EXIST_RECAPTCHA,
  CONFIRM_RESULT_NONE,
  CONFIRM_RESULT_SUCCESS,
  CONFIRM_RESULT_ERROR,
  CONFIRM_SUBMIT_BUTTON_NOT_FOUND,
  CONFIRM_RESULT_NOT_SUBMIT_FOR_DEBUG,
  RESULT_SUCCESS,
  RESULT_ERROR,
  saveResultToFirestore,
  saveResultToSpreadsheet,
};
