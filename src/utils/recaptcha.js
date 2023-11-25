async function existRecaptcha(page) {
  // reCAPTCHAの要素があるかどうかを判定
  const existRecaptcha = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('div.g-recaptcha'));
    return elements.length > 0;
  });
  return existRecaptcha;
}

module.exports = {
  existRecaptcha,
};
