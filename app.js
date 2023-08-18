require('dotenv').config();

// 必要なモジュールのインポート
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const maxProcessOnInputTrials = 2;
const maxTotalTrials = 5;
const db = require('./firestore');

//送りたい内容。プロジェクトごとに値は変更可能
const dataToSend = {
    "company_name": "営業製作所株式会社",
    "contact_person": "安田　美佳",
    "contact_person_kana": "やすだ　みか",
    "last_name_kanji": "安田",
    "first_name_kanji": "美佳",
    "last_name_kana": "やすだ",
    "first_name_kana": "みか",
    "email": "m.yasuda@sales-bank.com",
    "phone": "06-6136-8027",
    "phone_area_code": "06",
    "phone_prefix": "6136",
    "phone_line_number": "8027",
    "postal_code": "550-0002",
    "postal_code_prefix": "550",
    "postal_code_suffix": "0002",
    "city":"大阪市",
    "address": "大阪府大阪市西区江戸堀1-22-38　三洋ビル501",
    "date_of_birth": "1992年4月14日",
    "reply_method": "メール",
    "department": "営業部",
    "position": "主査",
    "subject": "【製造業7,000名の担当者から廃材回収のニーズを頂戴しております】",
    "inquiry_content": 
    "代表者様 \nお世話になります。\n営業製作所の安田と申します。\n\n製造業の担当者7,000名から廃材回収に関するニーズを頂戴しております\n具体的なニーズの有無まで調査行い、ご紹介が可能ですのでご連絡させていただきました。\n\n弊社は、製造業に特化した事業を展開しており、 サービスリリース2年で500社の企業様にご活用いただいております。\n\n貴社の回収しやすい【材質】【大きさ】【形状】【重量】を満たす、取引先を発掘することが可能です。 \n同業他社での実績や貴社に合致したレポートをご用意しておりますので、ご興味をお持ち頂ける場合はお電話にて詳細をお伝えします。\n\n 下記メールアドレスにお電話可能な日時をお送りくださいませ。\n\n ■メールアドレス m.yasuda@sales-bank.com \n■弊社パンフレット https://tinyurl.com/239r55dc \nそれではご連絡お待ちしております。"
};

// Google Sheets APIの初期化
const { google } = require('googleapis');
const keys = require('./spread.json');

