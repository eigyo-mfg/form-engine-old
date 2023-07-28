const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

async function run() {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (req.url().includes('www.google-analytics.com')) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.goto('https://sales-bank.com/contact/', { waitUntil: 'networkidle0' });

    // Wait for the form tag to be rendered
    await page.waitForSelector('form');

    const html = await page.content();
    const $ = cheerio.load(html);

    let formsHTML = [];
    $('form').each(function() {
        formsHTML.push($(this).html());
    });

    console.log(formsHTML);

    // If no form is found, look for iframe
    if (formsHTML.length === 0) {
        $('iframe').each(async function() {
            const iframeSrc = $(this).attr('src');
            if (iframeSrc) {
                const iframePage = await browser.newPage();
                await iframePage.goto(iframeSrc, { waitUntil: 'networkidle0' });

                // Wait for the form tag to be rendered in the iframe
                await iframePage.waitForSelector('form');

                const iframeHTML = await iframePage.content();
                const $iframe = cheerio.load(iframeHTML);
                $iframe('form').each(function() {
                    formsHTML.push($iframe(this).html());
                });
            }
        });
    }

    // Find the longest form HTML
    let longestFormHTML = formsHTML.reduce((a, b) => a.length > b.length ? a : b, "");

    // Check if the HTML is malformed
    const malformedHtmlRegex = /<([a-z][a-z0-9]*)\b[^>]*>(.*?)<\/\1>/g;
    if (!malformedHtmlRegex.test(longestFormHTML)) {
        console.log("The HTML is malformed. Executing alternative process...");

        // Extract form content using regex
        const formRegex = /<form[^>]*>([\s\S]*?)<\/form>/gi;
        let match;
        while ((match = formRegex.exec(html)) !== null) {
            console.log("Found a form: ", match[0]);
        }
    } else {
        console.log(longestFormHTML);
    }

    await browser.close();
}

run().catch(console.error);
