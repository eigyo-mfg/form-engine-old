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

// スプレッドシートのIDをここに入力
const sheetId = '11wyDbzPIcTi4bS0lnuDJVrvUjgVKirzTKScsJ4iNZgc'; 

// dataToSend変数の初期値を空のオブジェクトに設定
let dataToSend = {};

//スプレッドシートから入力内容を呼び出す関数
async function loadDataToSend() {
    const request = {
      spreadsheetId: sheetId,
      range: 'input!A2:B25', // ここでは固定の範囲を指定していますが、動的に変更することも可能です
    };
  
    let response = await gsapi.spreadsheets.values.get(request);
    let rows = response.data.values;
  
    let data = {};
    rows.forEach(row => {
      let key = row[0];
      let value = row[1];
      if (key === 'inquiry_content') {
        value = value.replace(/\\n/g, '\n');
      }
      data[key] = value;
    });
    return data;
}
  
// 上記関数を呼び出して、dataToSend変数に値を設定します。
loadDataToSend().then(data => {
    dataToSend = data;
});

//スプレッドシートからURLを取得
async function getUrls() {
    const request = {
      spreadsheetId: sheetId,
      range: 'Sheet1!D2:E', // D列とE列を指定
    };
  
    let response = await gsapi.spreadsheets.values.get(request);
    let urls = response.data.values
        .filter(row => !row[1]) // E列に値がないものだけをフィルタリング
        .map(row => row[0]); // D列の値（URL）だけを取得

    console.log(urls);
    return urls;
}

  // 並列処理のためチャンクに分割する関数
function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

//並列処理を実行する関数.チャンクはケースによって変更する
async function main() {
    const timestamp = new Date().toISOString();
    const urls = await getUrls();
    const chunks = chunkArray(urls, 5); // 3つのチャンクに分割

    for (const chunk of chunks) {
        const promises = chunk.map(url => run(url, timestamp)); // タイムスタンプを渡す
        await Promise.all(promises);
    }
}
main().catch(console.error);

// ページの立ち上げからブラウザが閉じるまでの主たる関数
async function run(url, timestamp) {
    const browser = await puppeteer.launch({ headless: false });
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
    await mainProcess(page, timestamp); 
    await page.close();
    await browser.close();
}

