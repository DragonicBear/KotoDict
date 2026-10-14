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

const wanakana = require('../vendor/wanakana.min.js');
const themeFilterSource = html.slice(html.indexOf('const THEME_READINGS='), html.indexOf('function updateThemeUI('));
const normalizationSource = html.slice(html.indexOf('function normalizeUnitSearch('), html.indexOf('function setupCharAutocomplete('));
function loadThemeFilter(themes, kanaLibrary = wanakana) {
    const options = themes.map((theme, i) => {
        const input = {value: theme, checked: i === 0};
        return {textContent: `${theme} 12345`, input, style: {}, querySelector: () => input};
    });
    const context = vm.createContext({wanakana: kanaLibrary, document: {querySelectorAll: () => options}});
    vm.runInContext(normalizationSource + themeFilterSource, context);
    return {context, options, filter(query) {
        context.filterThemeOptions(query);
        return options.filter(opt => opt.style.display === 'flex').map(opt => opt.input.value);
    }};
}

test('theme options match romaji, hiragana, katakana and kanji readings', () => {
    const {filter} = loadThemeFilter(['ゲーム', '日本史', '鳥', '学校', 'スポーツ選手', '囲碁・将棋・麻雀', 'いきもの']);
    for(const query of ['ゲーム', 'げーむ', 'げえむ', 'geemu', 'ge-mu', 'ＧＥＥＭＵ', 'ｹﾞｰﾑ']) {
        assert.deepEqual(filter(query), ['ゲーム'], query);
    }
    for(const query of ['日本史', 'にほんし', 'ニホンシ', 'nihonshi', 'nihonsi', '  NIHONSHI  ', 'nihon', 'にっぽんし']) {
        assert.deepEqual(filter(query), ['日本史'], query);
    }
    for(const [query, theme] of [['tori', '鳥'], ['gakkou', '学校'], ['supootsu', 'スポーツ選手'], ['senshu', 'スポーツ選手'], ['shougi', '囲碁・将棋・麻雀'], ['ma-jan', '囲碁・将棋・麻雀'], ['ikimono', 'いきもの']]) {
        assert.deepEqual(filter(query), [theme], query);
    }
});

test('filtering preserves labels and selections, clears on whitespace, and ignores result counts', () => {
    const {filter, options} = loadThemeFilter(['鳥', '日本史', '東京23区', 'ABC']);
    const labels = options.map(opt => opt.textContent);
    assert.deepEqual(filter('12345'), []);
    assert.deepEqual(filter('23'), ['東京23区']);
    assert.deepEqual(filter('toukyou23ku'), ['東京23区']);
    assert.deepEqual(filter('toukyounijuusanku'), ['東京23区']);
    assert.deepEqual(filter('abc'), ['ABC']);
    assert.deepEqual(filter('no-such-theme'), []);
    assert.deepEqual(filter('  '), ['鳥', '日本史', '東京23区', 'ABC']);
    assert.deepEqual(options.map(opt => opt.input.checked), [true, false, false, false]);
    assert.deepEqual(options.map(opt => opt.textContent), labels);
});

test('every current kanji theme has a searchable kana and romaji reading', () => {
    const rows = JSON.parse(fs.readFileSync(path.join(root, 'words.json'), 'utf8'));
    const themes = [...new Set(rows.flatMap(row => row[4] || []))];
    const {context, filter} = loadThemeFilter(themes);
    const aliases = vm.runInContext('THEME_READINGS', context);
    for(const theme of themes) {
        if(/\p{Script=Han}/u.test(theme))assert.ok(aliases[theme], `Missing reading for ${theme}`);
        const reading = (aliases[theme] || theme).split('|')[0];
        assert.ok(filter(reading).includes(theme), `${theme}: ${reading}`);
        const romaji = wanakana.toRomaji(reading);
        assert.ok(filter(romaji).includes(theme), `${theme}: ${romaji}`);
    }
});

test('theme readings are cached so further keystrokes convert only the query', () => {
    let conversions = 0;
    const {filter} = loadThemeFilter(['ゲーム', '日本史'], {
        ...wanakana, toKatakana(...args) { conversions++; return wanakana.toKatakana(...args); },
    });
    filter('ge');
    const first = conversions;
    filter('geemu');
    assert.equal(conversions - first, 1);
});
