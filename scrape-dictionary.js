const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Strategy 1: Capture all JS file contents during load
  const capturedJS = [];
  await page.setRequestInterception(true);
  page.on('request', req => req.continue());
  page.on('response', async res => {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    if (ct.includes('javascript') || url.endsWith('.js')) {
      try {
        const text = await res.text();
        console.log(`JS file: ${url} (${text.length} bytes)`);
        if (text.length > 5000) capturedJS.push({ url, text });
      } catch (_) {}
    }
  });

  console.log('Loading page...');
  await page.goto('https://gaccag.com/kotodaman/dictionary/', {
    waitUntil: 'networkidle0',
    timeout: 60000
  });

  // Strategy 2: Broad window scan — log everything that looks like an array
  const windowScan = await page.evaluate(() => {
    const results = [];
    for (const key of Object.keys(window)) {
      try {
        const val = window[key];
        if (Array.isArray(val) && val.length > 50) {
          const first = val[0];
          results.push({
            key,
            length: val.length,
            firstType: typeof first,
            firstIsArray: Array.isArray(first),
            preview: JSON.stringify(first).slice(0, 80)
          });
        }
      } catch (_) {}
    }
    return results;
  });

  console.log('Window arrays found:');
  windowScan.forEach(r => {
    console.log(`  window.${r.key} [${r.length}] first=${r.preview}`);
  });

  // Strategy 3: Try to find hiragana data in window
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
          console.log('Found via window scan:', key);
          return val;
        }
      } catch (_) {}
    }
    return null;
  });

  // Strategy 4: Trigger a search and try again
  if (!wordData) {
    console.log('Window scan failed. Triggering search interaction...');
    try {
      // Type a broad search to force data to load
      await page.focus('input[type="text"]');
      await page.keyboard.type('あ');
      await page.waitForTimeout(2000);

      wordData = await page.evaluate(() => {
        for (const key of Object.keys(window)) {
          try {
            const val = window[key];
            if (
              Array.isArray(val) && val.length > 50 &&
              Array.isArray(val[0]) &&
              typeof val[0][0] === 'string' &&
              /^[\u3040-\u309F]/.test(val[0][0])
            ) {
              return val;
            }
          } catch (_) {}
        }
        return null;
      });
    } catch (e) {
      console.warn('Search interaction failed:', e.message);
    }
  }

  // Strategy 5: Parse the raw JS files for an inline array
  if (!wordData) {
    console.log('Trying to parse JS file contents directly...');
    for (const { url, text } of capturedJS) {
      // Look for a large array of hiragana arrays e.g. [["あ...
      const match = text.match(/=\s*(\[\s*\["[\u3040-\u309F]/);
      if (match) {
        console.log('Potential data array found in:', url);
        // Extract from the match position to end, then find the closing bracket
        try {
          const startIdx = text.indexOf(match[0]) + 1; // skip the '='
          // Use a depth counter to find the end of the outer array
          let depth = 0, i = startIdx, inString = false, escape = false;
          for (; i < text.length; i++) {
            const c = text[i];
            if (escape) { escape = false; continue; }
            if (c === '\\') { escape = true; continue; }
            if (c === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (c === '[') depth++;
            if (c === ']') { depth--; if (depth === 0) { i++; break; } }
          }
          const raw = text.slice(startIdx, i);
          wordData = JSON.parse(raw);
          console.log(`Parsed ${wordData.length} entries from JS file`);
          break;
        } catch (e) {
          console.warn('Parse attempt failed:', e.message);
        }
      }
    }
  }

  await browser.close();

  if (!wordData) {
    console.error('All strategies failed. Check the JS file list above for clues.');
    process.exit(1);
  }

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/dictionary.json', JSON.stringify(wordData));
  console.log(`Saved ${wordData.length} entries to data/dictionary.json`);
})();
