const {handleAgreement, takeScreenshot, getLongestElementHtmlAndIframeInfo,
  waitForTimeout,
} = require('./puppeteer');
const {
  INPUT_RESULT_FORM_NOT_FOUND,
  INPUT_RESULT_ERROR,
  INPUT_RESULT_NONE,
  RESULT_SUCCESS,
  RESULT_ERROR, CONFIRM_RESULT_ERROR, CONFIRM_RESULT_NONE, CONFIRM_RESULT_SUCCESS, INPUT_RESULT_EXIST_RECAPTCHA,
  CONFIRM_RESULT_NOT_SUBMIT_FOR_DEBUG, INPUT_RESULT_FILL_FORM_ERROR, INPUT_RESULT_GET_FIELDS_ERROR,
  INPUT_RESULT_MAPPING_ERROR,
} = require('./result');
const {
  formatAndLogFormData, getFieldsAndSubmit, removeAttributes,
} = require('./formParser');
const {fetchInputData} = require('../services/spreadsheet');
const {
  createMappingPrompt,
  requestAndAnalyzeMapping,
} = require('../services/openai');
const {fillFormFields, submitForm} = require('./formSubmitter');
const {
  STATE_INPUT,
  STATE_DONE,
  STATE_CONFIRM,
  STATE_COMPLETE,
  STATE_ERROR, currentState,
} = require('./state');
const {generateFormsDocumentId} = require('../services/firestore');
const {isContactForm7, submitContactForm7} = require('./contactForm7');
const {existRecaptcha} = require('./recaptcha');
const {uploadImage, getImageUrl} = require("../services/drive");
const MAX_INPUT_TRIALS = 2;

/**
 * ページの処理を行うクラス
 * @property {object} page
 * @property {string} url
 * @property {string} formId
 * @property {string} state
 * @property {number} errorCount
 * @property {number} inputTrials
 * @property {object} inputData
 * @property {boolean} existConfirm
 * @property {array} fields
 * @property {string} submit
 * @property {string} inputResult
 * @property {object} formMapping
 * @property {string} mappingPrompt
 *
 */
class PageProcessor {
  /**
   * コンストラクタ
   * @param {Page} page
   * @param {string} url
   */
  constructor(page, url) {
    this.page = page;
    this.url = url;
    this.lastStateUrl = url;
    this.formId = generateFormsDocumentId(url);
    this.state = STATE_INPUT;
    this.errorCount = 0;
    this.inputTrials = 0;
    this.inputData = null;
    this.existConfirm = false;
    this.fields = [];
    this.submit = '';
    this.inputResult = INPUT_RESULT_NONE;
    this.confirmResult = CONFIRM_RESULT_NONE;
    this.formMapping = null;
    this.mappingPrompt = '';
    this.lastScreenshotPath = '';
    this.screenshotUrl = '';
  }

  /**
   * ページの処理
   * @return {Promise<void>}
   */
  async pageProcess() {
    while (this.state !== STATE_DONE && this.state !== STATE_ERROR) {
      try {
        const processState = this.state;
        switch (processState) {
          case STATE_INPUT:
            await this.#processOnInput();
            break;
          case STATE_CONFIRM:
            await this.#processOnConfirm();
            break;
          case STATE_COMPLETE:
            await this.#processOnComplete();
            continue;
          case STATE_ERROR:
            await this.#processOnError();
            continue;
          default:
            throw new Error(`Unknown state: ${this.state}`);
        }
        // スクリーンショットを撮る
        this.lastScreenshotPath = await takeScreenshot(this.page, processState + '-end');
        // 状態判定
        this.state = await currentState(this.page, this.fields, this.lastStateUrl, this.inputResult, this.confirmResult, this.formId);
        if (this.state === processState) {
          throw new Error('State not changed. state=' + this.state);
        }
        this.lastStateUrl = this.page.url();
      } catch (e) {
        console.log('Error occurred while processing page. url:', this.lastStateUrl);
        console.error(e);
        this.state = STATE_ERROR;
      }
    }
    // スクリーンショットをアップロード
    const data = await uploadImage(this.lastScreenshotPath);
    const fileId = data.id;
    this.screenshotUrl = await getImageUrl(fileId);
  }

  /**
   * 入力ページの処理
   * @return {Promise<void>}
   */
  async #processOnInput() {
    // Input state processing logic
    console.log('input process');
    this.inputTrials++;
    if (this.inputTrials > MAX_INPUT_TRIALS) {
      console.log('Max processOnInput trials reached, skipping...');
      this.state = STATE_ERROR;
      return;
    }

    const isExistRecaptcha = await existRecaptcha(this.page);
    if (isExistRecaptcha) {
      console.log('Recaptcha found, skipping...');
      this.inputResult = INPUT_RESULT_EXIST_RECAPTCHA;
      return;
    }

    // 同意画面の処理
    await handleAgreement(this.page);
    // フォームのHTMLを返す
    const {html: formHTML, iframe} = await getLongestElementHtmlAndIframeInfo(this.page, 'form');
    if (!formHTML || formHTML.length === 0) {
      console.log('No form found in the HTML. Exiting processOnInput...');
      this.inputResult = INPUT_RESULT_FORM_NOT_FOUND;
      return;
    }
    // const {fields, submit} = analyzeFields(longestFormHTML);
    try {
      const {fields, submit} = getFieldsAndSubmit(formHTML);
      this.fields = fields;
      this.submit = submit;
      console.log('Fields:', fields, 'Submit:', submit);
    } catch (e) {
      console.error(e);
      this.inputResult = INPUT_RESULT_GET_FIELDS_ERROR;
    }

    const formattedFormHTML = removeAttributes(formHTML);
    console.log('Formatted form HTML:', formattedFormHTML);

