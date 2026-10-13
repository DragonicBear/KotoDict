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

function search({ words, units, pattern = '', roles = [], logic = 'AND', board = [], onlyDeck = true, friend = '', sort = 'asc' }) {
    const resultCount = {}, resultList = {};
    const context = vm.createContext({
        wanakana: require('../vendor/wanakana.min.js'),
        d: words.map(word => (typeof word==='string'?{word, displays: [], combo: 0}:word)),
        ri: units.map(value => ({value})), boxRoles: roles, friendInput: {value: friend},
        pi: Array.from({length: 7}, (_, i) => ({value: board[i] || ''})),
        ss: {value: sort}, ts: {value: pattern}, rab: {checked: false},
        uad: {checked: onlyDeck}, cl: logic, ff: [], selectedThemes: new Set(),
        updateDeckSaveStatus() {}, cp() { return 0; },
        document: {
            getElementById: id => id === 'resultCount' ? resultCount : resultList,
            querySelectorAll: () => [],
        },
    });
    vm.runInContext(functions + '\nps();', context);
    const results = [...(resultList.innerHTML || '').matchAll(/class="result-item[^\"]*" data-board="([^"]+)"/g)].map(m => m[1]);
    return {results, markup: resultList.innerHTML, count: resultCount.textContent, context};
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

test('fast counter agrees with exhaustive one-unit-per-position matching', () => {
    const {context} = search({words: [], units: []});
    const kana = 'さいう';
    let seed = 17;
    const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    function brute(word, units, excluded, pos = 0, used = 0) {
        if(pos === word.length)return 0;
        let best = brute(word, units, excluded, pos + 1, used);
        if(excluded.has(pos))return best;
        units.forEach((unit, i) => {
            if(!(used & (1 << i)) && unit.chars.includes(word[pos])) {
                best = Math.max(best, 1 + brute(word, units, excluded, pos + 1, used | (1 << i)));
            }
        });
        return best;
    }
    for(let sample = 0; sample < 500; sample++) {
        const units = Array.from({length: random(6)}, () => ({chars: [...kana].filter(() => random(2))}));
        const counter = context.createUnitCounter(units);
        for(let reuse = 0; reuse < 3; reuse++) {
            const word = Array.from({length: random(8)}, () => kana[random(kana.length)]).join('');
            const excluded = new Set([...word].map((_, i) => i).filter(() => random(3) === 0));
            const expected = brute(word, units, excluded);
            assert.equal(counter(word, excluded), expected);
            assert.equal(counter(word, excluded, 1), Math.min(expected, 1));
        }
    }
});

test('bounded result buckets preserve count, rank, stable ties, and the 300-result limit', () => {
    const words = Array.from({length: 900}, (_, i) => ({
        word: ['さい', 'あさ', 'ういう', 'あさいあ'][i % 4],
        displays: [`entry-${i}`], combo: i % 7,
    }));
    for(const sort of ['asc', 'desc', 'combo-asc', 'combo-desc']) {
        for(const onlyDeck of [true, false]) {
            const result = search({words, units: ['sa', 'i'], roles: ['A', 'B'], sort, onlyDeck});
            const expected = [...words].sort((a, b) => {
                const rank = w => w.word.includes('さ') && w.word.includes('い') ? 0 : 1;
                const refine = rank(a) - rank(b);
                const score = w => sort.startsWith('combo') ? w.combo : w.word.length;
                return refine || (score(a) - score(b)) * (sort.endsWith('desc') ? -1 : 1);
            }).slice(0, 300).map(w => w.displays[0]);
            const actual = [...result.markup.matchAll(/<span>(entry-\d+) /g)].map(m => m[1]);
            assert.deepEqual(actual, expected, `${sort}, onlyDeck=${onlyDeck}`);
            assert.equal(result.count, 'Found 900 words (Showing first 300)');
        }
    }
});

test('search scheduling paints first and cancels superseded typing or role changes', () => {
    const frames = new Map(), timers = new Map();
    let nextId = 0, searches = 0;
    const context = vm.createContext({
        requestAnimationFrame: fn => { frames.set(++nextId, fn); return nextId; },
        cancelAnimationFrame: id => frames.delete(id),
        setTimeout: fn => { timers.set(++nextId, fn); return nextId; },
        clearTimeout: id => timers.delete(id),
        ps: () => searches++,
    });
    vm.runInContext(html.slice(html.indexOf('let searchTimer='), html.indexOf('function ps()')), context);
    function flush(queue) {
        for(const [id, fn] of [...queue]) { queue.delete(id); fn(); }
    }
    context.scheduleSearch(150);
    context.scheduleSearch(); // Selecting a unit supersedes its typing debounce.
    assert.equal(timers.size, 0);
    context.scheduleSearch(); // Rapid badge changes coalesce.
    assert.equal(frames.size, 1);
    assert.equal(searches, 0);
    flush(frames);
    assert.equal(searches, 0); // Rendering gets a turn before the filter starts.
    context.scheduleSearch(150); // New typing also cancels a search after its frame.
    flush(timers);
    flush(frames);
    flush(timers);
    assert.equal(searches, 1);
    assert.equal(frames.size + timers.size, 0);
});

test('colour assignments are only built for displayed results', () => {
    const {context} = search({words: Array(1000).fill('さい'), units: ['sai'], roles: ['A']});
    const match = context.matchUnitPositions;
    let assignments = 0;
    context.matchUnitPositions = (...args) => { assignments++; return match(...args); };
    context.ps();
    assert.equal(assignments, 300);
});
