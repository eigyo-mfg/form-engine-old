const cheerio = require('cheerio');

// formのHTMLを抜き出す関数

async function extractFormHTML(page) {
  console.log('extractFormHTML');
  // formタグを抽出
  const html = await page.content();
  const $ = cheerio.load(html);
  const formsHTML = [];
  $('form').each(function() {
    if ($(this).find('input').length > 1) {
      if (
        $(this).find(
            'input[type="search"], input[name="q"], input[placeholder="検索"]',
        ).length === 0
      ) {
        formsHTML.push($(this).html());
      }
    }
  });
  // formタグが見つからない場合、iframe内のformタグを抽出
  if (formsHTML.length === 0) {
    const iframes = await page.$$('iframe');
    for (const iframe of iframes) {
      try {
        const frame = await iframe.contentFrame();
        await frame.waitForSelector('form', {timeout: 5000});

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
  let longestFormHTML = formsHTML.reduce(
      (a, b) => (a.length > b.length ? a : b),
      '',
  );
  // 最後にformが見つかっていない場合は生のHTMLを取得しform-form部分を抜き出す
  if (longestFormHTML.length === 0) {
    console.log(
        'No form found in the initial HTML. Trying to fetch raw HTML...',
    );
    await page.setRequestInterception(true);
    let responseProcessingPromise = null;
    const url = page.url();
    page.on('response', async (response) => {
      if (
        response.url() === url &&
        response.request().resourceType() === 'document'
      ) {
        responseProcessingPromise = (async () => {
          const source_website_html_content = await response.text();
          const startIndex = source_website_html_content.indexOf('form');
          const endIndex =
            source_website_html_content.lastIndexOf('form') + 'form'.length;
          const formHTML = source_website_html_content.slice(
              startIndex,
              endIndex,
          );
          const $ = cheerio.load(formHTML);
          if (
            $('input').length > 1 &&
            $(
                'input[type="search"], input[name="q"], input[placeholder="検索"]',
            ).length === 0
          ) {
            return formHTML;
          } else {
            return '';
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

function analyzeFields(longestFormHTML) {
  const $ = cheerio.load(longestFormHTML);
  const fields = [];

  const parseField = (el, type) => {
    const name = $(el).attr('name') || $(el).attr('id') || $(el).attr('class');
    const value = name;
    const placeholder = $(el).attr('placeholder') || '';

    let additionalInfo = $(el).next('small').text().trim() || '';
    if (!additionalInfo) {
      additionalInfo = $(el).next('span').text().trim() || '';
    }
    if (!additionalInfo) {
      additionalInfo = $(el).parent().find('small').text().trim() || '';
    }
    if (!additionalInfo) {
      additionalInfo = $(el).closest('.item-input').find('.small-txt').text().trim() || '';
    }
    if (!additionalInfo) {
      let parentText = $(el).closest('.item-input').text().trim();
      let selfText = '';
      if ($(el).val() !== undefined) {
        selfText = $(el).val().trim();
      } else if ($(el).attr('placeholder') !== undefined) {
        selfText = $(el).attr('placeholder').trim();
      }
      additionalInfo = parentText.replace(selfText, '').trim();
    }

    let label = $(`label[for="${name}"]`).text() || $(`label[for="${$(el).attr('id')}"]`).text() || '';
    if (label === '') {
      label = $(el).parent('label').text() || '';
    }

    const field = { name: value, value: name, type: type };

    if (label) field.label = label;
    if (placeholder) field.placeholder = placeholder;
    if (additionalInfo) field.additionalInfo = additionalInfo;

    if (type === "radio" || type === "checkbox") {
      const selectValue = $(el).attr('value');
      const existingField = fields.find(field => field.name === value && field.type === type);
      if (existingField) {
        existingField.values.push({ selectValue: selectValue, label: label });
      } else {
        field.values = [{ selectValue: selectValue, label: label }];
        fields.push(field);
      }
    } else {
      fields.push(field);
    }
  };

  $('input[type="text"], input[type="email"], input[type="date"], input[type="month"], input[type="number"], input[type="tel"], input[type="time"], input[type="url"], input[type="week"], textarea').each(function() {
    parseField(this, $(this).attr('type') || 'textarea');
  });

  $('input[type="radio"], input[type="checkbox"]').each(function() {
    parseField(this, $(this).attr('type'));
  });

  $('select').each(function() {
    const name = $(this).attr('name') || $(this).attr('id') || $(this).attr('class');
    const value = name;
    const type = 'select';
    const values = [];
    $(this).find('option').each(function() {
      values.push({selectValue: $(this).attr('value')});
    });
    fields.push({name: value, value: name, type: type, values: values});
  });

  const submitButton = $('button[type="submit"], input[type="submit"]');
  const submitButtonClass = submitButton.attr('class');
  // const submitButtonValue = submitButton.attr('value');
  const submitButtonName = submitButton.attr('name');
  const submitType = submitButtonName ?
      ($(`input[name="${submitButtonName}"]`).length > 0 ? 'input' : 'button'):
      (submitButton.is('button') ? 'button' : 'input');
  const submit = submitButtonClass ?
      `${submitType}.${submitButtonClass.split(' ').join('.')}[type="submit"]` :
      `${submitType}[type="submit"]`;

  return {fields, submit};
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
 * @returns {{fields: object[], submit: object}}
 */
function getFieldsAndSubmit(formHtml) {
  const $ = cheerio.load(formHtml);
  console.log('loaded formHtml');
  let fields = [];
  $('input:not([type="hidden"]):not([type="submit"]), textarea, select').each((_, el) => {
    const field = getFieldInfo($(el));
    fields.push(field);
  });
  fields = mergeFields(fields);

  console.log('fields', fields);
  const submit = getSubmitInfo($('button[type="submit"], input[type="submit"]'));

  return {fields, submit}
}

/**
 * フィールドの情報を取得する
 * @param {Element} el
 * @returns {{name}}
 */
function getFieldInfo(el) {
  const field = {};
  const name = el.attr('name');
  // const html = el.prop('outerHTML');
  const tag = el.prop('tagName').toLowerCase();
  const type = el.attr('type');

  if (name) field.name = name;
  // if (html) field.html = html;
  if (tag) field.tag = tag;
  if (type) field.type = type;

  // selectの場合はvaluesを追加
  if (tag === 'select') {
    field.values = getSelectValues(el);
  }

  if (type === 'radio' || type === 'checkbox') {
    field.values = [el.attr('value')];
  }

  return field
}

/**
 * チェックボックスとラジオのフィールドをマージする(valuesをまとめる)
 * @param fields
 * @returns {*[]}
 */
function mergeFields(fields) {
  let results = [];
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
  })
  return results
}

function getSubmitInfo(el) {
  const submit = {};
  const name = el.attr('name');
  const id = el.attr('id');
  const classes = el.attr('class');
  const html = el.prop('outerHTML');

  if (name) submit.name = name;
  if (id) submit.id = id;
  if (classes) submit.classes = classes;
  if (html) submit.html = html;

  return submit
}

function getSelectValues(el) {
  return el.find('option').map(function() {
    return el.attr('value')
  }).get();
}

function stripAttributes(html) {
  const $ = cheerio.load(html, {decodeEntities: false});

  $('*').each(function() {
    const attrs = this.attribs;
    for (let attr in attrs) {
      $(this).removeAttr(attr);
    }
  });

  let cleanedHtml = $.html();
  cleanedHtml = cleanedHtml.replace(/\n\s*\n/g, '\n'); // remove empty lines
  cleanedHtml = cleanedHtml.replace(/>\s+</g, '><'); // remove spaces between tags
  return cleanedHtml;
}

module.exports = {
  extractFormHTML,
  analyzeFields,
  formatAndLogFormData,
  getFieldsAndSubmit,
  stripAttributes,
};