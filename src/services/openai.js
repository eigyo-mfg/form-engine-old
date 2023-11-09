const OpenAI = require('openai');
const {saveAIGeneratedResponse, getLatestPromptResponse, generateFormsDocumentId} = require("./firestore");
const {hash} = require("../utils/crypto");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // defaults to process.env["OPENAI_API_KEY"]
});

// OpenAIへの共通リクエスト
async function requestGPT(model, prompt, systemPrompt = null, formId = null) {
  console.log("requestGPT", model, prompt, systemPrompt);
  const messages = [{role: 'user', content: prompt}];
  if (systemPrompt !== null) {
    messages.unshift({role: 'system', content: systemPrompt});
  }

  // デバッグモードの場合、Firestoreから結果の取得を試みる
  if (process.env.DEBUG === 'true') {
    const response = await getLatestPromptResponse(formId, systemPrompt, prompt)
    if (response) {
      return response.content;
    }
  }

  const chatCompletion = await openai.chat.completions.create({
    messages: messages,
    temperature: 0.2,
    model: model,
  });
  console.log("chatCompletion", chatCompletion);

  // 使ったトークン数をログに残す
  const usedTokens = chatCompletion.usage.total_tokens;
  console.log("usedTokens", usedTokens);

  await saveAPIResult(formId, model, systemPrompt, prompt, chatCompletion, usedTokens);

  const chatgptResponseMessage = chatCompletion.choices[0].message.content.trim();
  console.log("chatgptResponseMessage", chatgptResponseMessage)
  return chatgptResponseMessage;
}

async function requestGPT4(prompt, systemPrompt = null, formId = null) {
  const model = 'gpt-4-1106-preview';
  return await requestGPT(model, prompt, systemPrompt, formId);
}

async function requestGPT35(prompt, systemPrompt = null, formId = null) {
  const model = 'gpt-3.5-turbo-1106';
  return await requestGPT(model, prompt, systemPrompt, formId);
}

function createMappingPrompt(fields, inputData, formattedFormHTML) {
  const inputDataJson = formatInputForPrompt(inputData);
  const fieldsJson = JSON.stringify({fields: fields});
  const prompt = `
Analyze the following form fields:
${fieldsJson}
The data used for inquiries is below.
${inputDataJson}
The html structure of the entire inquiry form is as follows.
${formattedFormHTML}

Analyze the following form fields and inquiries data. Create a mapping between the form fields 'name' attribute and the corresponding keys in the inquiries data. The result should be added as a "value" field in the form field data. 
Please note, the "value" field should contain the key from the inquiries data that corresponds to the form field, not the actual value from the inquiries data.
As an exception, if the field type is 'select', 'checkbox' or 'radio', the value field must be set to the most applicable choice from the values instead of mapping keys.
Remove the 'html' fields from the output and present the results in JSON format.

Please be aware that addresses may be split into separate fields,
names may be separated into first and last,
and entries may require specific formats such as katakana or hiragana.

The output should look like this:
{"fields":[{"name":"lastname_kana","tag":"input","type":"text","value":"last_name_kana"},{"name":"company","tag":"input","type":"text","value":"company_name"},{"name":"select_field","tag":"select","values":["a","b","c"],"value":"b"},{"name":"checkbox_field","tag":"input","type":"checkbox","values":["one","two"],"value":"one"},…]}
`
  console.log("prompt", prompt);
  return prompt;
}

function _createMappingPrompt(fields, submit, inputData) {
  const inputDataForPrompt = formatInputForPrompt(inputData);
  console.log('createMappingPrompt');
  const resultJson = {fields, submit};
  const promptContent = `
Analyze the following fields:
${JSON.stringify(resultJson)}
・Standard field configuration:
{"name": "Field name","value": "Field attribute name","type": "Field type","label": "Corresponding label"}

・Configuration for fields containing 'values':
{"name": "Field name","value": "Field attribute name","type": "Field type","values": [{"selectValue": "Multiple choice value1","label": "Corresponding label"},{"selectValue"": "Multiple choice value2","label": "Corresponding label"},,,,,

dataToSend to analyze:
${JSON.stringify(inputDataForPrompt, null, 2)}
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

3. You must select one button to send from the submit button's selector.

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
- You must always remove the "label" and the "placeholder" and the "additionalInfo "in the JSON format you provide.
- It is not necessary to use all the content in dataToSend, you must only map what's relevant.
- "inquiry_content" must match one "Field attribute name"
`;
  return promptContent;
}

function formatInputForPrompt(inputData) {
  let formatInputData = { ...inputData };
  formatInputData.inquiry_content = formatInputData.inquiry_content.substring(0, 40);
  return JSON.stringify(formatInputData);
}

async function requestAndAnalyzeMapping(prompt, formId) {
  console.log('requestAndAnalyzeMapping');

  const systemPrompt =
    'You are a professional who deeply understands the structure of HTML and is proficient in both English and Japanese. You are capable of minimizing mistakes, carefully verifying multiple times, and handling tasks with precision.';

  // GPT-4を使用してマッピングを作成
  const mappedName = await requestGPT4(prompt, systemPrompt, formId);
  console.log('mappedName:', mappedName);

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
    console.error('Error parsing JSON:', error);
    console.log('JSON string:', jsonWithoutComments);
    throw error; // エラーを再スローして処理を停止
  }
}

async function requestDetermineState(currentPageUrl, cleanedHtmlTextContent, formId) {
  const systemPrompt = "あなたは世界でも有数のアシスタントです。特にHTMLの解析を得意としております。";
  const prompt = `このbodyのテキスト内容とURL(${currentPageUrl})から、ページの位置を次の形式でjsonとして返してください。選択肢は、"完了"、"確認"、"エラー"の三択です。必ずいずれかを選択してください。"完了"の特徴としては、"送信完了","ありがとうございます","送信されました"というキーワードやそれに近しい文字が入っている可能性が高い。"確認"の特徴としては、formタグ内に入力されたデータが表示されたり、ヘッダーや送信ボタンに確認の文字列が含まれてる可能性があります。"エラー"の特徴としては、"エラー","必須項目が未入力です"というキーワードやそれに近しいこ言葉が入っている可能性が高い。必ず次のJSONフォーマットで結果を返してください。{ "位置": "完了" または "確認" または "エラー" }: bodyのテキスト内容は下記です。${cleanedHtmlTextContent}`;
  return await requestGPT35(prompt, systemPrompt, formId);
}

async function saveAPIResult(formId, model, systemPrompt, prompt, chatCompletion) {
  const content = chatCompletion.choices[0].message.content.trim();
  const object = chatCompletion.object;
  const createdAt = new Date(chatCompletion.created * 1000);
  const usedTokens = chatCompletion.usage.total_tokens;
  const docId = chatCompletion.id.replace("chatcmpl-", "");

  const data = {
    formId: formId,
    model: model,
    systemPrompt: hash(systemPrompt),
    prompt: hash(prompt),
    object: object,
    content: content,
    usedTokens: usedTokens,
    createdAt: createdAt,
  };
  await saveAIGeneratedResponse(formId, data, docId);
}

module.exports = {
  createMappingPrompt,
  requestAndAnalyzeMapping,
  requestDetermineState,
};
