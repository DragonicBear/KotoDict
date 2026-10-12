const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = html.slice(html.indexOf('function normalizeUnitSearch('), html.indexOf('\nfunction ps()'));

function autocomplete(characters) {
    const inputs = Array.from({ length: 13 }, () => {
        const events = {};
        return {
            value: '', events,
            classList: { add() {} },
            parentElement: { appendChild(dropdown) { this.dropdown = dropdown; } },
            addEventListener(name, handler) { events[name] = handler; },
        };
    });
    const context = vm.createContext({
        wanakana: require('../vendor/wanakana.min.js'), characters, ri: inputs.slice(0, 12), friendInput: inputs[12],
        document: { createElement() {
            const classes = new Set();
            return {
                innerHTML: '',
                classList: {
                    add: name => classes.add(name), remove: name => classes.delete(name),
                    contains: name => classes.has(name),
                },
                querySelectorAll: () => [],
            };
        } },
        cc: { clear() {} }, ps() {}, setTimeout,
    });
    vm.runInContext(source + '\nsetupCharAutocomplete();', context);
    return inputs;
}

function search(input, query) {
    input.value = query;
    input.events.input();
    const dropdown = input.parentElement.dropdown;
    return dropdown.classList.contains('open') ? dropdown.innerHTML : '';
}

test('all deck slots and friend search match kana scripts and preserve selection letters', () => {
    const characters = JSON.parse(fs.readFileSync(path.join(root, 'characters.json'), 'utf8'));
    for (const input of autocomplete(characters)) {
        const expected = search(input, 'キュウセイ');
        assert.ok(expected.includes('キュウセイ'));
        for (const query of ['きゅうせい', 'きュうセい', 'ｷｭｳｾｲ', '  きゅうせい  ', 'kyuusei', 'KYUUSEI', 'ｋｙｕｕｓｅｉ', 'kyuuせい']) {
            assert.equal(search(input, query), expected, query);
        }
        input.events.keydown({ key: 'ArrowDown', preventDefault() {} });
        input.events.keydown({ key: 'Enter', preventDefault() {} });
        assert.equal(input.value, characters.find(c => c.name === 'キュウセイ').hiragana);
        assert.equal(input.parentElement.dropdown.classList.contains('open'), false);
        assert.equal(search(input, '  '), '');
        assert.equal(search(input, 'no-such-unit'), '');
    }
});

test('matching is bidirectional and handles voiced kana while preserving other name searches', () => {
    const [input] = autocomplete([
        { name: 'ぱぴぷぺぽ・ゔぁー', hiragana: 'はばぱ' },
        { name: 'ガッツ(天)ABC', hiragana: 'かが' },
    ]);
    assert.ok(search(input, 'パピプペポ・ヴァー').includes('ぱぴぷぺぽ・ゔぁー'));
    const expected = search(input, 'ガッツ');
    for (const query of ['がっつ', 'か\u3099っつ', 'ｶﾞｯﾂ', '天', 'abc']) {
        assert.equal(search(input, query), expected, query);
    }
    assert.equal(search(input, 'かが'), ''); // Deck letters are not a unit-name reading.
});

test('autocomplete keeps the existing result order and 15-result limit', () => {
    const [input] = autocomplete(Array.from({ length: 20 }, (_, i) => ({ name: `カナ${i}`, hiragana: 'か' })));
    const results = search(input, 'かな');
    assert.equal((results.match(/class="char-name"/g) || []).length, 15);
    assert.ok(results.indexOf('カナ0<') < results.indexOf('カナ14<'));
    assert.ok(!results.includes('カナ15<'));
});


test('romaji unit names support long vowels and keep Latin name searches literal', () => {
    const [input] = autocomplete([
        { name: 'ゲーム', hiragana: 'けげ' },
        { name: 'ABC(天)', hiragana: 'あ' },
    ]);
    const expected = search(input, 'ゲーム');
    for (const query of ['geemu', 'ge-mu', 'げーむ']) assert.equal(search(input, query), expected);
    assert.ok(search(input, 'abc').includes('ABC(天)'));
});
