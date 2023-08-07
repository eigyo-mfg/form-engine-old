// 必要なモジュールのインポート
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

// 対象のURLの定義
const url = 'https://www.system-keisoku.co.jp/inquiry/';

// メインの非同期関数の定義
async function run() {
    // ブラウザとページの設定
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    // リクエストの監視設定
    await page.setRequestInterception(true);
    page.on('request', (req) => {
         // Google Analyticsと画像、スタイルシート、フォントのリクエストを中止
        if (req.url().includes('www.google-analytics.com')) {
            req.abort();
        } else if (['image', 'stylesheet', 'font'].indexOf(req.resourceType()) !== -1) {
            req.abort();
        } else {
            req.continue();
        }
    });
    // ページへの移動と要素のクリック
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });

    try {
        // チェックボックスと同意ボタンのクリック処理
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
    // formタグを抽出
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
    // formタグが見つからない場合、iframe内のformタグを抽出
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
    // 複数HTMLが取得されている場合は長いHTMLを優先
    let longestFormHTML = formsHTML.reduce((a, b) => a.length > b.length ? a : b, "");
    // 最後にformが見つかっていない場合は生のHTMLを取得しform-form部分を抜き出す
    if (longestFormHTML .length === 0) {
        console.log("No form found in the initial HTML. Trying to fetch raw HTML...");
        await page.setRequestInterception(true);
        let responseProcessingPromise = null;
        page.on('response', async (response) => {
            if (response.url() === url && response.request().resourceType() === 'document') {
                responseProcessingPromise = (async () => {
                    const source_website_html_content = await response.text();
                    const startIndex = source_website_html_content.indexOf('form');
                    const endIndex = source_website_html_content.lastIndexOf('form') + 'form'.length;
                    const formHTML = source_website_html_content.slice(startIndex, endIndex);
                    const $ = cheerio.load(formHTML);
                    if ($('input').length > 1 &&
                    $('input[type="search"], input[name="q"], input[placeholder="検索"]').length === 0) {
                        return formHTML;
                    } else {
                        return "";
                    }
                })();
            }
        });
        await page.goto(url);
        await page.setRequestInterception(true);
        if (responseProcessingPromise) {
            longestFormHTML = await responseProcessingPromise; // 戻り値をlongestFormHTMLに代入
        }
    }
    if (longestFormHTML.length === 0) {
        console.log("No form found. Exiting...");
        
} else {
    // 不要なHTMLを削除し短文化
    $ = cheerio.load(longestFormHTML);
    $('*').contents().each(function() {
        if (this.type === 'comment') $(this).remove();
    });
    $('img, br, a').remove();
    $('*').each(function() {
        if (this.name !== 'input' && $(this).children().length === 0 && $(this).text().trim().length === 0) {
            $(this).remove();
        }
    });
    $('select').each(function() {
        if ($(this).children('option').length > 10) {
            $(this).children('option').remove();
        }
    });
        longestFormHTML = $.html().replace(/\n/g, '').replace(/>\s+</g, '><');
        console.log(longestFormHTML);
    }

    await browser.close();
}

run().catch(console.error);
