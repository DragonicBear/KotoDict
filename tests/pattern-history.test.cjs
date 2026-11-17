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
    const ids=Object.fromEntries(['patternHistory','patternHistoryList','patternHistoryCount','patternHistoryEmpty','patternHistoryStatus','clearPatternHistory','savePattern','clearBtn'].map(id=>[id,element()]));
    const summary=element(),input=element(),win=element(),doc=element();
    ids.patternHistory.append(summary,ids.patternHistoryList,ids.clearPatternHistory);
    doc.getElementById=id=>ids[id];doc.querySelector=()=>summary;doc.createElement=element;
    let serial=0,searches=0;const timers=new Map();
    createPatternHistory({input,normalize,onSelect:()=>searches++,document:doc,window:win,
        storage:()=>({getItem(name){if(failure.read)throw Error('Blocked');return storage.get(name)??null;},
            setItem(name,value){if(failure.write)throw Error('Quota');storage.set(name,value);}}),
        setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)});
    return {input,win,doc,ids,storage,summary,timers,
        save(){ids.savePattern.fire('click');},
        type(value){input.value=value;input.fire('input');},
        flush(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}},
        patterns(){return JSON.parse(storage.get(key)||'{"patterns":[]}').patterns;},
        get searches(){return searches;},
        rows(){return ids.patternHistoryList.children;}
    };
}
test('only Save pattern stores queries, normalized to hiragana with wildcards',()=>{
    const a=app();
    for(const query of ['kou--','こう--','コウ--','ＫＯＵ--']){a.type(query);a.save();}
    assert.deepEqual(a.patterns(),['こう--']);
    a.type('--sho-');a.save();assert.deepEqual(a.patterns(),['--しょ-','こう--']);
});
test('typing, idle, Enter, blur and leaving the page do not save queries',()=>{
    const a=app();a.type('kou--');a.flush();a.input.fire('keydown',{key:'Enter'});
    a.input.fire('blur');a.win.fire('pagehide');a.doc.visibilityState='hidden';a.doc.fire('visibilitychange');
    assert.deepEqual(a.patterns(),[]);assert.equal(a.searches,1);assert.equal(a.timers.size,0);
});
test('empty and incomplete queries disable Save pattern',()=>{
    const a=app();assert.equal(a.ids.savePattern.disabled,true);
    for(const query of ['','   ','k','sh','a'.repeat(501),'<script>']){
        a.type(query);assert.equal(a.ids.savePattern.disabled,true);a.save();
    }
    assert.deepEqual(a.patterns(),[]);
    a.type('---');assert.equal(a.ids.savePattern.disabled,false);a.save();assert.deepEqual(a.patterns(),['---']);
});
test('existing automatic history is retained and manual saves survive refresh',()=>{
    const storage=new Map([[key,JSON.stringify({version:1,patterns:['さい']})]]),a=app(storage);
    assert.equal(a.rows()[0].children[0].textContent,'さい');
    a.type('kou--');a.save();const b=app(storage);
    assert.deepEqual(b.patterns(),['こう--','さい']);
    b.type('sai');b.save();assert.deepEqual(b.patterns(),['さい','こう--']);
});
test('reuse searches without saving the current draft or rewriting history',()=>{
    const a=app();a.type('kou--');a.save();a.type('sai');a.save();a.type('ai');
    const raw=a.storage.get(key);
    a.rows()[1].children[0].fire('click');
    assert.equal(a.input.value,'こう--');assert.equal(a.searches,1);assert.equal(a.input.focused,true);
    assert.equal(a.storage.get(key),raw);
});
test('deleting does not save the current draft or recreate a removed pattern',()=>{
    const a=app();a.type('sai');a.save();a.type('kou--');a.save();a.type('ai');
    a.rows()[0].children[1].fire('click');a.input.fire('blur');a.win.fire('pagehide');a.flush();
    assert.deepEqual(app(a.storage).patterns(),['さい']);assert.equal(a.input.value,'ai');
});
test('clearing stays cleared, even if the input still contains a pattern',()=>{
    const a=app();a.type('sai');a.save();a.ids.clearPatternHistory.fire('click');
    a.input.fire('keydown',{key:'Enter'});a.win.fire('pagehide');a.flush();
    assert.deepEqual(app(a.storage).patterns(),[]);assert.equal(a.summary.focused,true);
    a.save();assert.deepEqual(a.patterns(),['さい']);
});
test('a full collection refuses a new save without silently deleting saved patterns',()=>{
    const a=app();for(let i=1;i<=50;i++){a.type('あ'.repeat(i));a.save();}
    const raw=a.storage.get(key);a.type('い');a.save();
    assert.equal(a.storage.get(key),raw);assert.match(a.ids.patternHistoryStatus.textContent,/Delete one/);
    a.type('あ');a.save();assert.equal(a.patterns().length,50);assert.equal(a.patterns()[0],'あ');
    a.rows()[1].children[1].fire('click');a.type('い');a.save();assert.equal(a.patterns()[0],'い');
});
test('Japanese composition cannot save an unfinished entry and finishing does not autosave',()=>{
    const a=app();a.input.fire('compositionstart');a.type('に');a.save();
    a.input.fire('keydown',{key:'Enter',isComposing:true});assert.deepEqual(a.patterns(),[]);
    a.input.value='にほん';a.input.fire('compositionend');a.flush();assert.deepEqual(a.patterns(),[]);
    a.save();assert.deepEqual(a.patterns(),['にほん']);
});
test('malformed storage is preserved until an explicit save',()=>{
    const storage=new Map([[key,'invalid JSON']]),a=app(storage);
    a.type('sai');a.flush();assert.equal(storage.get(key),'invalid JSON');
    a.save();assert.deepEqual(a.patterns(),['さい']);
});
test('failed saves and deletions keep existing data and allow retry',()=>{
    const storage=new Map([[key,JSON.stringify({version:1,patterns:['さい']})]]),failure={write:true},a=app(storage,failure);
    a.type('kou--');a.save();assert.deepEqual(a.patterns(),['さい']);assert.equal(a.ids.patternHistoryStatus.hidden,false);
    a.rows()[0].children[1].fire('click');assert.equal(a.rows().length,1);
    failure.write=false;a.save();assert.deepEqual(a.patterns(),['こう--','さい']);
});
test('board reset updates Save button availability without changing saved patterns',()=>{
    const a=app();a.type('sai');a.save();a.input.value='';a.ids.clearBtn.fire('click');
    assert.equal(a.ids.savePattern.disabled,true);assert.deepEqual(a.patterns(),['さい']);
});
