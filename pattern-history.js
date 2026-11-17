/* Manually saved patterns, separate from saved deck and current app state. */
function createPatternHistory(options){
    const input=options.input,normalize=options.normalize,onSelect=options.onSelect;
    const doc=options.document||document,win=options.window||window;
    const storage=options.storage||(()=>win.localStorage);
    const key='kotodict-pattern-history-v1',limit=50;
    const list=doc.getElementById('patternHistoryList'),count=doc.getElementById('patternHistoryCount');
    const empty=doc.getElementById('patternHistoryEmpty'),status=doc.getElementById('patternHistoryStatus');
    const clear=doc.getElementById('clearPatternHistory'),save=doc.getElementById('savePattern');
    let entries=[],composing=false;
    const valid=value=>typeof value==='string'&&value.length>0&&value.length<=500&&/^[\u3041-\u3096ー-]+$/.test(value);
    function notice(message){status.textContent=message;status.hidden=!message;}
    function read(){
        const raw=storage().getItem(key);
        if(raw===null)return [];
        const data=JSON.parse(raw);
        if(!data||data.version!==1||!Array.isArray(data.patterns)||data.patterns.length>limit||
            !data.patterns.every(valid))throw Error('Invalid pattern history');
        return [...new Set(data.patterns)];
    }
    function write(next){
        try{
            storage().setItem(key,JSON.stringify({version:1,patterns:next}));
            entries=next;notice('');return true;
        }catch(e){
            notice('Could not save pattern history in this browser. Your searches still work.');
            return false;
        }
    }
    function updateSaveButton(){save.disabled=composing||!valid(normalize(input.value.trim(),true));}
    function render(){
        list.replaceChildren();
        count.textContent=String(entries.length);
        empty.hidden=entries.length>0;clear.disabled=entries.length===0;
        entries.forEach((pattern,index)=>{
            const row=doc.createElement('li');
            const reuse=doc.createElement('button'),remove=doc.createElement('button');
            reuse.type=remove.type='button';
            reuse.className='pattern-history-reuse';reuse.textContent=pattern;
            reuse.setAttribute('aria-label','Search again: '+pattern);
            remove.className='pattern-history-delete';remove.textContent='×';
            remove.setAttribute('aria-label','Delete pattern: '+pattern);
            reuse.addEventListener('click',()=>{
                input.value=pattern;updateSaveButton();
                onSelect();input.focus({preventScroll:true});
            });
            remove.addEventListener('click',()=>{
                if(write(entries.filter(item=>item!==pattern))){
                    render();
                    const next=list.children[Math.min(index,list.children.length-1)];
                    (next?next.children[1]:doc.querySelector('#patternHistory summary')).focus({preventScroll:true});
                }
            });
            row.append(reuse,remove);list.appendChild(row);
        });
    }
    save.addEventListener('click',()=>{
        updateSaveButton();
        if(save.disabled)return;
        const pattern=normalize(input.value.trim(),true);
        if(entries.length>=limit&&!entries.includes(pattern)){
            notice('You have 50 saved patterns. Delete one before saving another.');return;
        }
        if(write([pattern,...entries.filter(item=>item!==pattern)])){
            render();notice('Saved pattern: '+pattern);
        }
    });
    input.addEventListener('input',updateSaveButton);
    input.addEventListener('compositionstart',()=>{composing=true;updateSaveButton();});
    input.addEventListener('compositionend',()=>{composing=false;updateSaveButton();});
    input.addEventListener('keydown',event=>{
        if(event.key==='Enter'&&!event.isComposing&&!composing)onSelect();
    });
    doc.getElementById('clearBtn').addEventListener('click',updateSaveButton);
    clear.addEventListener('click',()=>{
        if(write([])){render();doc.querySelector('#patternHistory summary').focus({preventScroll:true});}
    });
    try{entries=read();}catch(e){notice('Could not read pattern history. Use Save pattern to try saving if browser storage is available.');}
    render();updateSaveButton();
}
if(typeof module!=='undefined'&&module.exports)module.exports={createPatternHistory};
