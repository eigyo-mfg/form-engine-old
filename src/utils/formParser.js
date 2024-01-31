const cheerio = require('cheerio');

// formのHTMLを抜き出す関数

async function extractFormHTML(page) {
  console.log('extractFormHTML');
  // formタグを抽出
  const html = await page.content();
  const $ = cheerio.load(html);
  let maxInputFormHTML = '';
  let maxInputCount = 0;
  $('form').each(function() {
    const inputCount = $(this).find('input').length;
    if (inputCount > maxInputCount && $(this).find('input[type="search"], input[name="q"], input[placeholder="検索"]').length === 0) {
      maxInputFormHTML = $(this).html();
      maxInputCount = inputCount;
    }
  });
  // formタグが見つからない場合、iframe内のformタグを抽出
  if (maxInputFormHTML.length === 0) {
    const iframes = await page.$$('iframe');
    for (const iframe of iframes) {
      try {
        const frame = await iframe.contentFrame();
        await frame.waitForSelector('form', {timeout: 10000});
        const iframeHTML = await frame.content();
        const $iframe = cheerio.load(iframeHTML);
        $iframe('form').each(function() {
          const inputCount = $iframe(this).find('input').length;
          if (inputCount > maxInputCount) {
            maxInputFormHTML = $iframe(this).html();
            maxInputCount = inputCount;
          }
        });
      } catch (error) {
        console.log('No form found in this iframe. Error:', error);
      }
    }
  }
  // 最後にformが見つかっていない場合は生のHTMLを取得しform-form部分を抜き出す
  if (maxInputFormHTML.length === 0) {
    console.log('No form found in the initial HTML. Trying to fetch raw HTML...');
    await page.setRequestInterception(true);
    let responseProcessingPromise = null;
    const url = page.url();
    page.on('response', async (response) => {
      if (response.url() === url && response.request().resourceType() === 'document') {
        responseProcessingPromise = (async () => {
          const source_website_html_content = await response.text();
          const startIndex = source_website_html_content.indexOf('form');
          const endIndex = source_website_html_content.lastIndexOf('form') + 'form'.length;
          const formHTML = source_website_html_content.slice(startIndex, endIndex);
          const $ = cheerio.load(formHTML);
          const inputCount = $('input').length;
          if (inputCount > maxInputCount && $('input[type="search"], input[name="q"], input[placeholder="検索"]').length === 0) {
            maxInputFormHTML = formHTML;
            maxInputCount = inputCount;
          }
        })();
      }
    });
    await page.goto(url);
    await page.setRequestInterception(true);
    if (responseProcessingPromise) {
      await responseProcessingPromise;
    }
  }
  return maxInputFormHTML; // 最も多くのinputを持つフォームHTMLを返す
}

/**
 * formDataを整形する関数
 * @param {object} formData
 * @param {object} inputData
 */
function formatAndLogFormData(formData, inputData) {
  console.log('formatAndLogFormData');
  // radio、checkbox、およびselectのvaluesプロパティを配列に変換
  formData.inquiry_content = inputData.inquiry_content;
  formData.fields.forEach((field) => {
    if (
      (field.type === 'radio' ||
        field.type === 'checkbox' ||
        field.type === 'select') &&
      typeof field.values === 'string'
    ) {
      field.values = [{selectValue: field.values}]; // 文字列をオブジェクトの配列に変換
    }
  });
  console.log('Parsed Form Data:', formData); // パース後のオブジェクトをログ出力
}

/**
 * フィールドと送信ボタンの情報を取得する
 * @param {string} formHtml
 * @return {{fields: object[], submit: object}}
 */
function getFieldsAndSubmit(formHtml) {
  const $ = cheerio.load(formHtml);
  console.log('loaded formHtml');
  let fields = [];
  try {
    const selectors = [
      'input:not([type="hidden"]):not([type="submit"])',
      'textarea',
      'select'
    ];

    selectors.forEach(selector => {
      $(selector).each((index, el) => {
        const field = getFieldInfo($(el), index);
        fields.push(field);
      });
    });
    fields = mergeFields(fields);

    const submitEl = getSubmitElement(formHtml);
    const submit = getSubmitInfo(submitEl);
    return {fields, submit};
  } catch (e) {
    console.error('Error while getting fields and submit', e);
    console.error('fields:', fields);
    return {fields: [], submit: {}};
  }
}

