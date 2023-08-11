require('dotenv').config();

// 必要なモジュールのインポート
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const maxTrials = 2;

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

    await mainProcess(page);

    async function mainProcess(page) {
        let state = 'INPUT';
        let trial = 0;
        while (state !== 'COMPLETE' && trial < maxTrials) {
            switch (state) {
                case 'INPUT':
                    trial++;
                    await processOnInput(page);
                    break;
                case 'CONFIRM':
                    await processOnConfirm(page);
                    break;
                case 'COMPLETE':
                    await processOnComplete(page);
                    break;
                case 'ERROR':
                    state = await processOnError(page); // エラー処理後に状態を更新
                    continue; // 次の繰り返しに直ちに進む
            }
    
            state = await currentState(page);
            if (trial >= maxTrials) {
                console.log("Max trials reached, exiting...");
            }
        }

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
                    //スクリーンショットを撮る
                    await takeScreenshot(page, 'input');

                    // viewportを元に戻す（必要に応じて）
                    await page.setViewport({ width: 800, height: 600 });
                    await page.click(formData.submit);
                } catch (error) {
                console.log("An error occurred during input processing:", error);
            }
            }

        }

        async function currentState(page) {
            // HTMLテキスト情報を取得
            await page.waitForSelector('body', { timeout: 30000 }); // タイムアウトを30秒に設定
            const bodyHandle = await page.$('body');
            const htmlTextContent = await page.evaluate(body => body.textContent, bodyHandle);
            const cleanedHtmlTextContent = htmlTextContent
                .replace(/\s+/g, ' ') // 連続する空白を一つの空白に置換
                .replace(/\n+/g, ' ') // 改行を空白に置換
                .trim(); // 文字列の先頭と末尾の空白を削除
            console.log(cleanedHtmlTextContent )
            await bodyHandle.dispose();
        
            const currentPageUrl = page.url();

                    // クエリのメッセージを定義
            const messages = [
                { "role": "system", "content": " あなたは世界でも有数のアシスタントです。特にHTMLの解析を得意としております。" },
                { "role": "user", "content": `このbodyのテキスト内容とURL(${currentPageUrl})から、ページの位置を次の形式でjsonとして返してください。
                "確認画面"の特徴としては、"確認","内容","最終"というキーワードやそれに近しい文字が入っている可能性が高い。
                "完了"の特徴としては、"送信完了","ありがとうございます","送信されました"というキーワードやそれに近しい文字が入っている可能性が高い。
                必ず下記フォーマットに従って返してください。
                "入力画面","確認画面","完了","エラー"のいずれか一つを必ず選択してください。
                    {
                    "位置": "入力画面" または "確認画面" または "完了" または "エラー"
                    }
                    : bodyのテキスト内容は下記です。
                    ${cleanedHtmlTextContent}` }
            ];
        
            // クエリを送信
            const completion = await openai.createChatCompletion({
                model: "gpt-3.5-turbo",
                messages: messages,
            });
        
            // 応答に基づいて状態を返す
            const responseMessage = completion.data.choices[0].message;
            console.log("Response message type:", typeof responseMessage);
            console.log("Response message content:", responseMessage);
            const responseContentString = responseMessage.content.match(/\{[^\}]+\}/)[0];
            const responseContent = JSON.parse(responseContentString);
            const currentState = responseContent["位置"];
            console.log('Detected state:', currentState);            
        
            if (currentState === '入力画面') return 'INPUT';
            if (currentState === '確認画面') return 'CONFIRM';
            if (currentState === '完了') return 'COMPLETE';
            if (currentState === 'エラー') return 'ERROR';
        
            // 予期しない応答があればデフォルト状態を返す
            return 'UNKNOWN';
        }
 

        async function processOnConfirm(page) {
            const buttons = await page.$$('button, input[type="submit"]'); // button要素とinput type="submit"要素を取得
            for (const button of buttons) {
                const buttonText = await page.evaluate(el => el.textContent || el.value, button); // ボタンのテキスト内容またはvalue属性を取得
                if (buttonText.includes('送信') || buttonText.includes('内容') || buttonText.includes('確認')) {
                    //スクリーンショット撮る
                    await takeScreenshot(page, 'confirm');
                    
                    console.log('Clicking the button:', buttonText);
                    const navigationPromise = page.waitForNavigation({ timeout: 10000 });
                    await button.click();
                    await navigationPromise; // ページの遷移を待つ
                    break; // 最初に見つかったボタンをクリックした後、ループを抜ける
                }
            }
        }
        async function processOnError(page) {
            console.log("An error state has been detected!");        
            // スクリーンショットを撮る
            await takeScreenshot(page, 'error');
        
            return 'INPUT';
        }

        async function takeScreenshot(page, stage = '') {
            const bodyHandle = await page.$('body');
            const { width, height } = await bodyHandle.boundingBox();
            await bodyHandle.dispose();
        
            await page.setViewport({ width: Math.ceil(width), height: Math.ceil(height) });
        
            const domainName = new URL(page.url()).hostname;
            const dateTime = new Date().toISOString().replace(/[:\-]/g, '');
            const screenshotPath = `/Users/nishishimamotoshu/Desktop/screenshot/${domainName}_${dateTime}_${stage}.png`;
        
            await page.screenshot({ path: screenshotPath, fullPage: true });
        }
    }
    await browser.close();                          
}

run().catch(console.error);