    // 入力用データ取得
    const inputData = await fetchInputData();
    this.inputData = inputData;

    // 入力データとフォームのマッピング用プロンプトを作成
    const mappingPrompt = createMappingPrompt(this.fields, inputData, formattedFormHTML);
    this.mappingPrompt = mappingPrompt;

    // ChatGPTによるマッピング結果取得
    try {
      const formMappingGPTResult = await requestAndAnalyzeMapping(mappingPrompt, this.formId);
      this.formMapping = formMappingGPTResult;
    } catch (e) {
      console.error('Error while requesting mapping:', e);
      this.inputResult = INPUT_RESULT_MAPPING_ERROR;
      return;
    }

    // フォーム入力用データをフォーマット
    formatAndLogFormData(this.formMapping, inputData);
    // フォームに入力
    try {
      await fillFormFields(this.page, this.formMapping, inputData, iframe);
    } catch (e) {
      console.error('Error while filling form fields:', e)
      this.inputResult = INPUT_RESULT_FILL_FORM_ERROR;
      return
    }
    // フォームを送信
    await submitForm(this.page, this.submit, iframe)
        .then((result) => {
          console.log('Submit result:', result);
          this.inputResult = result;
        })
        .catch((error) => {
          console.error('Submit error:', error);
          this.inputResult = INPUT_RESULT_ERROR;
        });
  }

  /**
   * 確認ページの処理
   * @return {Promise<void>}
   */
  async #processOnConfirm() {
    // Confirm state processing logic
    console.log('confirm process');
    this.existConfirm = true;

    try {
      const isCF7 = await isContactForm7(this.page);
      if (isCF7) {
        console.log('Contact Form 7 found. Submitting...');
        // デバッグモードの場合は、送信処理を行わない
        if (process.env.DEBUG_CONFIRM === 'true') {
          console.log('Complete for debug-confirm');
          this.confirmResult = CONFIRM_RESULT_NOT_SUBMIT_FOR_DEBUG;
          return;
        }
        await submitContactForm7(this.page);
        this.confirmResult = CONFIRM_RESULT_SUCCESS;
        return;
      }

      await this.page.waitForSelector(
          'input[type="submit"], button[type="submit"]',
          {timeout: 20000},
      );

      const currentURL = this.page.url();
      console.log(`Current URL before clicking: ${currentURL}`);

      const buttons = await this.page.$$('button, input[type="submit"]');
      console.log(`Found ${buttons.length} buttons`);

      for (const button of buttons) {
        const buttonText = await this.page.evaluate(
            (el) => el.textContent || el.value,
            button,
        );
        const onClickAttribute = await this.page.evaluate(
            (el) => el.getAttribute('onclick'),
            button,
        );
        const isDisabled = await this.page
            .evaluate((el) => el.disabled, button);
        console.log(
            'Button Text:', buttonText,
            'OnClick Attribute:', onClickAttribute,
            'Is button disabled?', isDisabled,
        );

        // 送信ボタンか判定
        const submitTexts = ['送'];
        if (submitTexts.some((text) => buttonText.includes(text))) {
          console.log('Matching button found. Taking screenshot...');
          await takeScreenshot(this.page, 'confirm');

          // デバッグモードの場合は、送信処理を行わない
          if (process.env.DEBUG_CONFIRM === 'true') {
            console.log('Complete for debug');
            this.confirmResult = CONFIRM_RESULT_NOT_SUBMIT_FOR_DEBUG;
            return;
          }
          // 送信ボタンをクリック
          if (onClickAttribute) {
            console.log('Executing JavaScript click event');
            await this.page.evaluate((el) => el.click(), button); // ボタン要素をクリック
          } else {
            console.log('Performing normal click');
            await button.click();
          }

          // 完了メッセージの表示やページ遷移を待つために少し待つ
          await waitForTimeout(this.page, 10000);
          await takeScreenshot(this.page, 'confirm-clicked');
          this.confirmResult = CONFIRM_RESULT_SUCCESS;
          break;
        }
      }
    } catch (error) {
      console.log(`An error occurred: ${error.message}`);
      this.confirmResult = CONFIRM_RESULT_ERROR;
    }

    console.log('Ending processOnConfirm function');
  }

  /**
   * 完了ページの処理
   * @return {Promise<void>}
   */
  async #processOnComplete() {
    // Complete state processing logic
    console.log('complete process');
    // スクリーンショットを撮る
    await takeScreenshot(this.page, 'complete');
    this.state = STATE_DONE;
  }

  /**
   * エラー時の処理
   * @return {Promise<void>}
   */
  async #processOnError() {
    // Error state processing logic
    console.log('error process');
    await takeScreenshot(this.page, 'error');
    this.state = STATE_INPUT;
    this.errorCount++;
  }

  /**
   * 結果を返す
   * @return {{
   *  existConfirm: boolean,
   *  result: (string),
   *  reason: null,
   *  inputData: null,
   *  inputResult: string,
   *  confirmResult: string,
   *  submit: string,
   *  inputTrialCount: number,
   *  state: string,
   *  fields: null,
   *  formMapping: null
   *  mappingPrompt: string,
   *  screenshotUrl: string,
   * }}
   */
  getResults() {
    return {
      existConfirm: this.existConfirm,
      reason: this.inputResult,
      state: this.state,
      result: this.state === STATE_DONE ? RESULT_SUCCESS : RESULT_ERROR,
      inputTrialCount: this.inputTrials,
      inputData: this.inputData,
      inputResult: this.inputResult,
      confirmResult: this.confirmResult,
      formMapping: this.formMapping,
      mappingPrompt: this.mappingPrompt,
      fields: this.fields,
      submit: this.submit,
      screenshotUrl: this.screenshotUrl,
    };
  }
}

module.exports = {
  PageProcessor,
};
