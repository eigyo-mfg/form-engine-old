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
async function clickElement(page, xpath, timeout = 10000) {
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

module.exports = {
  launchBrowser,
  newPage,
  goto,
  handleAgreement,
  takeScreenshot,
};
