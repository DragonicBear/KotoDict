const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = html.slice(html.indexOf('function buildThemeSubwordMap()'), html.indexOf('\nlet pi,'));

function loadMatcher(rows) {
    const context = vm.createContext({ rows });
    vm.runInContext(`
        const wordThemeMap = new Map();
        for (const [word, themes] of rows) {
            wordThemeMap.set(word, [...new Set([...(wordThemeMap.get(word) || []), ...themes])]);
        }
        const themeSubwordMap = new Map();
        let themeSubwordMapBuilt = false;
        ${source}
    `, context);
    return context;
}

test('theme matching preserves direct, substring, duplicate-reading and OR matches', () => {
    const rows = [
        ['あい', ['気持ち']], ['あい', ['鳥']], ['あいさつ', []],
        ['うみ', ['自然']], ['あいうみ', []], ['あ', ['文字']],
        ['かあいか', []], ['かかあい', []], ['あいあい', []], ['かき', []],
    ];
    const context = loadMatcher(rows);
    for (const selected of [[], ['鳥'], ['自然'], ['文字'], ['鳥', '自然'], ['missing']]) {
        for (const [word] of rows) {
            const expected = rows.some(([directWord, themes]) =>
                word.includes(directWord) && themes.some(theme => selected.includes(theme)));
            assert.equal(context.wordMatchesThemes(word, selected), expected, `${word}: ${selected}`);
        }
    }
    // Reusing the index must neither rebuild it nor change results.
    vm.runInContext('wordThemeMap.clear()', context);
    assert.equal(context.wordMatchesThemes('あいさつ', ['鳥']), true);
});

test('full dictionary builds and filters within a bounded execution time', () => {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'words.json'), 'utf8'));
    const rows = data.map(entry => [entry[0], entry[4] || []]);
    const context = loadMatcher(rows);
    const started = performance.now();
    vm.runInContext(`
        buildThemeSubwordMap();
        rows.filter(([word]) => wordMatchesThemes(word, ['鳥']));
        rows.filter(([word]) => wordMatchesThemes(word, ['自然', '気持ち']));
        rows.filter(([word]) => wordMatchesThemes(word, [...themeSubwordMap.keys()]));
    `, context, { timeout: 10000 });
    console.log(`${rows.length} dictionary rows: build + three filters in ${Math.round(performance.now() - started)} ms`);
    // Check real dictionary results against the original includes-based rule.
    const directWords = rows.filter(([, themes]) => themes.includes('鳥')).map(([word]) => word);
    for (let i = 0; i < rows.length; i += 197) {
        const word = rows[i][0];
        assert.equal(context.wordMatchesThemes(word, ['鳥']), directWords.some(direct => word.includes(direct)), word);
    }
});