/**
 * フィールドの情報を取得する
 * @param {Element} el
 * @param {number} index
 * @return {{name}}
 */
function getFieldInfo(el, index) {
  const field = {};
  const name = el.attr('name');
  // const html = el.prop('outerHTML');
  const tag = el.prop('tagName')?.toLowerCase();
  const type = el.attr('type');
  const placeholder = el.attr('placeholder');
  if (name) {
    field.name = name;
  } else {
    field.index = index;
  }
  // if (html) field.html = html;
  if (tag) field.tag = tag;
  if (type) field.type = type;
  if (placeholder) field.placeholder = placeholder;

  // selectの場合はvaluesを追加
  if (tag === 'select') {
    field.values = getSelectValues(el);
  }

  if (type === 'radio' || type === 'checkbox') {
    field.values = [el.attr('value')];
  }

  return field;
}

/**
 * チェックボックスとラジオのフィールドをマージする(valuesをまとめる)
 * @param fields
 * @return {*[]}
 */
function mergeFields(fields) {
  const results = [];
  fields.forEach((field) => {
    if (field.type === 'radio' || field.type === 'checkbox') {
      const existingField = results.find((r) => r.name === field.name && r.type === field.type);
      if (existingField) {
        existingField.values = existingField.values.concat(field.values);
      } else {
        results.push(field);
      }
    } else {
      results.push(field);
    }
  });
  return results;
}

function getSubmitElement(formHtml) {
  const $ = cheerio.load(formHtml);
  let submitEl = $('button[type="submit"], input[type="submit"]');
  if (submitEl.length > 0) {
    return submitEl;
  }
  console.warn('No submit button found. Trying to find submit link...');
  // const submitTexts = ['送信', '確認', '申込', '次へ', '進む'];
  const submitTexts = ['送', '確', '申', '次', '進', 'confirm', 'submit', 'send', 'next'];
  // 全てのinputボタンのテキストを検証して、対象があれば送信ボタンとして扱う
  $('input[type="button"], button[type="button"]').each((_, el) => {
    const text = $(el).val();
    if (text && submitTexts.some((submitText) => text.includes(submitText))) {
      submitEl = $(el);
    }
  });
  if (submitEl.length > 0) {
    return submitEl;
  }
  // 全てのbutton, aタグのテキストを検証して、対象があれば送信ボタンとして扱う
  $('button, a').each((_, el) => {
    const text = $(el).text();
    if (submitTexts.some((submitText) => text.includes(submitText))) {
      submitEl = $(el);
    }
  });
  if (submitEl.length > 0) {
    return submitEl;
  }
  // 子要素の検証、対象があれば親要素を送信ボタンとして扱う
  $('button > span').each((_, el) => {
    if (!el.children || el.children.length === 0) return;
    const childData = el.children[0].data;
    if (childData && submitTexts.some((submitText) => childData.includes(submitText))) {
      submitEl = $(el.parent);
    }
  });
  if (submitEl.length > 0) {
    return submitEl;
  }
  const submitTextsForImage = ['送信', '確認', '申込', '次へ', '進む'];
  const submitTextsForImageInput = ['submit', 'confirm', 'kakunin', 'next', 'send', 'soushin', 'susumu'];
  // input[type=image]の画像を検証, alt属性に対象があれば送信ボタンとして扱う
  $('input[type="image"]').each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt && submitTexts.some((submitText) => alt.includes(submitText))) {
      submitEl = $(el);
    }
    const src = $(el).attr('src');
    if (src && submitTextsForImageInput.some((submitText) => src.includes(submitText))) {
      submitEl = $(el);
    }
    const name = $(el).attr('name');
    if (name && submitTextsForImageInput.some((submitText) => name.includes(submitText))) {
      submitEl = $(el);
    }
    if (name && submitTextsForImage.some((submitText) => name.includes(submitText))) {
      submitEl = $(el);
    }
  });
  if (submitEl.length > 0) {
    return submitEl;
  }
  // 画像の要素を検証, alt属性に対象があれば送信ボタンとして扱う
  $('image, img').each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt && submitTextsForImage.some((submitText) => alt.includes(submitText))) {
      submitEl = $(el);
    }
  });
  if (submitEl.length > 0) {
    return submitEl;
  }
  // btnクラスを持つdiv要素を検証, 子要素のテキストに対象があれば送信ボタンとして扱う
  $('.btn').each((_, el) => {
      const text = $(el).text();
      console.log({text});
      if (text && submitTexts.some((submitText) => text.includes(submitText))) {
      submitEl = $(el);
      }
  });
  // div要素を検証, onclickに対象テキストがあれば送信ボタンとして扱う
  $('div').each((_, el) => {
    const submitTextsOnClick = ['submit', 'confirm'];
    const onclick = $(el).attr('onclick');
    if (onclick && submitTextsOnClick.some((submitText) => onclick.includes(submitText))) {
      submitEl = $(el);
    }
  });
  // 最後のinputボタンを対象にする
  if (submitEl.length === 0) {
      submitEl = $('input[type="button"], button[type="button"]').last();
  }
  console.warn('Tried to find submit element for all possible cases but failed. Returning empty element.')
  return submitEl;
}