// 主要な処理をループして実行する関数
async function mainProcess(page, timestamp) {
    let state = 'INPUT';
    let processOnInputTrial = 0;
    let totalTrial = 0;
    let formData; // formDataを保存するための変数
    let confirmation = false; // 確認画面の存在をチェックする変数
    let formKey; // FirestoreのドキュメントIDを保存する変数
    let initialUrl = await page.url(); // 初期URLを保存
    let result = "ERROR"; // デフォルトの結果をERRORとして設定

    while (state !== 'DONE' && totalTrial < maxTotalTrials) {
        switch (state) {
            case 'INPUT':
                if (processOnInputTrial < maxProcessOnInputTrials) {
                    processOnInputTrial++;
                    const result = await processOnInput(page, timestamp); // formDataを受け取る
                    const formData =result.formData;
                    if (formData === null) {
                        console.log("Form not found. Exiting mainProcess...");
                        return; // responseがnullの場合、関数を終了
                    }
                    formKey = generateDocumentId(initialUrl); // ドキュメントIDを保存（この行を修正）
                    if (result.submitResult === "COMPLETE") {
                        state = 'COMPLETE';
                        continue; // 次の繰り返しに直ちに進む
                    }
                    if (result.submitResult === "ERROR") {
                        state = 'ERROR';
                        continue; // 次の繰り返しに直ちに進む
                    }
                } else {
                    console.log("Max processOnInput trials reached, skipping...");
                }
                break;
            case 'CONFIRM':
                confirmation = true; // 確認画面が存在する場合
                await processOnConfirm(page);
                break;
            case 'COMPLETE':
                result = "COMPLETE"; // 送信が完了した場合
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

    // mainProcessの最後で変換されたURLを取得
    const transformedUrl = generateDocumentId(initialUrl);

    // その変換されたURLとタイムスタンプを組み合わせてkeyを生成
    const key = transformedUrl + timestamp;

    // keyをsaveResults関数に渡す
    await saveResults(key, transformedUrl, timestamp, result); // 結果も渡す

    // Firestoreへの追加データ保存部分
    const masterCollectionRef = db.collection('master-forms'); // master-formsコレクションを指定
    const masterDocRef = masterCollectionRef.doc(formKey); // キーとして使用する識別子をドキュメントIDとして指定
    await masterDocRef.update({
        confirmation: confirmation // 確認画面の存在を保存
    });
}


//入力仮定の関数
async function processOnInput(page, timestamp) { 
    const url = await page.url();
    const transformedUrl = generateDocumentId(url);
    const formKey = generateDocumentId(url);
    // URLに対応する最新の結果を取得
    const latestResult = await getLatestResultForUrl(url);
    switch (latestResult) {
        case "COMPLETE":
            // Firestoreからのデータ取得と一致確認
            const matchingData = await getMatchingDataFromFirestore(url, page);
            if (matchingData) {
                await fillFormFields(page, matchingData, dataToSend, dataToSend.inquiry_content);
                await submitForm(page, matchingData);
                return matchingData;
            }
            break;
        case "ERROR":
        case "NONE":
            break; // 通常の処理に進む
        case "Not Exist":
            console.log("form not exist");
            return null; // フォームが存在しない場合、nullを返す
    }

    // 通常の処理
    const result = await normalProcessing(page, url); // result変数に結果を保存
    if (result === null) {
        console.log("No form found. Exiting processOnInput...");
        const resultStatus = "Not Exist";
        await saveResults(formKey, transformedUrl, timestamp, resultStatus); // 結果を"Not Exist"として保存
        await writeToSpreadsheet(transformedUrl, resultStatus, timestamp); // スプレッドシートに"-"を書き込む
        return null;
    }

    const { formData, fields, submit, submitResult} = result; // resultから値を分割代入

    // formDataからinquiry_contentを除外したオブジェクトを作成
    const firestoreData = { ...formData };
    delete firestoreData.inquiry_content;

    // Firestoreへの保存部分
    const masterCollectionRef = db.collection('master-forms'); // master-formsコレクションを指定
    const masterDocRef = masterCollectionRef.doc(formKey); // キーとして使用する識別子をドキュメントIDとして指定
    await masterDocRef.set({
        key: formKey,
        fieldsJsonString: JSON.stringify({ fields, submit }), // 元のフォームのフィールド
        formData: JSON.stringify(firestoreData) // GPT-4が整形したフィールド
    }); // データを保存
    return {formData , submitResult};
}

// GPT-4を活用した、通常の処理を行う関数
async function normalProcessing(page, url) { 
    await handleAgreementButton(page);
    const longestFormHTML = await extractFormHTML(page, url);
    if (longestFormHTML === undefined) {
        console.log("Error: longestFormHTML is undefined.");
        return null;
    }
    if (longestFormHTML.length === 0) {
        console.log("No form found. Exiting...");
        return null;
    }
    const { fields, submit } = analyzeFields(longestFormHTML);
    console.log(fields, submit)
    const originalInquiryContent = dataToSend.inquiry_content;
    const shortenedInquiryContent = originalInquiryContent.substring(0, 40);
    const promptContent = createMappingPrompt(fields, submit, { ...dataToSend, inquiry_content: shortenedInquiryContent });
    const formData = await requestAndAnalyzeMapping(promptContent);
    formatAndLogFormData(formData, originalInquiryContent);
    await fillFormFields(page, formData, dataToSend, originalInquiryContent);
    const submitResult = await submitForm(page, formData);
    return { formData, fields, submit, submitResult };
}

//URLをFirestoreのデータとして扱えるように変換
function generateDocumentId(url) {
    if (!url) {
        console.error("URL is undefined or null");
        return ""; // URLがundefinedまたはnullの場合、空文字列を返す
    }
    // URLの最後がスラッシュで終わっている場合、それを削除
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    // プロトコル部分を削除
    url = url.replace(/^https?:\/\//, '');
    return url.replace(/\//g, '__');
}

//実行結果を保存する関数
async function saveResults(key, transformedUrl, timestamp, result) {
    try {
        const resultsCollectionRef = db.collection('results-forms');
        const resultsDocRef = resultsCollectionRef.doc(key);
        await resultsDocRef.set({
            key: key,
            results: result, // 結果を保存
            timestamp: timestamp, // 処理開始時のタイムスタンプ
            url: transformedUrl
        });
        console.log(`Document saved in results-forms with key: ${key}`);

        // スプレッドシートに結果を書き込む
        await writeToSpreadsheet(transformedUrl, result, timestamp);
    } catch (error) {
        console.error("Error writing to spreadsheet:", error);
    }
}

// スプレッドシートに結果と日時を書き込む関数
async function writeToSpreadsheet(url, result, timestamp) {
    try {
        const rowNumber = await getRowNumberForUrl(url); // URLに対応する行番号を取得
        if (rowNumber === null) return; // 行が見つからない場合、処理を終了

        const symbolMapping = {
            "COMPLETE": "⚪︎",
            "ERROR": "×",
            "Not Exist": "-"
        };

        const symbol = symbolMapping[result] || "Unknown"; // 結果に対応する記号を取得
        const date = new Date(timestamp).toLocaleString(); // タイムスタンプをローカル日時に変換

        const updateRequest = {
            spreadsheetId: sheetId,
            range: `Sheet1!E${rowNumber}:F${rowNumber}`, // E列とF列の対応する行を指定
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[symbol, date]] // 記号と日時を書き込む
            }
        };
        await gsapi.spreadsheets.values.update(updateRequest);
    } catch (error) {
        console.error("Error writing to spreadsheet:", error);
    }
}

// URLに対応する行番号を取得する関数
async function getRowNumberForUrl(url) {
    const request = {
        spreadsheetId: sheetId,
        range: 'Sheet1!D2:D', // D列を指定
    };

    let response = await gsapi.spreadsheets.values.get(request);
    let urls = response.data.values.map(row => generateDocumentId(row[0])); // D列の値（URL）を変換

    // 部分一致でURLを検索（ここでは先頭10文字で比較）
    const partialUrl = url.substring(0, 10);
    const rowIndex = urls.findIndex(u => u.substring(0, 10) === partialUrl);

    if (rowIndex === -1) return null; // 見つからない場合はnullを返す

    return rowIndex + 2; // 行番号は2から始まるため、インデックスに2を足す
}


// Firestoreからデータを取得し、一致するか確認する関数
async function getMatchingDataFromFirestore(url, page) {
    const formKey = generateDocumentId(url);
    const masterCollectionRef = db.collection('master-forms');
    const masterDocRef = masterCollectionRef.doc(formKey);
    const doc = await masterDocRef.get();

    if (doc.exists) {
        const data = doc.data();
        if (data.key === formKey) {
            const longestFormHTML = await extractFormHTML(page, url);
            const { fields, submit } = analyzeFields(longestFormHTML);
            const fieldsJsonString = JSON.stringify({ fields, submit });
            if (data.fieldsJsonString === fieldsJsonString) {
                return JSON.parse(data.formData);
            }
        }
    }

    return null;
}

//results-formsからurlにマッチする結果を探す関数
async function getLatestResultForUrl(url) {
    // generateDocumentId関数を使用してURLを変換
    const transformedUrl = generateDocumentId(url);
    const resultsCollectionRef = db.collection('results-forms');
    const query = resultsCollectionRef.where('url', '==', transformedUrl).orderBy('timestamp', 'desc').limit(1);
    const querySnapshot = await query.get();

    if (querySnapshot.empty) {
        return "NONE"; // データが存在しない場合
    }
    const doc = querySnapshot.docs[0];
    const resultData = doc.data().results;// 最新の結果を返す
    return resultData;
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
        const [button] = await page.$x("//input[contains(@value, '同意') and not(@type='image' and @alt='検索')] | //a[contains(text(), '同意')] | //span[contains(text(), '同意')]");
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
async function extractFormHTML(page, url) {
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

    const submitButton = $('button[type="submit"], input[type="submit"]');
    const submitButtonClass = submitButton.attr('class');
    const submitButtonName = submitButton.attr('name');
    const submitType = submitButtonName ? ($(`input[name="${submitButtonName}"]`).length > 0 ? 'input' : 'button') : (submitButton.is('button') ? 'button' : 'input');
    const submit = submitButtonClass ? `${submitType}.${submitButtonClass.split(' ').join('.')}[type="submit"]` : `${submitType}[type="submit"]`;
    return { fields, submit };
}

//GPT-4でfieldsをマッピング
function createMappingPrompt(fields, submit, dataToSend) {
    const resultJson = { fields, submit };
    const promptContent = `
Analyze the following fields:
${JSON.stringify(resultJson)}
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
    const selector = getSelector(field); // セレクタを取得
    // セレクタがnullの場合、処理をスキップ
    if (selector === null) {
        console.warn("No selector found for field:", field);
        return;
    }

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
            const currentValue = await page.$eval(selector, el => el.value); // 現在の値を取得
            // 現在の値が送信する値と同じであればスキップ
            if (currentValue === valueToSend) {
                return;
            }
            await page.type(selector, valueToSend); // 値を入力
            break;
        case 'textarea':
            await page.focus(selector); // テキストエリアにフォーカスを当てる
            await page.$eval(selector, el => el.value = ''); // 現在の値をクリア
            await page.type(selector, valueToSend); // 新しい値を入力
            break;
        case 'radio':
            const selectedRadioValue = field.values[0].selectValue; // 選択する値を取得
            await page.click(`input[name="${field.value}"][value="${selectedRadioValue}"]`); // ラジオボタンを選択
            break;
        case 'checkbox':
            const checkboxSelector = `input[name="${field.value}"]`;
            const isChecked = await page.$eval(checkboxSelector, el => el.checked); // チェックボックスの現在の状態を取得
            if (!isChecked) { // チェックボックスが選択されていない場合のみクリック
                const selectedCheckboxValue = field.values[0].selectValue; // 選択する値を取得
                if (selectedCheckboxValue) { // チェックボックスが選択されている場合
                    await page.click(`input[name="${field.value}"][value="${selectedCheckboxValue}"]`);
                }
            }
            break;
        case 'select':
            const selectedSelectValue = field.values[0].selectValue; // 選択する値を取得
            await page.select(`select[name="${field.value}"]`, selectedSelectValue); // セレクトボックスを選択
            break;
        // 他のタイプに対応する場合、ここに追加のケースを追加します
    }
    // 3秒から5秒のランダムな待機時間を追加
    const milliseconds = Math.floor(Math.random() * 3000) + 2000;
    await new Promise(r => setTimeout(r, milliseconds));
}


// セレクタを取得する関数
function getSelector(field) {
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
            return `input[name="${field.value}"]`;
        case 'textarea':
            return `textarea[name="${field.value}"]`;
        case 'select':
            return `select[name="${field.value}"]`;
        case 'radio':
            return `input[name="${field.value}"]`; // ラジオボタンのセレクタを返す
        case 'checkbox':
            return `input[name="${field.value}"]`; // チェックボックスのセレクタを返す
        // 他のタイプに対応する場合、ここに追加のケースを追加します
        default:
            return null;
    }
}

async function submitForm(page, formData) {
    // スクリーンショットを撮る
    await takeScreenshot(page, 'input');

    // viewportを元に戻す
    await page.setViewport({ width: 800, height: 600 });
    await new Promise(r => setTimeout(r, 1000));

    try {
        // submitボタンをクリック
        await page.click(formData.submit);
        console.log(formData.submit);

        // Contact Form 7の送信完了を検知するセレクター
        const contactForm7CompleteSelector = '.wpcf7-mail-sent-ok'; // 送信完了のセレクター
        const responseOutputSelector = '.wpcf7-response-output'; // 送信結果のセレクター

        // ページ遷移と送信完了の検知
        const navigationPromise = page.waitForNavigation({ timeout: 5000 }); // 5秒でページ遷移を待つ
        const completePromise = page.waitForSelector(contactForm7CompleteSelector, { timeout: 5000 }); // 5秒で送信完了を待つ
        const responsePromise = page.waitForSelector(responseOutputSelector, { timeout: 5000 }); // 5秒で送信結果を待つ

        await Promise.race([navigationPromise, completePromise, responsePromise]);

        // ページ遷移が最初に発生した場合、何も返さずに関数を終了
        if (await navigationPromise) {
            return;
        }

        // 送信完了を確認
        const isComplete = await page.$(contactForm7CompleteSelector);
        if (isComplete) {
            return "COMPLETE"; // 送信完了が検知された場合
        }

        // 送信結果のテキストを確認
        const responseElement = await page.$(responseOutputSelector);
        if (responseElement) {
            const textContent = await page.evaluate(el => el.textContent, responseElement);
            if (textContent.includes('有難う') || textContent.includes('有り難う') || textContent.includes('有りがとう') || textContent.includes('ありがとう') || textContent.includes('完了') || textContent.includes('Thank You')) {
                return "COMPLETE"; // 送信完了と判断
            }
        }
    } catch (error) {
        console.error("Submit button not found or timeout reached:", error);
        return "ERROR"; // エラーが発生した場合には、"ERROR"を返す
    }
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
