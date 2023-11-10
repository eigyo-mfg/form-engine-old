const {launch} = require('puppeteer');
const {TimeManager} = require('./time');
const fs = require('fs');

/**
 * ブラウザを立ち上げる
 * @return {Promise<Browser>}
 */
async function launchBrowser() {
  const headless = process.env.DEBUG !== 'true';
  console.log('launch browser with headless:', headless);

  const browser = await launch({
    headless: headless,
  });
  return browser;
}

/**
 * 新しいページを開く
 * @param {object} browser
 * @return {Promise<*>}
 */
async function newPage(browser) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('www.google-analytics.com')) {
      req.abort();
    } else if (
      ['image', 'stylesheet', 'font'].indexOf(req.resourceType()) !== -1
    ) {
      req.abort();
    } else {
      req.continue();
    }
  });
  return page;
}

/**
 * 指定したURLに移動する
 * @param {object} page
 * @param {string} url
 * @return {Promise<void>}
 */
async function goto(page, url) {
  console.log('goto:', url);
  await page.goto(url, {waitUntil: 'networkidle2', timeout: 10000});
}

/**
 * 指定したxpathの要素をクリックする
 * @param {object} page
 * @param {string} xpath
 * @param {number} timeout
 * @return {Promise<void>}
 */
async function clickElement(page, xpath, timeout = 3000) {
  const [element] = await page.$x(xpath);
  if (element) {
    await element.click();
    if (timeout > 0) await page.waitForNavigation({timeout: timeout});
  }
}

/**
 * 同意ボタンをクリックする
 * @param {object} page
 * @return {Promise<void>}
 */
async function handleAgreement(page) {
  console.log('handleAgreement');
  try {
    // チェックボックスがあればクリック
    await clickElement(page, '//input[@type=\'checkbox\']', 0);
    // 同意ボタンがあればクリック
    await clickElement(
        page,
        '//input[contains(@value, \'同意\') ' +
        'and not(@type=\'image\' and @alt=\'検索\')] | ' +
        '//a[contains(text(), \'同意\')] | ' +
        '//span[contains(text(), \'同意\')]',
    );
  } catch (error) {
    console.error('No agreement button found');
  }
}

/**
 * スクリーンショットを撮る
 * @param {object} page
 * @param {string} stage
 * @return {Promise<void>}
 */
async function takeScreenshot(page, stage = '') {
  const bodyHandle = await page.$('body');
  const {width, height} = await bodyHandle.boundingBox();
  await bodyHandle.dispose();

  await page.setViewport({width: Math.ceil(width), height: Math.ceil(height)});

  const domainName = new URL(page.url()).hostname;
  const tm = TimeManager.getInstance();
  const dateTime = tm.getFormattedISOString();
  const ssDir = process.env.SCREENSHOT_DIRECTORY || './screenshot';
  if (!fs.existsSync(ssDir)){
    fs.mkdirSync(ssDir, { recursive: true });
  }
  const screenshotPath = `${ssDir}/${domainName}_${dateTime}_${stage}.png`;

  await page.screenshot({path: screenshotPath, fullPage: true});
}

/**
 * ページ全体で最長の要素のHTMLを取得します
 * @param {Page} page
 * @param {string} tagName
 * @return {Promise<string>}
 */
async function getLongestElementHtml(page, tagName) {
    // ページ全体で最長の要素を取得します
    let longestElementHtml = await page.evaluate((tag) => {
      const elements = Array.from(document.getElementsByTagName(tag));
      if (elements.length === 0) return null;
      let longestElement = elements[0];
      let longestLength = longestElement.innerHTML.length;
      for (const element of elements) {
        const length = element.innerHTML.length;
        if (length > longestLength) {
          longestElement = element;
          longestLength = length;
        }
      }
      return longestElement.outerHTML;
    }, tagName);

    // ページ全体で最長の要素が存在しない場合、iframe内をチェックします
    if (!longestElementHtml) {
      const frames = await page.frames();
      for (const frame of frames) {
        longestElementHtml = await frame.evaluate((tag) => {
          const elements = Array.from(document.getElementsByTagName(tag));
          if (elements.length === 0) return null;
          let longestElement = elements[0];
          let longestLength = longestElement.innerHTML.length;
          for (const element of elements) {
            const length = element.innerHTML.length;
            if (length > longestLength) {
              longestElement = element;
              longestLength = length;
            }
          }
          return longestElement.outerHTML;
        }, tagName);
        if (longestElementHtml) break;
      }
    }
    return longestElementHtml;
}

async function setField(page, selector, tag, type, value){
  if (tag === 'input') {
    if (type === 'radio') {
      await page.click(`${tag}[value="${value}"]`); // ラジオボタンを選択
    } else if (type === 'checkbox') {
      // 一旦全てのチェックボックスのチェックを外す
      const checkboxes = await page.$$(selector);
      for (let checkbox of checkboxes) {
        let isChecked = await page.evaluate(el => el.checked, checkbox);
        // チェックされてたらクリック
        if (isChecked) {
          await checkbox.click();
        }
      }
      // 全てのチェックボックスが外れた後、対象のチェックボックスをクリック
      await page.click(`${tag}[value="${value}"]`);
    } else {
      // 現在の値を取得
      const currentValue = await page.$eval(selector, (el) => el.value);
      // 現在の値が送信する値と同じであればスキップ
      if (currentValue === value) {
        return;
      }
      if (currentValue !== '') {
        // 現在の値をクリア
        await page.$eval(selector, (el) => (el.value = ''));
      }
      await page.type(selector, value); // 値を入力
    }
  } else if (tag === 'textarea') {
    await page.focus(selector); // テキストエリアにフォーカスを当てる
    await page.$eval(selector, (el) => (el.value = '')); // 現在の値をクリア
    await page.type(selector, value); // 新しい値を入力
  } else if (tag === 'select') {
    // セレクトボックスを選択
    await page.select(selector, value);
  }
}

async function waitForSelector(page, selector, timeout = 5000) {
    await page.waitForSelector(selector, {timeout: timeout});
}

module.exports = {
  launchBrowser,
  newPage,
  goto,
  handleAgreement,
  takeScreenshot,
  getLongestElementHtml,
  setField,
  waitForSelector,
};