function getSubmitInfo(el) {
  const submit = {};
  const tag = el.prop('tagName')?.toLowerCase();
  const type = el.attr('type');

  if (tag) submit.tag = tag;
  if (type) {
    submit.type = type;
  } else {
    const c = el[0]?.attribs['class']
    if (c) {
      submit.class = c;
    } else if (tag === 'a') {
      const href = el[0]?.attribs['href'];
      if (href) submit.href = el[0]?.attribs['href'];

      const onclick = el[0]?.attribs['onclick'];
      if (onclick) submit.onclick = el[0]?.attribs['onclick'];
    }
  }

  return submit;
}

/**
 * @param {Element} el
 * @return {*}
 */
function getSelectValues(el) {
  // 空の選択肢や、テキストに「選択」という文字列が含まれてるoptionは除外する
  return el.find('option')
      .filter((_, e) => e.children && e.children[0] && e.children[0].data && !e.children[0].data.includes('選択'))
      .map((_, e) => e.attribs.value)
      .get();
}

function removeAttributes(html) {
  const $ = cheerio.load(html, {decodeEntities: false});

  $('*').each(function() {
    const isCheckboxOrRadio = $(this).is('input[type=checkbox]') || $(this).is('input[type=radio]');
    const isOption = $(this).is('option');
    const isField = $(this).is('input') || $(this).is('textarea') || $(this).is('select');
    const attrs = this.attributes;
    for (const attr of attrs) {
      // チェックボックスとラジオ、optionの場合はvalue属性を残す
      if (((isCheckboxOrRadio || isOption) && attr.name === 'value')) {
        continue;
      }
      // フィールドの場合はnameとplaceholder属性を残す
      if (isField && (attr.name === 'name' || attr.name === 'placeholder')) {
        continue;
      }
      $(this).removeAttr(attr.name);
    }
  });

  // optionタグが一定以上の数の場合、削除する
  if ($('option').length > 500) {
    $('option').remove();
  }
  // 個人情報・プライバシーに関するpタグは削除する
  $('p, li').each(function() {
    const text = $(this).text();
    // console.log('text', text)
    if (text.includes('個人情報') || text.includes('プライバシー') || text.includes('改訂') || text === '') {
      $(this).remove();
    }
  })

  // script, styleタグは不要のため削除する
  $('script, style').remove();

  const cleanedHtml = $.html()
      .replace(/\n\s*\n/g, '\n') // remove empty lines
      .replace(/>\s+</g, '><') // remove spaces between tags
      .replace(/<!--[\s\S]*?-->/g, ''); // remove comments
  return cleanedHtml;
}

/**
 * ヘッダー、フッター、サイドバー、Navバーの要素を削除する
 */
function removeHeaderFooterSidebar($) {
  $('header, footer, .sidebar, nav').remove();
  return $.html();
}

module.exports = {
  extractFormHTML,
  formatAndLogFormData,
  getFieldsAndSubmit,
  removeAttributes,
  removeHeaderFooterSidebar,
};
