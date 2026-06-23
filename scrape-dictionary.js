const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  await page.setRequestInterception(true);
  page.on('request', req => req.continue());
  page.on('response', async res => {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    if (ct.includes('javascript') && url.includes('gaccag.com')) {
      try {
        const text = await res.text();
        if (text.length > 50000) console.log('Large JS file:', url, `(${text.length} bytes)`);
      } catch (_) {}
    }
  });

  console.log('Loading dictionary page...');
  await page.goto('https://gaccag.com/kotodaman/dictionary/', {
    waitUntil: 'networkidle0',
    timeout: 60000
  });

  const wordData = await page.evaluate(() => {
    for (const key of Object.keys(window)) {
      const val = window[key];
      if (
        Array.isArray(val) &&
        val.length > 500 &&
        Array.isArray(val[0]) &&
        typeof val[0][0] === 'string' &&
        /^[\u3040-\u309F]/.test(val[0][0])
      ) {
        console.log('Found variable:', key, 'length:', val.length);
        return val;
      }
    }
    return null;
  });

  await browser.close();

  if (!wordData) {
    console.error('Could not find dictionary data.');
    process.exit(1);
  }

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/dictionary.json', JSON.stringify(wordData));
  console.log(`Saved ${wordData.length} entries to data/dictionary.json`);
})();
