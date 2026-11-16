/* Recent pattern searches, separate from saved deck and current app state. */
function createPatternHistory(options){
    const input=options.input,normalize=options.normalize,onSelect=options.onSelect;
    const doc=options.document||document,win=options.window||window;
    const storage=options.storage||(()=>win.localStorage);
    const later=options.setTimeout||((fn,delay)=>win.setTimeout(fn,delay));
    const cancel=options.clearTimeout||(id=>win.clearTimeout(id));
    const key='kotodict-pattern-history-v1',limit=50;
    const list=doc.getElementById('patternHistoryList'),count=doc.getElementById('patternHistoryCount');
    const empty=doc.getElementById('patternHistoryEmpty'),status=doc.getElementById('patternHistoryStatus');
    const clear=doc.getElementById('clearPatternHistory');
    let entries=[],timer=null,dirty=false,composing=false;
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
    function stopTimer(){if(timer!==null)cancel(timer);timer=null;}
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
                remember();stopTimer();dirty=false;input.value=pattern;
                if(write([pattern,...entries.filter(item=>item!==pattern)]))render();
                onSelect();input.focus({preventScroll:true});
            });
            remove.addEventListener('click',()=>{
                // A later blur/pagehide must not silently recreate a deleted entry.
                remember();stopTimer();dirty=false;
                if(write(entries.filter(item=>item!==pattern))){
                    render();
                    const next=list.children[Math.min(index,list.children.length-1)];
                    (next?next.children[1]:doc.querySelector('#patternHistory summary')).focus({preventScroll:true});
                }
            });
            row.append(reuse,remove);list.appendChild(row);
        });
    }
    function remember(){
        stopTimer();
        if(!dirty||composing)return;
        const pattern=normalize(input.value.trim(),true);
        if(!valid(pattern)){dirty=false;return;}
        if(write([pattern,...entries.filter(item=>item!==pattern)].slice(0,limit))){
            dirty=false;render();
        }
    }
    function changed(){
        stopTimer();dirty=true;
        if(!composing)timer=later(remember,1200);
    }
    input.addEventListener('input',changed);
    input.addEventListener('compositionstart',()=>{composing=true;stopTimer();});
    input.addEventListener('compositionend',()=>{composing=false;changed();});
    input.addEventListener('keydown',event=>{
        if(event.key==='Enter'&&!event.isComposing&&!composing){dirty=true;remember();onSelect();}
    });
    input.addEventListener('blur',event=>{
        // Let a history button handle the pending query without replacing its DOM
        // between focus moving away from the input and the ensuing click.
        if(!doc.getElementById('patternHistory').contains(event.relatedTarget))remember();
    });
    win.addEventListener('pagehide',remember);
    doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='hidden')remember();});
    clear.addEventListener('click',()=>{
        stopTimer();dirty=false;
        if(write([])){render();doc.querySelector('#patternHistory summary').focus({preventScroll:true});}
    });
    try{entries=read();}catch(e){notice('Could not read pattern history. New searches will be saved if browser storage is available.');}
    render();
}
if(typeof module!=='undefined'&&module.exports)module.exports={createPatternHistory};
