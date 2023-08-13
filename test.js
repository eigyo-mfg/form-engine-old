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
    const result = await processOnInput(page);
    console.log(result); // 出力結果をログに表示

    async function processOnInput(page) {
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
            $ = cheerio.load(longestFormHTML);
            const fields = [];
                // フィールドの解析関数
            const parseField = (el, type) => {
                const name = $(el).attr('name') || $(el).attr('id') || $(el).attr('class');
                const value = name; // value変数にnameの値を割り当てる
                const field = { name: value, value: name, type: type };
                console.log("Parsed Field:", field); // ここで解析結果をログ出力
                fields.push({ name: value, value: name, type: type });
            };
        
            // text, email, textareaなどのフィールドを解析
            $('input[type="text"], input[type="email"], input[type="date"], input[type="month"], input[type="number"], input[type="tel"], input[type="time"], input[type="url"], input[type="week"], textarea').each(function() {
                parseField(this, $(this).attr('type') || 'textarea');
            });
        
            // radioやselectなどのフィールドを解析
            $('input[type="radio"], input[type="checkbox"]').each(function() {
                const type = $(this).attr('type');
                const selectedValue = $(this).attr('value');
                parseField(this, type);
                fields[fields.length - 1].selectedValue = selectedValue; // 最後に追加したフィールドに選択値を追加
            });

            // selectフィールドの解析
            $('select').each(function() {
                const type = 'select';
                const selectedValue = $(this).find('option:selected').val();
                parseField(this, type);
                fields[fields.length - 1].selectedValue = selectedValue; // 最後に追加したフィールドに選択値を追加
            });

            // optionフィールドの解析（特定のケースで必要な場合）
            $('option').each(function() {
                const type = 'option';
                const selectedValue = $(this).attr('value');
                parseField(this, type);
                fields[fields.length - 1].selectedValue = selectedValue; // 最後に追加したフィールドに選択値を追加
            });
        
            // 送信ボタンのセレクタを探す
            const submit = $('button[type="submit"], input[type="submit"]').attr('name') || 'button[type="submit"]';

            const dataToSend = {
                企業名: "営業製作所株式会社",
                氏名: "安田　美佳",
                漢字性:"安田",
                漢字名:"美佳",
                ふりがな性: "やすだ",
                ふりがな名: "みか",
                メール: "nishishimamoto@sales-bank.com",
                電話: "06-6136-8027",
                郵便番号: "550-0002",
                住所: "大阪府大阪市西区江戸堀1-22-38　三洋ビル501",
                返信方法: "メール",
                問い合わせ分類: "サービスについて",
                問い合わせ内容:
                "テストです。\n安田です。\n美佳です。\n二人合わせて安田美佳です。"
            };

            async function mapFieldToData(fields, dataToSend) {
                const fieldsJsonString = JSON.stringify({ fields: fields }, null, 2);
                const promptContent = `
                    以下のフィールドとデータを解析し、フィールド名とデータの対応関係を構築してください。
                    解析対象のフィールド情報:
                    ${fieldsJsonString}
                    解析対象のデータ:
                    ${JSON.stringify(dataToSend, null, 2)}
            
                    解析結果を以下のJSONフォーマットで提供してください:
                    {
                        "fields": [
                            // text, email, textareaのフィールド：{"name": "dataToSendのキー名", "value": "フィールド属性名", "type": "フィールドのtype"}
                            // radio, selectのフィールド：{"name": "dataToSendのキー名", "value": "フィールド属性名", "type": "フィールドのtype", "selectedValue": "選択値"}
                        ],
                        "submit": "送信ボタンのセレクタ" // 例：button[name="submitName"]
                    }
            
                    全てのtext, email, textareaフィールドを正確にマッピングしてください。
                    radioやcheckboxは与えられた情報に基づいて選択値を指定してください。
                    送信ボタンのセレクタも正確に特定してください。
                    問い合わせ内容はtextareaのフィールドとして解析する可能性が高いです。
                    dataToSendの内容は全て使用しなくても構いません。
                `;
                console.log("Prompt Content:", promptContent);
            
                const completion = await openai.createChatCompletion({
                    model: "gpt-4",
                    messages: [
                        {"role": "system", "content": "あなたは世界でも有数のエンジニアです。特にHTMLの解析を得意としております。"},
                        {"role": "user", "content": promptContent}
                    ]
                });            
                const mappedName = completion.data.choices[0].message.content;
                console.log("Mapped Name:", mappedName); 
                return mappedName;

            }
            async function processFields(fields, dataToSend) {
                const mappedData = await mapFieldToData(fields, dataToSend); // 全フィールドの対応情報を取得
                mappedData.fields.forEach((field, index) => {
                  fields[index].value = field.value; // フィールドのvalueを更新
                });
                return { fields: fields, submit: mappedData.submit };
            }
              
            const updatedFields = await processFields({ fields: fields, submit: submit }, dataToSend);
            console.log(updatedFields);
            
            return {
                fields: fields,
                submit: submit
            };
        }
    }
}

run().catch(error => console.error(error));
