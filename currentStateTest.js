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

async function currentState(page) {
    // HTMLテキスト情報を取得
    const bodyHandle = await page.$('body');
    const htmlTextContent = await page.evaluate(body => body.textContent, bodyHandle);
    const cleanedHtmlTextContent = htmlTextContent
        .replace(/\s+/g, ' ') // 連続する空白を一つの空白に置換
        .replace(/\n+/g, ' ') // 改行を空白に置換
        .trim(); // 文字列の先頭と末尾の空白を削除
    console.log(cleanedHtmlTextContent )
    await bodyHandle.dispose();

    const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        return anchors.map(anchor => ({ text: anchor.innerText, href: anchor.href }));
    });
    console.log(links)
    const currentPageUrl = page.url();

    // クエリのメッセージを定義
    const messages = [
        { "role": "system", "content": " あなたは世界でも有数のアシスタントです。特にHTMLの解析を得意としております。" },
        { "role": "user", "content": `このbodyのテキスト内容とURL(${currentPageUrl})とリンク:${JSON.stringify(links)}、から、ページの位置を次の形式でjsonとして返してください。
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

    if (currentState === '入力画面') return 'INPUT';
    if (currentState === '確認画面') return 'CONFIRM';
    if (currentState === '完了') return 'COMPLETE';
    if (currentState === 'エラー') return 'ERROR';

    // 予期しない応答があればデフォルト状態を返す
    return 'UNKNOWN';
}


async function testCurrentState() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
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
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });

    const state = await currentState(page);
    console.log(`Current state is: ${state}`);

    await browser.close();
}

// テスト関数の実行
testCurrentState().catch(console.error);
