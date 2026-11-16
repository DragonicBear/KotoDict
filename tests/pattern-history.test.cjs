const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const wanakana=require('../vendor/wanakana.min.js');
const {createPatternHistory}=require('../pattern-history.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const normalize=new Function('wanakana',html.slice(html.indexOf('function normalizeUnitSearch('),html.indexOf('function setupCharAutocomplete('))+';return normalizeKanaInput;')(wanakana);
const key='kotodict-pattern-history-v1';
function element(){
    return {value:'',children:[],events:{},attributes:{},hidden:false,disabled:false,textContent:'',
        addEventListener(type,fn){this.events[type]=fn;},
        setAttribute(name,value){this.attributes[name]=value;},
        appendChild(child){this.children.push(child);child.parent=this;},
        append(...children){children.forEach(child=>this.appendChild(child));},
        replaceChildren(){this.children=[];},
        contains(child){while(child){if(child===this)return true;child=child.parent;}return false;},
        focus(){this.focused=true;},
        fire(type,event={}){this.events[type]?.(event);}
    };
}
function app(storage=new Map(),failure={}){
    const ids=Object.fromEntries(['patternHistory','patternHistoryList','patternHistoryCount','patternHistoryEmpty','patternHistoryStatus','clearPatternHistory'].map(id=>[id,element()]));
    const summary=element(),input=element(),win=element(),doc=element();
    ids.patternHistory.append(summary,ids.patternHistoryList,ids.clearPatternHistory);
    doc.getElementById=id=>ids[id];doc.querySelector=()=>summary;doc.createElement=element;
    let serial=0,searches=0;const timers=new Map();
    createPatternHistory({input,normalize,onSelect:()=>searches++,document:doc,window:win,
        storage:()=>({getItem(name){if(failure.read)throw Error('Blocked');return storage.get(name)??null;},
            setItem(name,value){if(failure.write)throw Error('Quota');storage.set(name,value);}}),
        setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)});
    return {input,win,doc,ids,storage,summary,timers,
        type(value){input.value=value;input.fire('input');},
        flush(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}},
        patterns(){return JSON.parse(storage.get(key)||'{"patterns":[]}').patterns;},
        get searches(){return searches;},
        rows(){return ids.patternHistoryList.children;}
    };
}
test('romaji/kana normalize to unique hiragana history while wildcards stay intact',()=>{
    const a=app();
    for(const input of ['kou--','こう--','コウ--','ＫＯＵ--']){a.type(input);a.flush();}
    assert.deepEqual(a.patterns(),['こう--']);
    a.type('--sho-');a.input.fire('keydown',{key:'Enter'});
    assert.deepEqual(a.patterns(),['--しょ-','こう--']);
});
test('rapid typing records the final pattern instead of each keystroke',()=>{
    const a=app();for(const query of ['k','ko','kou','kou--'])a.type(query);
    assert.equal(a.timers.size,1);assert.deepEqual(a.patterns(),[]);
    a.flush();assert.deepEqual(a.patterns(),['こう--']);
});
test('empty and unfinished romaji are ignored',()=>{
    const a=app();
    for(const query of ['','   ','k','sh','a'.repeat(501),'<script>']){a.type(query);a.flush();}
    assert.deepEqual(a.patterns(),[]);
    a.type('---');a.flush();assert.deepEqual(a.patterns(),['---']);
});
test('refresh restores history, and repeated searches move to the front',()=>{
    const a=app();a.type('sai');a.flush();a.type('kou--');a.flush();
    const b=app(a.storage);
    assert.deepEqual(b.rows().map(row=>row.children[0].textContent),['こう--','さい']);
    b.type('sai');b.flush();assert.deepEqual(b.patterns(),['さい','こう--']);
});
test('reuse runs the search and updates the input with the saved hiragana',()=>{
    const a=app();a.type('kou--');a.flush();
    a.rows()[0].children[0].fire('click');
    assert.equal(a.input.value,'こう--');assert.equal(a.searches,1);assert.equal(a.input.focused,true);
});
test('clicking history while typing preserves the pending search without losing the clicked button',()=>{
    const a=app();a.type('kou--');a.flush();a.type('sai');
    const reuse=a.rows()[0].children[0];
    a.input.fire('blur',{relatedTarget:reuse});
    assert.equal(a.rows()[0].children[0],reuse);
    reuse.fire('click');
    assert.deepEqual(a.patterns(),['こう--','さい']);assert.equal(a.searches,1);
});
test('deleting the current pattern persists without being recreated on blur or page hide',()=>{
    const a=app();a.type('sai');a.flush();a.type('kou--');a.flush();
    a.rows()[0].children[1].fire('click');
    a.input.fire('blur');a.win.fire('pagehide');a.flush();
    assert.deepEqual(app(a.storage).patterns(),['さい']);assert.equal(a.input.value,'kou--');
    assert.equal(a.rows()[0].children[1].focused,true);
});
test('clear history cancels pending entries and stays cleared after refresh',()=>{
    const a=app();a.type('sai');a.flush();a.type('kou--');
    a.ids.clearPatternHistory.fire('click');a.flush();a.win.fire('pagehide');
    assert.deepEqual(app(a.storage).patterns(),[]);
    assert.equal(a.ids.clearPatternHistory.disabled,true);assert.equal(a.summary.focused,true);
});
test('history is limited to the 50 most recent patterns',()=>{
    const a=app();for(let i=1;i<=55;i++){a.type('あ'.repeat(i));a.flush();}
    assert.equal(a.patterns().length,50);assert.equal(a.patterns()[0].length,55);
    assert.equal(a.patterns()[49].length,6);
});
test('Japanese composition is not saved until it is finished',()=>{
    const a=app();a.input.fire('compositionstart');a.type('に');
    a.input.fire('keydown',{key:'Enter',isComposing:true});a.flush();
    assert.deepEqual(a.patterns(),[]);
    a.input.value='にほん';a.input.fire('compositionend');a.flush();
    assert.deepEqual(a.patterns(),['にほん']);
});
test('blur, page hide and backgrounding save pending searches',()=>{
    for(const event of ['blur','pagehide','visibilitychange']){
        const a=app();a.type('kou--');
        if(event==='blur')a.input.fire('blur');
        if(event==='pagehide')a.win.fire('pagehide');
        if(event==='visibilitychange'){a.doc.visibilityState='hidden';a.doc.fire('visibilitychange');}
        assert.deepEqual(app(a.storage).patterns(),['こう--'],event);
    }
});
test('malformed storage is preserved until a new search is saved',()=>{
    const storage=new Map([[key,'invalid JSON']]),a=app(storage);
    assert.equal(storage.get(key),'invalid JSON');assert.equal(a.ids.patternHistoryStatus.hidden,false);
    a.type('sai');a.flush();assert.deepEqual(a.patterns(),['さい']);
});
test('blocked writes leave existing history intact and report the failure',()=>{
    const storage=new Map([[key,JSON.stringify({version:1,patterns:['さい']})]]),failure={write:true},a=app(storage,failure);
    a.rows()[0].children[1].fire('click');
    assert.deepEqual(a.patterns(),['さい']);assert.equal(a.rows().length,1);
    assert.equal(a.ids.patternHistoryStatus.hidden,false);
    failure.write=false;a.rows()[0].children[1].fire('click');assert.deepEqual(a.patterns(),[]);
});
test('restored current pattern is not silently added back to an empty history',()=>{
    const a=app();a.input.value='こう--';a.input.fire('blur');a.win.fire('pagehide');
    assert.deepEqual(a.patterns(),[]);
});

test('an explicit Enter can add a deleted pattern again',()=>{
    const a=app();a.type('kou--');a.flush();a.rows()[0].children[1].fire('click');
    a.input.fire('keydown',{key:'Enter'});
    assert.deepEqual(a.patterns(),['こう--']);assert.equal(a.searches,1);
});