const client = new google.auth.JWT(
  keys.client_email,
  null,
  keys.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

client.authorize(function (err, tokens) {
  if (err) {
    console.log(err);
    return;
  } else {
    console.log('Connected to Google Sheets API');
  }
});

const gsapi = google.sheets({ version: 'v4', auth: client });

async function getUrls() {
    const sheetId = '11wyDbzPIcTi4bS0lnuDJVrvUjgVKirzTKScsJ4iNZgc'; // スプレッドシートのIDをここに入力
    const request = {
      spreadsheetId: sheetId,
      range: 'Sheet1!D:D', // D列を指定
    };
  
    let response = await gsapi.spreadsheets.values.get(request);
    let urls = response.data.values.flat().slice(1);
    console.log(urls); // この行を追加
    return urls;
}

// メインの非同期関数の定義
async function run(urls) { // 引数にurlsを追加
    const browser = await puppeteer.launch({ headless: false });
    for (const url of urls) { // URLの配列をループ
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
      await mainProcess(page);
      await page.close();
    }
  
    await browser.close();
  }
  run().catch(console.error);
  
  // 以下の部分でgetUrls関数を呼び出してURLを取得し、それをrun関数に渡します。
getUrls().then(urls => {
    run(urls).catch(console.error);
});


//主要なループ関数
async function mainProcess(page) {
    let state = 'INPUT';
    let processOnInputTrial = 0;
    let totalTrial = 0;
    let formData; // formDataを保存するための変数
    while (state !== 'DONE' && totalTrial < maxTotalTrials) {
        switch (state) {
            case 'INPUT':
                if (processOnInputTrial < maxProcessOnInputTrials) {
                    processOnInputTrial++;
                    formData = await processOnInput(page); // formDataを受け取る
                } else {
                    console.log("Max processOnInput trials reached, skipping...");
                }
                break;
            case 'CONFIRM':
                await processOnConfirm(page);
                break;
            case 'COMPLETE':
                await processOnComplete(page);
                state = 'DONE'; 
                continue; // この状態でループを再開する
            case 'ERROR':
                state = await processOnError(page); // エラー処理後に状態を更新
                continue; // 次の繰り返しに直ちに進む
        }

        state = await currentState(page, formData);
        console.log('State in mainProcess:', state);
        totalTrial++;
        if (totalTrial >= maxTotalTrials) {
            console.log("Max total trials reached, exiting...");
        }
    }
}

//フォーム入力過程の関数
async function processOnInput(page) {
await handleAgreementButton(page);
const longestFormHTML = await extractFormHTML(page);
if (longestFormHTML === undefined) {
    console.log("Error: longestFormHTML is undefined.");
    return;
}
if (longestFormHTML.length === 0) {
    console.log("No form found. Exiting...");
    return;
}
const { fields, submit } = analyzeFields(longestFormHTML);

const originalInquiryContent = dataToSend.inquiry_content;
dataToSend.inquiry_content = dataToSend.inquiry_content.substring(0, 40);
const promptContent = createMappingPrompt(fields, submit, dataToSend);
const formData = await requestAndAnalyzeMapping(promptContent);
formatAndLogFormData(formData, originalInquiryContent);
await fillFormFields(page, formData, dataToSend, originalInquiryContent);
await submitForm(page, formData);

return formData;
}

//確認過程を処理する関数
async function processOnConfirm(page) {
    const buttons = await page.$$('button, input[type="submit"]'); // button要素とinput type="submit"要素を取得
    for (const button of buttons) {
        const buttonText = await page.evaluate(el => el.textContent || el.value, button); // ボタンのテキスト内容またはvalue属性を取得
        if (buttonText.includes('送信') || buttonText.includes('内容') || buttonText.includes('確認')) {
            //スクリーンショット撮る
            await takeScreenshot(page, 'confirm');
            
            const navigationPromise = page.waitForNavigation({ timeout: 10000 });
            await button.click();
            await navigationPromise; // ページの遷移を待つ
            break; // 最初に見つかったボタンをクリックした後、ループを抜ける
        }
    }
}

//エラー過程を処理する関数
async function processOnError(page) {
    console.log("An error state has been detected!");        
    // スクリーンショットを撮る
    await takeScreenshot(page, 'error');
    return 'INPUT';
}

//完了過程を処理する関数
async function processOnComplete(page){
    console.log("Complete!");        
    // スクリーンショットを撮る
    await takeScreenshot(page, 'complete');
    return 'DONE';
}
    

//入力前に同意ボタンを見つけてクリックする関数
async function handleAgreementButton(page) {
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
}

//formのHTMLを抜き出す関数
async function extractFormHTML(page) {
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
    return longestFormHTML; // 最長のフォームHTMLを返す
}

//cheerioで解析後fieldsを生成
function analyzeFields(longestFormHTML) { 
    // HTMLからfieldsを作成
    const $ = cheerio.load(longestFormHTML);
    const fields = [];
    
    const parseField = (el, type) => {
        const name = $(el).attr('name') || $(el).attr('id') || $(el).attr('class');
        const value = name;
        // ①labelとinput等が親子関係になく、forとidで関連付けの場合
        let label = $(`label[for="${name}"]`).text() || $(`label[for="${$(el).attr('id')}"]`).text() || '';
        // ②labelとinput等が親子関係の場合
        if (label === '') {
            label = $(el).parent('label').text() || '';
        }
    
        if (type === "radio" || type === "checkbox") {
            const selectValue = $(el).attr('value');
            const existingField = fields.find(field => field.name === value && field.type === type);
            if (existingField) {
                existingField.values.push({ selectValue: selectValue, label: label }); // キー名を selectValue に変更
            } else {
                fields.push({ name: value, value: name, type: type, values: [{ selectValue: selectValue, label: label }] }); // キー名を selectValue に変更
            }
        } else {
            fields.push({ name: value, value: name, type: type, label: label });
        }
    };
                      
    // input fields
    $('input[type="text"], input[type="email"], input[type="date"], input[type="month"], input[type="number"], input[type="tel"], input[type="time"], input[type="url"], input[type="week"], textarea').each(function() {
        parseField(this, $(this).attr('type') || 'textarea');
    });
    
    // radio and checkbox fields
    $('input[type="radio"], input[type="checkbox"]').each(function() {
        parseField(this, $(this).attr('type'));
    });
    
    // select fields
    $('select').each(function() {
        const name = $(this).attr('name') || $(this).attr('id') || $(this).attr('class');
        const value = name;
        const type = 'select';
        const values = [];
        $(this).find('option').each(function() {
            values.push({ selectValue: $(this).attr('value') }); // キー名を selectValue に変更
        });
        fields.push({ name: value, value: name, type: type, values: values });
    });
    
    // submit button
    const submitButtonName = $('button[type="submit"], input[type="submit"]').attr('name');
    const submitType = submitButtonName ? ($('input[name="' + submitButtonName + '"]').length > 0 ? 'input' : 'button') : 'button';
    const submit = submitButtonName ? `${submitType}[name="${submitButtonName}"]` : 'button[type="submit"]';  
    return { fields, submit };
}


//GPT-4でfieldsをマッピング
function createMappingPrompt(fields, submit, dataToSend) {
    const resultJson = { fields, submit };
    const fieldsJsonString = JSON.stringify(resultJson);
    const promptContent = `
Analyze the following fields:
${fieldsJsonString}
・Standard field configuration:
{"name": "Field name","value": "Field attribute name","type": "Field type","label": "Corresponding label"}

・Configuration for fields containing 'values':
{"name": "Field name","value": "Field attribute name","type": "Field type","values": [{"selectValue": "Multiple choice value1","label": "Corresponding label"},{"selectValue"": "Multiple choice value2","label": "Corresponding label"},,,,,

dataToSend to analyze:
${JSON.stringify(dataToSend, null, 2)}
・dataToSend configuration:
dataToSend key: "Value of dataToSend key"

I'm trying to send a sales email from the inquiry form.
Based on the JSON format received from you, send it with javascript.
Analyze the above fields and data (dataToSend), and create a mapping between the fields and the corresponding keys in dataToSend. Here's how you should approach this:

1. For text, email, date, month, number, tel, time, url, week, and textarea fields:
- You must identify the closest matching key in dataToSend based on the field name, attribute name, type, and label.
- You must keep the original "Field attribute name","Field type".
- "inquiry_content" is likely to be analyzed as a textarea field.
- "inquiry_content" must match one "Field attribute name"

2. Only For radio, checkbox, or select fields:
- You must not change the original "Field name","Field attribute name","Field type".
- The only part that must be changed is "selectValue".
- If "values" are present in the field, then absolutely one of the "selectValue" must be selected.
- For "selectValue", consider the contents of "label" and "dataToSend", and select it as an inquiry for sales purposes without hindrance.
- If you are unsure which to select, you must choose the last selectValue" within values to ensure submission.

3. You must not change the submit button's selector.

You must provide the analysis result in the following JSON format:
{
"fields": [
// For text, email, tel, url, and textarea fields: {"name": "Closest matching key from dataToSend", "value": "Field attribute name", "type": "Field's type"}
// For radio, checkbox, or select fields: {"name": "Field attribute name", "value": "Field attribute name", "type": "Field's type", "values": [{"selectValue": "Chosen selectValue"}]}
],
"submit": "submit button's selector" // 
}

Note:
- You must not change the original "Field attribute name","Field type".
- The following fields is in Japanese.
- You must always remove the "label" in the JSON format you provide.
- It is not necessary to use all the content in dataToSend, you must only map what's relevant.
- "inquiry_content" must match one "Field attribute name"
`;  
console.log(promptContent)                  
return promptContent;
}    

async function requestAndAnalyzeMapping(promptContent) {
    const completion = await openai.createChatCompletion({
        model: "gpt-4",
        temperature:0.2,
        messages: [
            {"role": "system", "content": "You are a professional who deeply understands the structure of HTML and is proficient in both English and Japanese. You are capable of minimizing mistakes, carefully verifying multiple times, and handling tasks with precision."},
            {"role": "user", "content": promptContent}
        ]                    
    });     
    // GPT-4からのレスポンス       
    const mappedName = completion.data.choices[0].message.content;

    // 最初の波括弧 '{' のインデックスを取得
    const startIndex = mappedName.indexOf('{');

    // 最後の波括弧 '}' のインデックスを取得
    const endIndex = mappedName.lastIndexOf('}');

    // 開始インデックスと終了インデックスを使用してJSON文字列を抽出
    const jsonStr = mappedName.substring(startIndex, endIndex + 1);

    // コメントを削除（//から始まる行を削除）
    const jsonWithoutComments = jsonStr.replace(/\/\/.*$/gm, '');
    try {
        // JSON文字列をパース
        const formData = JSON.parse(jsonWithoutComments);
        return formData;
    } catch (error) {
        console.error("Error parsing JSON:", error);
        console.log("JSON string:", jsonWithoutComments);
        throw error; // エラーを再スローして処理を停止
    }
}

//formDataを整形する関数
function formatAndLogFormData(formData, originalInquiryContent) {
    // radio、checkbox、およびselectのvaluesプロパティを配列に変換
    formData.inquiry_content = originalInquiryContent;
    formData.fields.forEach((field) => {
        if ((field.type === 'radio' || field.type === 'checkbox' || field.type === 'select') && typeof field.values === 'string') {
            field.values = [{ selectValue: field.values }]; // 文字列をオブジェクトの配列に変換
        }
    });
    console.log("Parsed Form Data:", formData); // パース後のオブジェクトをログ出力
}

//全フィールドに対して入力処理を行う関数
async function fillFormFields(page, formData, dataToSend, originalInquiryContent) {
    for (const field of formData.fields) {
        if (!field.name) continue;
        let valueToSend = dataToSend[field.name];
        
        // inquiry_content フィールドの場合、元の内容に戻す
        if (field.name === 'inquiry_content') {
            valueToSend = originalInquiryContent;
        }

        if (valueToSend === undefined && field.type !== 'radio' && field.type !== 'checkbox' && field.type !== 'select') continue;
        await handleFieldInput(page, field, valueToSend);
    }
}        

//フィールドごとに入力処理を行う関数
async function handleFieldInput(page, field, valueToSend) {
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
        console.log(`Field name: ${field.name}, value to send:`, valueToSend); 
        await page.type(`input[name="${field.value}"]`, valueToSend); // 値を入力
        break;
        case 'textarea':
            await page.type(`textarea[name="${field.value}"]`, valueToSend); // テキストエリアに値を入力
            console.log(`Textarea filled: Field name: ${field.name}, value: ${valueToSend}`);
            break;
        case 'radio':
            const selectedRadioValue = field.values[0].selectValue; // 選択する値を取得
            await page.click(`input[name="${field.value}"][value="${selectedRadioValue}"]`); // ラジオボタンを選択
            console.log(`Radio selected: Field name: ${field.name}, value: ${selectedRadioValue}`);
            break;
        case 'checkbox':
            const selectedCheckboxValue = field.values[0].selectValue; // 選択する値を取得
            if (selectedCheckboxValue) { // チェックボックスが選択されている場合
                await page.click(`input[name="${field.value}"][value="${selectedCheckboxValue}"]`);
                console.log(`Checkbox selected: Field name: ${field.name}, value: ${selectedCheckboxValue}`);
            }
            break;
        case 'select':
            const selectedSelectValue = field.values[0].selectValue; // 選択する値を取得
            await page.select(`select[name="${field.value}"]`, selectedSelectValue); // セレクトボックスを選択
            console.log(`Select value chosen: Field name: ${field.name}, value: ${selectedSelectValue}`);
            break;
        // 他のタイプに対応する場合、ここに追加のケースを追加します
    }
        // 0.5秒から1秒のランダムな待機時間を追加
    const milliseconds = Math.floor(Math.random() * 500) + 1000;
    await new Promise(r => setTimeout(r, milliseconds));
}

