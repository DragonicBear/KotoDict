const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('const DECK_STORAGE_KEY='), html.indexOf('function init(){'));
const stateKey = 'kotodict-app-state-v1', loadoutKey = 'kotodict-loadouts-v1';
const copy = value => JSON.parse(JSON.stringify(value));
function element(value = '') {
    const classes = new Set();
    return {value, checked:false, open:false, hidden:true, disabled:false, textContent:'', innerHTML:'', events:{}, attributes:{},
        classList:{toggle(name, active) { if(active)classes.add(name);else classes.delete(name); }, contains:name=>classes.has(name), remove:name=>classes.delete(name)},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, fn) { this.events[name] = fn; },
        replaceChildren() {}, appendChild() {}, focus() {},
    };
}
function session(storage = new Map(), failure = {}) {
    const nodes = new Map(), get = id => { if(!nodes.has(id))nodes.set(id,element());return nodes.get(id); };
    const lengths = ['2','3','4','5','6','7'].map(element), themes = ['鳥','日本史'].map(element);
    const document = {visibilityState:'visible',events:{},getElementById:get,createElement:()=>element(),
        addEventListener(name, fn) { this.events[name] = fn; },
        querySelectorAll(selector) {
            if(selector === 'input[name="chars"]:checked')return lengths.filter(input=>input.checked);
            if(selector === 'input[name="chars"]')return lengths;
            if(selector === '.theme-checkbox')return themes;
            return [];
        },
    };
    const context = vm.createContext({
        NUM_DECK_BOXES:12, document, window:element(), localStorage:{
            getItem(key) { if(failure.read)throw Error('Blocked');return storage.get(key) ?? null; },
            setItem(key,value) { if(failure.write)throw Error('Quota');storage.set(key,value); },
        },
        crypto:{randomUUID:()=> 'new-loadout'},
        pi:Array.from({length:7},()=>element()),ri:Array.from({length:12},()=>element()),
        boxRoles:Array(12).fill(''),friendInput:element(),cl:'AND',uad:{checked:true},
        rs:element(),or2:element(),cc:{clear() {}},ff:Array(7).fill(false),
        tg:Array.from({length:7},()=>element()),ts:element(),ss:element('combo-desc'),rab:element(),
        selectedThemes:new Set(),themeSearchInput:element(),updateRoleBadge() {},
        filterThemeOptions() {},
    });
    context.updateThemeUI=()=>themes.forEach(input=>{input.checked=context.selectedThemes.has(input.value);});
    context.scheduleSearch=()=>context.persistAppState();
    vm.runInContext(source, context);
    context.setupDeckStorage();context.setupAppStateStorage();
    return {context,storage,get,lengths,themes,snapshot:()=>copy(context.currentAppState())};
}
function edit(session) {
    const c=session.context;
    c.pi[0].value='kou';c.pi[3].value='し';c.ff[2]=true;
    c.ri[0].value='さい';c.ri[8].value='kyuusei';c.boxRoles[0]='B';c.boxRoles[8]='D';
    c.friendInput.value='う';c.cl='OR';c.uad.checked=false;
    c.ts.value='--sho-';c.ss.value='asc';c.rab.checked=true;
    session.lengths[2].checked=true;session.lengths[4].checked=true;
    c.selectedThemes=new Set(['鳥']);c.themeSearchInput.value='tori';
    session.get('boardSection').open=true;session.get('filtersSection').open=true;
}

test('refresh restores board, unsaved deck, filters, query, sorting and expanded sections', () => {
    const first=session();edit(first);first.context.persistAppState();
    const second=session(first.storage);
    assert.deepEqual(second.snapshot(),first.snapshot());
    assert.equal(second.context.pi[0].classList.contains('filled'),true);
    assert.equal(second.context.tg[2].textContent,'C');
    assert.equal(second.context.tg[2].attributes['aria-pressed'],'true');
    assert.equal(second.context.rs.classList.contains('or-mode'),true);
    assert.equal(second.themes[0].checked,true);
});

