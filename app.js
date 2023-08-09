require('dotenv').config();

// 必要なモジュールのインポート
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// 対象のURLの定義
const url = 'https://sales-bank.com/contact/';

// メインの非同期関数の定義
async function run() {
    // ブラウザとページの設定
    const browser = await puppeteer.launch({ headless: false });
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
            if ((this.name !== 'input' && this.name !== 'textarea') && $(this).children().length === 0 && $(this).text().trim().length === 0) {
                $(this).remove();
            }  
        });
        $('select').each(function() {
            if ($(this).children('option').length > 10) {
                (this).children('option').slice(10).remove(); 
            }
        });
        try {
            longestFormHTML = $.html().replace(/\n/g, '').replace(/>\s+</g, '><');
            console.log(longestFormHTML);

            const promptContent = `HTMLを解析して、以下の項目に対応する"name"属性を見つけてください。期待するJSON形式は以下のような構造です:
            {
              "fields": [
                {"items": [{"name": "企業名", "value": "name_attribute_here", "type": "input_type_here"}]}
                // 他の項目も同様に
              ]
            }
            valueは下記のいずれかを推論して選択してください。一歩づつ段階的に考えて実行してください。
            company,name,kanjiFirstname,kanjiLastname,huriFirstname,huriLastname,email,電話番号,postCode,address,contenttype,sendtype,otherContents.
            各項目はinputタグの"name"属性に対応していると考えられます。
            以下の形式でJSONを返してください。
            \`\`\`json
            {
              "fields": [
                {"items": [{"name": "企業名", "value": "name_attribute_here", "type": "input_type_here"}]}
                // 他の項目も同様に
              ]
            }
            解析するHTMLは以下の通りです: ${longestFormHTML}
            \`\`\``
            
            const completion = await openai.createChatCompletion({
                model: "gpt-4",
                messages: [
                    {"role": "system", "content": "あなたは世界でも有数のエンジニアです。特にHTMLの解析を得意としております。"},
                    {"role": "user", "content": promptContent}
                ],
            });

            console.log(completion.data.choices[0].message);

            const responseContent = completion.data.choices[0].message.content;
            const jsonString = responseContent.match(/```json\s+([^`]+)```/)[1];
            const extractedJSON = JSON.parse(jsonString);
            console.log(JSON.stringify(extractedJSON, null, 2));

            const dataToSend = {
                company: "営業製作所株式会社",
                name: "西島本　周",
                kanjiFirstname:"西島本",
                kanjiLastname:"周",
                huriFirstname: "にししまもと",
                huriLastname: "しゅう",
                email: "nishishimamoto@sales-bank.com",
                電話番号: "080-4024-7677",
                postCode: "550-0002",
                address: "大阪府大阪市西区江戸堀1-22-38　三洋ビル501",
                contenttype: "テスト",
                sendtype: "メール",
                otherContents: "テスト"
            };


            const extractedFields = extractedJSON.fields; 
            const extractedFieldsString = JSON.stringify(extractedFields);
            page.on('console', msg => console.log('PAGE LOG:', msg.text()));
            await page.evaluate((dataToSend, extractedFieldsString) => {
                const extractedFields = JSON.parse(extractedFieldsString);
                console.log("Inside evaluate, extractedFields:", JSON.stringify(extractedFields, null, 2));
                for (const field of extractedFields) {
                    for (const item of field.items) {
                        const fieldName = item.value;
                        const value = dataToSend[fieldName];
                        if (value) {
                            const inputElements = document.querySelectorAll(`input[name="${fieldName}"], textarea[name="${fieldName}"], select[name="${fieldName}"]`);
                            for (const inputElement of inputElements) {
                                if (inputElement.type === 'radio' || inputElement.type === 'checkbox') {
                                    if (inputElement.value === value) {
                                        inputElement.checked = true;
                                    }
                                } else if (inputElement.tagName === 'SELECT') {
                                    for (const option of inputElement.options) {
                                        if (option.value === value) {
                                            option.selected = true;
                                        }
                                    }
                                } else {
                                    // For other input types, simply set the value
                                    inputElement.value = value;
                                }
                            }
                        }
                    }
                }
            }, dataToSend, extractedFieldsString);

            const confirmButton = await page.$('button[name="submitConfirm"]');
            if (confirmButton) {
                await confirmButton.click();
                await page.waitForNavigation({ timeout: 30000 });
            }

            const submitButton = await page.$('button[name="subBtn"]');
            if (submitButton) {
                await Promise.all([
                    page.waitForNavigation({ timeout: 30000 }),
                    submitButton.click(),
                ]);
            }
            await page.waitForSelector('h3.title', { timeout: 30000 });
        } catch (error) {
            console.error("エラーが発生しました:", error);
        }
    }

    //await browser.close();
}

run().catch(console.error);