//フォームの送信処理を行う関数
async function submitForm(page, formData) {
    // スクリーンショットを撮る
    await takeScreenshot(page, 'input');

    // viewportを元に戻す
    await page.setViewport({ width: 800, height: 600 });
    await new Promise(r => setTimeout(r, 1000));
    await page.click(formData.submit);
}

//スクリーンショットの関数
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
    
// 現在地を確認する主要な関数
async function currentState(page, formData) {
    const cleanedHtmlTextContent = await cleanHtmlContent(page);
    const { isAllTextFieldsExist, isAnyTextFieldHiddenOrReadonly } = await checkTextFields(page, formData);
    const hasSubmitButton = await checkSubmitButton(page);
    const currentState = await determineState(page, cleanedHtmlTextContent, isAllTextFieldsExist, isAnyTextFieldHiddenOrReadonly, hasSubmitButton);
    return currentState;
}

// HTMLコンテンツのクリーニング
async function cleanHtmlContent(page) {
    await page.waitForSelector('body', { timeout: 30000 });
    const bodyHandle = await page.$('body');
    const htmlTextContent = await page.evaluate(body => body.textContent, bodyHandle);
    await bodyHandle.dispose();

    return htmlTextContent
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, ' ')
        .trim();
}

// テキストフィールドのチェック
async function checkTextFields(page, formData) {
    const textFields = formData.fields.filter(field => field.type === 'text').slice(0, 2); // 最初の2つのテキストフィールドを取得
    const hasTextFields = await Promise.all(
        textFields.map(async field => {
            const selector = `input[name="${field.value}"]`;
            const element = await page.$(selector);
            return element !== null;
        })
    );
    const isAllTextFieldsExist = hasTextFields.every(exist => exist);
    //hidden,readonlyが含まれているかチェック
    const isAnyTextFieldHiddenOrReadonly = await Promise.all(
        textFields.map(async field => {
            const element = await page.$(`input[name="${field.value}"]`);
            if (element !== null) {
                return await page.$eval(`input[name="${field.value}"]`, el => el.type === 'hidden' || el.readOnly);
            } else {
                return false; // セレクタに一致する要素がない場合の値
            }
        })
    );
    return { isAllTextFieldsExist, isAnyTextFieldHiddenOrReadonly };
}

