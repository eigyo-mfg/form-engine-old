const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');
const iconv = require('iconv-lite');

const url = 'https://www.e-sunfarm.co.jp/login/inquiryedit';

async function run() {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (req.url().includes('www.google-analytics.com')) {
            req.abort();
        } else if (['image', 'stylesheet', 'font'].indexOf(req.resourceType()) !== -1) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });

    try {
        const [checkbox] = await page.$x("//input[@type='checkbox']");
        if (checkbox) {
            await checkbox.click();
        }
        const [button] = await page.$x("//input[contains(@value, '同意') or @type='image'] | //a[contains(text(), '同意')] | //span[contains(text(), '同意')]");
        if (button) {
            const navigationPromise = page.waitForNavigation({timeout: 10000});
            await button.click();
            await navigationPromise;
        }
    } catch (error) {
        console.log('No agreement button found');
    }

    const html = await page.content();
    let $ = cheerio.load(html);
    let formsHTML = [];
    $('form').each(function() {
        if ($(this).find('input').length > 1) {
            if ($(this).find('input[type="search"], input[name="q"], input[placeholder="検索"]').length === 0) {
                formsHTML.push($(this).html());
            }
        }
    });

    if (formsHTML.length === 0) {
        const iframes = await page.$$('iframe');
        for (let iframe of iframes) {
            try {
                const frame = await iframe.contentFrame();
                await frame.waitForSelector('form', { timeout: 5000 });

                const iframeHTML = await frame.content();
                const $iframe = cheerio.load(iframeHTML);
                $iframe('form').each(function() {
                    if ($iframe(this).find('input').length > 1) {
                        formsHTML.push($iframe(this).html());
                    }
                });
            } catch (error) {
                console.log('No form found in this iframe. Error:', error);
            }
        }
    }

    if (formsHTML.length === 0) {
        console.log("No form found. Exiting...");
        await browser.close();
        return;
    }

    let longestFormHTML = formsHTML.reduce((a, b) => a.length > b.length ? a : b, "");

    const malformedHtmlRegex = /<([a-z][a-z0-9]*)\b[^>]*>(.*?)<\/\1>/g;
    if (!malformedHtmlRegex.test(longestFormHTML)) {
        console.log("The HTML is malformed. Executing alternative process...");

        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const rawHtml = iconv.decode(Buffer.from(response.data), 'Shift_JIS');

        const formRegex = /<form[^>]*>([\s\S]*?)<\/form>/gi;
        let match;
        while ((match = formRegex.exec(rawHtml)) !== null) {
            console.log("Found a form: ", match[0]);
    }
} else {
    $ = cheerio.load(longestFormHTML);
    $('*').contents().each(function() {
        if (this.type === 'comment') $(this).remove();
    });
    $('img, br, a').remove();
    $('*').each(function() {
        if ($(this).children().length === 0 && $(this).text().trim().length === 0) {
            $(this).remove();
        }
    });
    $('select').each(function() {
        if ($(this).children('option').length > 10) {
            $(this).children('option').remove();
        }
    });

        // Remove newlines and spaces between tags
        longestFormHTML = $.html().replace(/\n/g, '').replace(/>\s+</g, '><');

        console.log(longestFormHTML);
    }

    await browser.close();
}

run().catch(console.error);
