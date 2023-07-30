const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios'); // axiosをインポート
const iconv = require('iconv-lite'); // iconv-liteをiconvという名前でインポート

const url = 'https://www.shoei-corp.co.jp/contact/index.html'; // URLを変数に格納

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

    await page.goto(url, { waitUntil: 'networkidle0' }); // 変数urlを使用

    const html = await page.content();
    const $ = cheerio.load(html);

    let formsHTML = [];
    $('form').each(function() {
        // Check if the form is not a search form
        if ($(this).find('input[type="search"], input[name="q"], input[placeholder="検索"]').length === 0) {
            formsHTML.push($(this).html());
        }
    });

    console.log(formsHTML);

    // If no form is found, look for iframe
    if (formsHTML.length === 0) {
        const iframes = await page.$$('iframe');
        for (let iframe of iframes) {
            try {
                const frame = await iframe.contentFrame();
                await frame.waitForSelector('form', { timeout: 5000 });

                const iframeHTML = await frame.content();
                const $iframe = cheerio.load(iframeHTML);
                $iframe('form').each(function() {
                    // Check if the form is not a search form
                    if ($iframe(this).find('input[type="search"], input[name="q"], input[placeholder="検索"]').length === 0) {
                        formsHTML.push($iframe(this).html());
                    }
                });
            } catch (error) {
                console.log('No form found in this iframe');
            }
        }
    }

    // If no form is found, look for agreement button
    if (formsHTML.length === 0) {
        try {
            const [button] = await page.$x("//input[@value='同意します' or @value='同意する' or @value='同意しますか？'] | //a[contains(descendant::text(), '同意します') or contains(descendant::text(), '同意する') or contains(descendant::text(), '同意しますか？')]");
            if (button) {
                await button.click();
                await page.waitForNavigation({ waitUntil: 'networkidle0' });
                const newHtml = await page.content();
                const $new = cheerio.load(newHtml);
                $new('form').each(function() {
                    // Check if the form is not a search form
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

    // Find the longest form HTML
    let longestFormHTML = formsHTML.reduce((a, b) => a.length > b.length ? a : b, "");

    // Check if the HTML is malformed
    const malformedHtmlRegex = /<([a-z][a-z0-9]*)\b[^>]*>(.*?)<\/\1>/g;
    if (!malformedHtmlRegex.test(longestFormHTML)) {
        console.log("The HTML is malformed. Executing alternative process...");

        // Use axios to get raw HTML
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const rawHtml = iconv.decode(Buffer.from(response.data), 'Shift_JIS'); // Shift-JISからUTF-8に変換

        // Extract form content from raw HTML using regex
        const formRegex = /<form[^>]*>([\s\S]*?)<\/form>/gi;
        let match;
        while ((match = formRegex.exec(rawHtml)) !== null) {
            console.log("Found a form: ", match[0]);
        }
    } else {
        console.log(longestFormHTML);
    }

    await browser.close();
}

run().catch(console.error);
