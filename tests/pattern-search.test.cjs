const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const functions = [
    html.slice(html.indexOf('function getAssignedBoxes('), html.indexOf('const DECK_STORAGE_KEY')),
    html.slice(html.indexOf('// Maximum one-to-one matching:'), html.indexOf('function setupCharAutocomplete(')),
    html.slice(html.indexOf('function ps()'), html.indexOf('function swp(')),
].join('\n');

function search({ words, units, pattern = '', roles = [], logic = 'AND', board = [], onlyDeck = true, friend = '' }) {
    const resultCount = {}, resultList = {};
    const context = vm.createContext({
        wanakana: require('../vendor/wanakana.min.js'),
        d: words.map(word => ({word, displays: [], combo: 0})),
        ri: units.map(value => ({value})), boxRoles: roles, friendInput: {value: friend},
        pi: Array.from({length: 7}, (_, i) => ({value: board[i] || ''})),
        ss: {value: 'asc'}, ts: {value: pattern}, rab: {checked: false},
        uad: {checked: onlyDeck}, cl: logic, ff: [], selectedThemes: new Set(),
        updateDeckSaveStatus() {}, cp() { return 0; },
        document: {
            getElementById: id => id === 'resultCount' ? resultCount : resultList,
            querySelectorAll: () => [],
        },
    });
    vm.runInContext(functions + '\nps();', context);
    const results = [...(resultList.innerHTML || '').matchAll(/class="result-item[^\"]*" data-board="([^"]+)"/g)].map(m => m[1]);
    return {results, markup: resultList.innerHTML, context};
}

test('empty and literal searches include longer words containing any choice from one unit', () => {
    const words = ['さい', 'いさ', 'さいしょう', 'こうさい', 'あいう', 'かき'];
    for (const roles of [[], ['A']]) {
        const empty = search({words, units: ['sai'], roles});
        assert.deepEqual(new Set(empty.results), new Set(words.slice(0, 5)));
        assert.deepEqual(search({words, units: ['sai'], roles, pattern: 'kou'}).results, ['こうさい']);
    }
});

test('enough units fill every wildcard and each unit supplies only one choice', () => {
    assert.deepEqual(search({words: ['こうさい', 'こういさ', 'こうかい'], units: ['sai', 'sai'], pattern: 'kou--', roles: ['A', 'B']}).results, ['こうさい', 'こういさ']);
    assert.deepEqual(search({words: ['さい', 'さう', 'いう'], units: ['sai', 'u'], pattern: '--'}).results, ['さう', 'いう']);
});

test('extra wildcard slots allow unknown kana while matching available units once', () => {
    const result = search({words: ['さいしょう', 'さかしょう', 'かきしょう'], units: ['sai', 'sai'], pattern: '--sho-', roles: ['A', 'B']});
    assert.deepEqual(result.results, ['さいしょう', 'さかしょう']);
    const first = result.markup.split('class="result-item')[1];
    assert.equal((first.match(/color:#c62828/g) || []).length, 1);
    assert.equal((first.match(/color:#1565c0/g) || []).length, 1);
    assert.deepEqual(search({words: ['こうさい', 'こうかい', 'こうかき'], units: ['sai'], pattern: 'kou--'}).results, ['こうさい', 'こうかい']);
});

test('both match modes colour each assigned box at most once and preserve fixed pattern positions', () => {
    for (const logic of ['OR', 'AND']) {
        const result = search({words: ['さいさい'], units: ['sai'], roles: ['A'], logic});
        assert.deepEqual(result.results, ['さいさい']);
        assert.equal((result.markup.match(/color:#c62828/g) || []).length, 1);
        assert.equal(search({words: ['さい'], units: ['sa'], roles: ['A'], logic, pattern: 'sa-'}).results.length, 0);
    }
});

test('overlapping choices are reassigned to find a complete unit matching', () => {
    const result = search({words: ['さい'], units: ['sai', 'sa'], roles: ['A', 'B'], pattern: '--'});
    assert.deepEqual(result.results, ['さい']);
    assert.ok(result.markup.includes('Deck: 2/2'));
    assert.equal((result.markup.match(/color:#c62828/g) || []).length, 1);
    assert.equal((result.markup.match(/color:#1565c0/g) || []).length, 1);
});

test('board searches also require distinct units for empty positions', () => {
    assert.equal(search({words: ['こうさい'], units: ['sai'], board: ['ko', 'u']}).results.length, 0);
    assert.equal(search({words: ['こうさい'], units: ['sai', 'sai'], board: ['ko', 'u']}).results.length, 1);
});

test('friend counts as one unit and disabling only-deck leaves wildcard slots open', () => {
    assert.deepEqual(search({words: ['さい'], units: ['sa'], friend: 'i', pattern: '--'}).results, ['さい']);
    assert.deepEqual(search({words: ['さい'], units: ['sa', 'u'], roles: ['A'], onlyDeck: false, pattern: '--'}).results, ['さい']);
});