//送信ボタンを探す
async function checkSubmitButton(page) {
    return await page.$('input[type="submit"], button[type="submit"]') !== null;
}

//どのページにいるか状態を判定（一部GPT-3.5を使用）
async function determineState(page, cleanedHtmlTextContent, isAllTextFieldsExist, isAnyTextFieldHiddenOrReadonly, hasSubmitButton) {
    // 条件に基づいて状態を判定
    const currentPageUrl = page.url();
    let currentState;
    if (!isAllTextFieldsExist && hasSubmitButton) currentState = 'CONFIRM';
    else if (isAllTextFieldsExist && isAnyTextFieldHiddenOrReadonly.some(val => val) && hasSubmitButton) currentState = 'CONFIRM';
    else if (isAllTextFieldsExist && !isAnyTextFieldHiddenOrReadonly.some(val => val) && hasSubmitButton) currentState = 'INPUT';
    else if (!isAllTextFieldsExist && !hasSubmitButton) {
        const messages = [
            { "role": "system", "content": " あなたは世界でも有数のアシスタントです。特にHTMLの解析を得意としております。" },
            { "role": "user", "content": `このbodyのテキスト内容とURL(${currentPageUrl})から、ページの位置を次の形式でjsonとして返してください。選択肢は、"完了"か、"エラー"の二択です。必ずどちらかを選択してください。"完了"の特徴としては、"送信完了","ありがとうございます","送信されました"というキーワードやそれに近しい文字が入っている可能性が高い。"エラー"の特徴としては、"エラー","必須項目が未入力です"というキーワードやそれに近しいこ言葉が入っている可能性が高い。必ず下記フォーマットで返してください。{ "位置": "完了" または "エラー" }: bodyのテキスト内容は下記です。${cleanedHtmlTextContent}` }
        ];

        // クエリを送信
        const completion = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: messages,
        });

        // 応答に基づいて状態を返す
        const responseMessage = completion.data.choices[0].message;
        const responseContentString = responseMessage.content.match(/\{[^\}]+\}/)[0];
        const responseContent = JSON.parse(responseContentString);
        currentState = responseContent["位置"];
        if (currentState === '完了') {
            return 'COMPLETE';
        }
        if (currentState === 'エラー') {
            return 'ERROR';
        }
    } else {
        // 予期しない応答があればデフォルト状態を返す
        currentState = 'UNKNOWN';
    }
    return currentState;
}
