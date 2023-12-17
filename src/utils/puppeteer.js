const {launch} = require('puppeteer');
const {TimeManager} = require('./time');
const fs = require('fs');

/**
 * ブラウザを立ち上げる
 * @return {Promise<Browser>}
 */
async function launchBrowser() {
  const headless = process.env.DEBUG !== 'true' && process.env.DEBUG_CONFIRM !== 'true';
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
    if (timeout > 0) {
      try {
        await page.waitForNavigation({timeout: timeout});
      } catch (e) {
        console.warn('Navigation timeout');
      }
    }
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
    console.warn('No agreement button found');
  }
}

/**
 * スクリーンショットを撮る
 * @param {object} page
 * @param {string} stage
 * @return {Promise<string>}
 */
async function takeScreenshot(page, stage = '') {
  const domainName = new URL(page.url()).hostname;
  const tm = TimeManager.getInstance();
  const dateTime = tm.getFormattedISOString();
  const ssDir = process.env.SCREENSHOT_DIRECTORY || './screenshot';
  if (!fs.existsSync(ssDir)) {
    fs.mkdirSync(ssDir, {recursive: true});
  }
  const screenshotPath = `${ssDir}/${domainName}_${dateTime}_${stage}.png`;

  try {
    await page.screenshot({path: screenshotPath, fullPage: true});
  } catch (error) {
    console.warn(`Failed to take a full page screenshot due to ${error}`);
    try {
      await page.screenshot({path: screenshotPath}); // fullPage option is not specified
    } catch (error) {
      console.error(`Failed to take a screenshot due to ${error}`);
    }
  }

  return screenshotPath;
}

async function getLongestElement(frame, tag) {
  return await frame.evaluate((tag) => {
    const elements = Array.from(document.getElementsByTagName(tag));
    if (elements.length === 0) return null;
    return elements.reduce((longestElement, element) =>
        element.innerHTML.length > longestElement.innerHTML.length ? element : longestElement
    ).outerHTML;
  }, tag);
}

/**
 * ページ全体で最長の要素のHTMLを取得します
 * @param {Page} page
 * @param {string} tagName
 * @return {Promise<string>}
 */
async function getLongestElementHtmlAndIframeInfo(page, tagName = "form") {
  let longestElementHtml = await getLongestElement(page, tagName);

  let longestIframeElementHtml = null;
  let iframeInfo = {
    isIn: false,
    frame: null,
    url: '',
    name: '',
  };

  const frames = await page.frames();
  for (const frame of frames) {
    const iframeElementHtml = await getLongestElement(frame, tagName);
    if (iframeElementHtml && (!longestIframeElementHtml || iframeElementHtml.length > longestIframeElementHtml.length)) {
      longestIframeElementHtml = iframeElementHtml;
      iframeInfo = {
        isIn: true,
        frame: frame,
        url: frame.url(),
        name: frame.name(),
      };
    }
  }

  if (longestIframeElementHtml && (!longestElementHtml || longestIframeElementHtml.length > longestElementHtml.length)) {
    longestElementHtml = longestIframeElementHtml;
  }

  return {
    html: longestElementHtml,
    iframe: iframeInfo,
  };
}

async function setField(page, selector, tag, name, type, value, iframe) {
  // iframe内の場合はiframe内の要素を操作する
  const target = iframe.isIn ? iframe.frame : page;
  if (tag === 'input') {
    if (type === 'radio') {
      if (value === '') return // valueが空の場合はスキップ
      // valueがonは、ブラウザデフォルトの値で、valueがHTMLに設定されていない可能性が高いので、valueを指定しない
      const radioSelector = value === 'on' ?　`${tag}[name="${name}"]` : `${tag}[name="${name}"][value="${value}"]`;
      console.log(radioSelector, 'click');
      // ラジオボタンを選択
      await clickIf(target, radioSelector);
    } else if (type === 'checkbox') {
      if (value === '') return // valueが空の場合はスキップ
      // 一旦全てのチェックボックスのチェックを外す
      const checkboxes = await target.$$(selector);
      for (const checkbox of checkboxes) {
        const isChecked = await target.evaluate((el) => el.checked, checkbox);
        // チェックされてたらクリック
        if (isChecked) {
          await clickIf(target, checkbox)
        }
      }
      const checkboxSelector = value === 'on' ? `${tag}[name="${name}"]` : `${tag}[name="${name}"][value="${value}"]`;
      console.log(checkboxSelector, 'click');
      // 全てのチェックボックスが外れた後、対象のチェックボックスをクリック
      await clickIf(target, checkboxSelector);
      console.log(checkboxSelector, 'clicked');
    } else {
      // 現在の値を取得
      const currentValue = await target.$eval(selector, (el) => el.value);
      // 現在の値が送信する値と同じであればスキップ
      if (currentValue === value) {
        return;
      }
      if (currentValue !== '') {
        // 現在の値をクリア
        await target.$eval(selector, (el) => (el.value = ''));
      }
      // 値を入力
      await typeIf(target, selector, value);
    }
  } else if (tag === 'textarea') {
    try {
      await waitForSelector(target, selector);
    } catch (e) {
      console.warn('Textarea selector not found', selector);
      return;
    }
    await target.focus(selector); // テキストエリアにフォーカスを当てる
    await target.$eval(selector, (el) => (el.value = '')); // 現在の値をクリア
    await target.type(selector, value); // 新しい値を入力
  } else if (tag === 'select') {
    // セレクトボックスを選択
    await selectIf(target, selector, value);
  }
}

async function setFieldByIndex(page, field, value, iframe) {
  const target = iframe.isIn ? iframe.frame : page;
  const elements = await target.$$(`form ${field.tag}`);
  const element = elements[field.index];
  if (!element) {
    console.warn('Element not found', field);
    return;
  }
  try {
    if (field.type === 'radio' || field.type === 'checkbox') {
      await element.click();
    } else if (field.tag === 'select') {
      await element.select();
    } else if (field.tag === 'input' || field.tag === 'textarea') {
      // await element.type(value);
      await target.evaluate((el, value) => el.value = value, element, value);
    } else {
      console.warn('Unsupported tag', field);
    }
  } catch (e) {
    console.warn('Set field by index failed', field);
  }
}

async function waitForSelector(page, selector, timeout = 5000) {
  await page.waitForSelector(selector, {timeout: timeout});
}

async function waitForNavigation(page, timeout = 5000) {
  await page.waitForNavigation({timeout: timeout});
}

async function waitForTimeout(page, timeout = 5000) {
  await page.waitForTimeout(timeout);
}

async function clickIf(page, selector) {
  try {
    await waitForSelector(page, selector);
  } catch (e) {
    console.warn('Click selector not found', selector);
    return
  }
  try {
    await page.click(selector);
  } catch (e) {
    console.warn('Click failed', selector);
  }
}

async function typeIf(page, selector, value) {
  try {
    await waitForSelector(page, selector);
  } catch (e) {
    console.warn('Type selector not found', selector);
    return
  }
  try {
    await page.type(selector, value);
  } catch (e) {
    console.warn('Type failed', selector);
  }
}

async function selectIf(page, selector, value) {
  try {
    await waitForSelector(page, selector);
  } catch (e) {
    console.warn('Select selector not found', selector);
    return
  }
  try {
    await page.select(selector, value);
  } catch (e) {
    console.warn('Select failed', selector);
  }
}

module.exports = {
  launchBrowser,
  newPage,
  goto,
  handleAgreement,
  takeScreenshot,
  getLongestElementHtmlAndIframeInfo,
  setField,
  setFieldByIndex,
  waitForSelector,
  waitForNavigation,
  waitForTimeout,
};
