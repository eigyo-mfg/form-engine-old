const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');
const iconv = require('iconv-lite');

const url = 'https://www.nttdata-kansai.co.jp/form/inquiry/';

async function run() {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (req.url().includes('www.google-analytics.com')) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.goto(url, { waitUntil: 'networkidle0' });

    const html = await page.content();
    let $ = cheerio.load(html);

    let formsHTML = [];
    $('form').each(function() {
        if ($(this).find('input[type="search"], input[name="q"], input[placeholder="検索"]').length === 0) {
            formsHTML.push($(this).html());
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
                    if ($iframe(this).find('input[type="search"], input[name="q"], input[placeholder="検索"]').length === 0) {
                        formsHTML.push($iframe(this).html());
                    }
                });
            } catch (error) {
                console.log('No form found in this iframe');
            }
        }
    }

    if (formsHTML.length === 0) {
        try {
            const [button] = await page.$x("//input[@value='同意します' or @value='同意する' or @value='同意しますか？'] | //a[contains(text(), '同意します') or contains(text(), '同意する') or contains(text(), '同意しますか？')]");
            if (button) {
                await button.click();
                await page.waitFor(3000);
                const newHtml = await page.content();
                const $new = cheerio.load(newHtml);
                $new('form').each(function() {
                    if ($new(this).find('input[type="search"], input[name="q"], input[placeholder="検索"]').length === 0) {
                        formsHTML.push($new(this).html());
                    }
                });
            }
        } catch (error) {
            console.log('No agreement button found');
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

        // Remove comments
        $('*').contents().each(function() {
            if (this.type === 'comment') $(this).remove();
        });

        // Remove unnecessary tags
        $('img, br, a').remove();

        // Remove empty elements
        $('*').each(function() {
            if ($(this).children().length === 0 && $(this).text().trim().length === 0) {
                $(this).remove();
            }
        });

        // Remove options if more than 10
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
