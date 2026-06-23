const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { execSync } = require('child_process');

function findChromium() {
  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log('Found Chromium at:', p);
      return p;
    }
  }
  try {
    const found = execSync('which chromium-browser || which chromium').toString().trim();
    console.log('Found Chromium via which:', found);
    return found;
  } catch (_) {}
  return null;
}

(async () => {
  const executablePath = findChromium();
  if (!executablePath) {
    console.error('Chromium not found. Install it before running.');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();

  const capturedJS = [];
  await page.setRequestInterception(true);
  page.on('request', req => req.continue());
  page.on('response', async res => {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    if (ct.includes('javascript') || url.endsWith('.js')) {
      try {
        const text = await res.text();
        console.log('JS: ' + url + ' (' + text.length + ' bytes)');
        if (text.length > 5000) capturedJS.push({ url, text });
      } catch (_) {}
    }
  });

  console.log('Loading page...');
  await page.goto('https://gaccag.com/kotodaman/dictionary/', {
    waitUntil: 'networkidle0',
    timeout: 60000
  });

  const windowScan = await page.evaluate(() => {
    const results = [];
    for (const key of Object.keys(window)) {
      try {
        const val = window[key];
        if (Array.isArray(val) && val.length > 50) {
          results.push({
            key,
            length: val.length,
            preview: JSON.stringify(val[0]).slice(0, 100)
          });
        }
      } catch (_) {}
    }
    return results;
  });

  console.log('Window arrays:');
  windowScan.forEach(r => console.log('  window.' + r.key + ' [' + r.length + ']: ' + r.preview));

  let wordData = await page.evaluate(() => {
    for (const key of Object.keys(window)) {
      try {
        const val = window[key];
        if (
          Array.isArray(val) && val.length > 50 &&
          Array.isArray(val[0]) &&
          typeof val[0][0] === 'string' &&
          /^[\u3040-\u309F]/.test(val[0][0])
        ) {
          console.log('Found:', key);
          return val;
        }
      } catch (_) {}
    }
    return null;
  });

  if (!wordData) {
    console.log('Trying search interaction...');
    try {
      const inputs = await page.$$('input[type="text"]');
      if (inputs.length > 0) {
        await inputs[0].type('\u3042');
        await new Promise(r => setTimeout(r, 2000));
        wordData = await page.evaluate(() => {
          for (const key of Object.keys(window)) {
            try {
              const val = window[key];
              if (
                Array.isArray(val) && val.length > 50 &&
                Array.isArray(val[0]) &&
                typeof val[0][0] === 'string' &&
                /^[\u3040-\u309F]/.test(val[0][0])
              ) return val;
            } catch (_) {}
          }
          return null;
        });
      }
    } catch (e) {
      console.warn('Search interaction error:', e.message);
    }
  }

  if (!wordData) {
    console.log('Scanning JS file contents...');
    for (const { url, text } of capturedJS) {
      const match = text.match(/=\s*(\[\s*\["[\u3040-\u309F]/);
      if (match) {
        console.log('Array pattern found in:', url);
        try {
          const startIdx = text.indexOf(match[0]) + 1;
          let depth = 0, i = startIdx, inStr = false, esc = false;
          for (; i < text.length; i++) {
            const c = text[i];
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === '[') depth++;
            if (c === ']') { depth--; if (depth === 0) { i++; break; } }
          }
          wordData = JSON.parse(text.slice(startIdx, i));
          console.log('Parsed ' + wordData.length + ' entries from ' + url);
          break;
        } catch (e) {
          console.warn('Parse failed:', e.message);
        }
      }
    }
  }

  await browser.close();

  if (!wordData) {
    console.error('All strategies failed. Check the JS file list and window arrays above.');
    process.exit(1);
  }

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/dictionary.json', JSON.stringify(wordData));
  console.log('Done -- saved ' + wordData.length + ' entries.');
})();
