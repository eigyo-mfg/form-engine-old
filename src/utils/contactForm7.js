const {waitForTimeout} = require("./puppeteer");

async function isContactForm7(page) {
    // Contact Form 7の要素があるかどうかを判定
    const existContactForm7 = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('div.wpcf7'));
        return elements.length > 0;
    });
    return existContactForm7;
}

async function submitContactForm7(page) {
    // Contact Form 7の送信ボタンをクリック
    await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('input.wpcf7-form-control.wpcf7-submit'));
        elements[0].click();
    });
    // 送信完了まで待機
    await waitForTimeout(page, 5000);
}

async function isSucceedSendContactForm7(page) {
    // Contact Form 7が送信され、送信完了メッセージが確認できる
    const thanksMessages = ['有難う','有り難う','有りがとう','ありがとう','完了','送信','Thank You','Thanks'];
    const isSucceed = await page.evaluate((thanksMessages) => {
        const elements = Array.from(document.querySelectorAll('div.wpcf7-response-output'));
        return elements.some(element => thanksMessages.some(thanksMessage => element.innerText.includes(thanksMessage)));
    }, thanksMessages);
    return isSucceed;
}

module.exports = {
    isContactForm7,
    submitContactForm7,
    isSucceedSendContactForm7,
}