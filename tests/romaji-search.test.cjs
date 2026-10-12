const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const wanakana = require('../vendor/wanakana.min.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('function normalizeUnitSearch('), html.indexOf('function setupCharAutocomplete('));
const context = vm.createContext({ wanakana });
vm.runInContext(source, context);

test('romaji supports common spellings, small kana, voiced sounds and syllabic n', () => {
    for (const [input, expected] of [
        ['kyuusei', 'きゅうせい'], ['SHINBUN', 'しんぶん'], ['ｋａｔａｋａｎａ', 'かたかな'],
        ['gakkou', 'がっこう'], ['matcha', 'まっちゃ'], ['shashin', 'しゃしん'],
        ['sya', 'しゃ'], ['si', 'し'], ['ti', 'ち'], ['tu', 'つ'],
        ["kan'i", 'かんい'], ['kanni', 'かんに'], ['nya', 'にゃ'],
        ['xtsu', 'っ'], ['ltsu', 'っ'], ['fa', 'ふぁ'], ['va', 'ゔぁ'],
        ['ge-mu', 'げーむ'], ['kyuuセイ', 'きゅうせい'], ['k', 'k'], ['sh', 'sh'],
    ]) assert.equal(context.normalizeKanaInput(input), expected, input);
});

test('patterns retain wildcard positions after conversion and keep Japanese punctuation', () => {
    for (const [input, expected] of [
        ['ka--', 'か--'], ['--shi', '--し'], ['kya-n', 'きゃ-ん'],
        ['---', '---'], ['カ--', 'か--'], ['ｶﾞ--', 'が--'],
        ['geーmu', 'げーむ'], ['ダセット(静寂)', 'だせっと(静寂)'],
    ]) assert.equal(context.normalizeKanaInput(input, true), expected, input);
});

test('board/deck pool sources use equivalent kana and romaji without double-counting friend letters', () => {
    const ctx = vm.createContext({ wanakana });
    vm.runInContext(source + html.slice(html.indexOf('function getAssignedBoxes('), html.indexOf('function init(')), ctx);
    function capture(values, friend) {
        ctx.ri = values.map(value => ({ value }));
        ctx.friendInput = { value: friend };
        ctx.boxRoles = ['A', 'B'];
        return JSON.stringify({boxes: ctx.getAssignedBoxes(), pool: [...ctx.getDeckPool()]});
    }
    assert.equal(capture(['kakiku', 'shajacho'], 'pya'), capture(['かきく', 'しゃじゃちょ'], 'ぴゃ'));
    assert.equal(ctx.getDeckPool().get('ぴ'), 1);
    assert.equal(ctx.isFormableFromPool('ぴぴ', ctx.getDeckPool()), false);
});