test('empty fields and disabled toggles replace earlier values on the next refresh', () => {
    const first=session();edit(first);first.context.persistAppState();
    const defaults=session().snapshot();
    first.context.restoreAppState(defaults);first.context.persistAppState();
    assert.deepEqual(session(first.storage).snapshot(),defaults);
});

test('session draft overrides the active loadout without changing the named preset', () => {
    const baseline=session().snapshot().deck;
    baseline.slots[0]='かき';
    const library={version:1,activeId:'preset',loadouts:[{id:'preset',name:'Team',deck:baseline}]};
    const storage=new Map([[loadoutKey,JSON.stringify(library)]]);
    const first=session(storage);
    assert.equal(first.context.ri[0].value,'かき'); // Upgrade from loadouts-only storage.
    edit(first);first.context.persistAppState();
    const second=session(storage);
    assert.deepEqual(second.snapshot(),first.snapshot());
    assert.equal(storage.get(loadoutKey),JSON.stringify(library));
    assert.match(second.get('deckSaveStatus').textContent,/not saved to that loadout/);
    second.get('loadDeckBtn').events.click(); // Explicit Load replaces the draft and persists it.
    assert.deepEqual(session(storage).snapshot().deck,baseline);
});

test('malformed and unsupported state is ignored without overwriting it on startup', () => {
    const baseline=session().snapshot();
    const invalid=['broken JSON',JSON.stringify({...baseline,version:99}),JSON.stringify({...baseline,board:['a']}),
        JSON.stringify({...baseline,sort:'invalid'}),JSON.stringify({...baseline,characterTiles:Array(7).fill('true')}),
        JSON.stringify({...baseline,deck:{...baseline.deck,roles:Array(12).fill('A')}})];
    for(const raw of invalid) {
        const storage=new Map([[stateKey,raw]]),app=session(storage);
        assert.deepEqual(app.snapshot(),baseline);
        app.context.persistAppState();
        assert.equal(storage.get(stateKey),raw);
        assert.equal(app.get('appStateStatus').hidden,false);
        app.context.ts.value='kou--';app.context.persistAppState();
        assert.equal(session(storage).context.ts.value,'kou--');
    }
});

test('unavailable storage does not block editing, and failed writes can be retried', () => {
    const failure={read:true,write:true},app=session(new Map(),failure);
    edit(app);
    assert.doesNotThrow(()=>app.context.persistAppState());
    assert.match(app.get('appStateStatus').textContent,/could not save/);
    failure.read=failure.write=false;
    app.context.persistAppState();
    assert.deepEqual(session(app.storage).snapshot(),app.snapshot());
    assert.equal(app.get('appStateStatus').hidden,true);
});

test('page hide, backgrounding and disclosure toggles save the latest changes', () => {
    for(const event of ['pagehide','visibilitychange','toggle']) {
        const app=session();edit(app);
        if(event==='pagehide')app.context.window.events.pagehide();
        if(event==='visibilitychange') {
            app.context.document.visibilityState='hidden';app.context.document.events.visibilitychange();
        }
        if(event==='toggle')app.get('boardSection').events.toggle();
        assert.deepEqual(session(app.storage).snapshot(),app.snapshot(),event);
    }
});

test('obsolete selected themes are dropped when restoring against the current dictionary', () => {
    const baseline=session().snapshot();baseline.themes=['鳥','Removed theme'];
    const app=session(new Map([[stateKey,JSON.stringify(baseline)]]));
    assert.deepEqual(app.snapshot().themes,['鳥']);
});

test('typing is saved immediately even before a debounced search runs', () => {
    const app=session(),c=app.context;
    c.setTimeout=()=>1;c.clearTimeout=()=>{};
    c.requestAnimationFrame=()=>1;c.cancelAnimationFrame=()=>{};
    vm.runInContext(html.slice(html.indexOf('let searchTimer='),html.indexOf('function ps()')),c);
    c.ts.value='kou--';c.uad.checked=false;
    c.scheduleSearch(150);
    const refreshed=session(app.storage);
    assert.equal(refreshed.context.ts.value,'kou--');
    assert.equal(refreshed.context.uad.checked,false);
});
