const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = vm.createContext({ NUM_DECK_BOXES: 12 });
vm.runInContext(html.slice(html.indexOf('const DECK_STORAGE_KEY='), html.indexOf('function init(){')), context);
const deck = () => ({ version: 1, slots: Array(12).fill('かきく'), roles: ['A', 'B', 'C', 'D', ...Array(8).fill('')], friend: 'きゅう', logic: 'AND', onlyDeck: true });
const library = () => ({version: 1, activeId: 'fire', loadouts: [{id: 'fire', name: 'Fire team', deck: deck()}]});

test('valid loadouts allow independent decks and an empty saved collection', () => {
    const data = library();
    data.loadouts.push({id: 'water', name: 'Water team', deck: {...deck(), logic: 'OR', onlyDeck: false}});
    assert.equal(context.validLoadoutLibrary(data), true);
    assert.equal(context.validLoadoutLibrary({version: 1, activeId: null, loadouts: []}), true);
});

test('reject malformed storage instead of partially restoring or overwriting it', () => {
    for (const modify of [
        d => { d.version = 99; },
        d => { d.activeId = 'missing'; },
        d => { d.loadouts.push({...d.loadouts[0]}); },
        d => { d.loadouts.push({...d.loadouts[0], id: 'other', name: 'FIRE TEAM'}); },
        d => { d.loadouts[0].name = ' '; },
        d => { d.loadouts[0].deck.roles[1] = 'A'; },
        d => { d.loadouts[0].deck.slots[0] = null; },
        d => { d.loadouts[0].deck.slots.pop(); },
    ]) {
        const data = library();modify(data);
        assert.equal(context.validLoadoutLibrary(data), false);
    }
});
