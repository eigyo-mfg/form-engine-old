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
            //送信したい内容
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

            //GPT-4のAPIを活用し、フィールドを作成
            const promptContent = `HTMLを解析して、以下のデータを入力するための情報を生成してください。
            以下のデータを使用して、各フィールドに対応する値を特定してください。
            ${JSON.stringify(dataToSend, null, 2)}
            この情報は、特定のjsonフォーマットで提供してください：
            {
              "fields": [
                // text, email, textareaなどのフィールド：{"name": "dataToSendの対応するキー名", "value": "HTMLの対応する属性名", "type": "input_type_here"}
                // radioやselectなどのフィールド：{"name": "dataToSendの対応するキー名", "value": "HTMLの対応する属性名", "type": "input_type_here", "selectedValue": "選択する値"}
              ],
              "submit": "送信ボタンのセレクタ" // 例：button[name="submitName"]
            }
            必ず【全て】のtext, textarea, selectを推論して埋めてください。
            radioやcheckboxは特定の値を全て選択してください。
            また、送信ボタンのセレクタを特定してください。
            dataToSendの内容は多めに用意しているので全て使用しなくていいです。
            問い合わせ内容はtextareaの可能性が高いです。
            解析するHTMLは以下の通りです: ${longestFormHTML}`;
            
            
            const completion = await openai.createChatCompletion({
                model: "gpt-4",
                messages: [
                    {"role": "system", "content": "あなたは世界でも有数のエンジニアです。特にHTMLの解析を得意としております。"},
                    {"role": "user", "content": promptContent}
                ],
            });

            // GPT-4からのレスポンス
            const responseContent = completion.data.choices[0].message.content;
            console.log(responseContent);

            // 最初の波括弧 '{' のインデックスを取得
            const startIndex = responseContent.indexOf('{');
            
            // 最後の波括弧 '}' のインデックスを取得
            const endIndex = responseContent.lastIndexOf('}');
            
            // 開始インデックスと終了インデックスを使用してJSON文字列を抽出
            const jsonStr = responseContent.substring(startIndex, endIndex + 1);
            
            // JSON文字列をパース
            const formData = JSON.parse(jsonStr);
            
            console.log(formData); // ここでformDataには必要な部分がJavaScriptオブジェクトとして格納されています
            
            for (const field of formData.fields) {
                const valueToSend = dataToSend[field.name]; // 対応する値を取得
                switch (field.type) {
                  case 'text':
                  case 'email':
                  case 'date':
                  case 'month':
                  case 'number':
                  case 'tel':
                  case 'time':
                  case 'url':
                  case 'week':
                    await page.type(`input[name="${field.value}"]`, valueToSend); // 値を入力
                    break;
                  case 'radio':
                    await page.click(`input[name="${field.value}"][value="${field.selectedValue}"]`); // ラジオボタンを選択
                    break;
                  case 'checkbox':
                    if (field.selectedValue) { // チェックボックスが選択されている場合
                      await page.click(`input[name="${field.value}"]`);
                    }
                    break;
                  case 'select':
                    await page.select(`select[name="${field.value}"]`, field.selectedValue); // セレクトボックスを選択
                    break;
                  case 'textarea':
                    await page.type(`textarea[name="${field.value}"]`, valueToSend); // テキストエリアに値を入力
                    break;
                  // 他のタイプに対応する場合、ここに追加のケースを追加します
                }
                // 3秒から5秒のランダムな待機時間を追加
                const milliseconds = Math.floor(Math.random() * 2000) + 3000;
                await new Promise(r => setTimeout(r, milliseconds));
            }

            // フォームの入力が完了した後、送信ボタンをクリックする前にスクリーンショットを撮る
                // ページの全体の高さと幅を取得
            const bodyHandle = await page.$('body');
            const { width, height } = await bodyHandle.boundingBox();
            await bodyHandle.dispose();

            // viewportをページ全体のサイズに設定
            await page.setViewport({ width: Math.ceil(width), height: Math.ceil(height) });

            // スクリーンショットを撮る
            const domainName = new URL(url).hostname; // URLからドメイン名を取得
            const dateTime = new Date().toISOString().replace(/[:\-]/g, ''); // 現在の日時を取得
            const screenshotPath = `/Users/nishishimamotoshu/Desktop/screenshot/${domainName}_${dateTime}.png`; // 保存先のパスを組み立てる

            await page.screenshot({ path: screenshotPath, fullPage: true }); // スクリーンショットを撮る

            // viewportを元に戻す（必要に応じて）
            await page.setViewport({ width: 800, height: 600 });
            await page.click(formData.submit);

            const buttons = await page.$$('button, input[type="submit"]'); // button要素とinput type="submit"要素を取得
            for (const button of buttons) {
                const buttonText = await page.evaluate(el => el.textContent || el.value, button); // ボタンのテキスト内容またはvalue属性を取得
                console.log(buttonText); // テキスト内容をログに出力
                if (buttonText.includes('送信') || buttonText.includes('内容') || buttonText.includes('確認')) {
                    await button.click();
                    break; // 最初に見つかったボタンをクリックした後、ループを抜ける
                }               
            }
        } catch (error) {
            console.error("エラーが発生しました:", error);
        }
    }
    // await browser.close();
}

run().catch(console.error);
