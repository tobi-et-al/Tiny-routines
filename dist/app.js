const KEY='tiny-routines-v1';
let state=JSON.parse(localStorage.getItem(KEY)||'null')||{name:'little one',entries:[]};
const $=s=>document.querySelector(s);
const today=()=>new Date().toISOString().slice(0,10);
const esc=s=>String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function save(){localStorage.setItem(KEY,JSON.stringify(state));render()}
function formatDate(){return new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date())}
function formatTime(t){let [h,m]=t.split(':');let d=new Date();d.setHours(h,m);return d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}
function render(){
 $('#displayName').textContent=state.name; $('#babyNameButton').textContent=(state.name[0]||'L').toUpperCase(); $('#todayLabel').textContent=formatDate();
 const entries=state.entries.filter(e=>e.date===today()).sort((a,b)=>a.time.localeCompare(b.time));
 const feeds=entries.filter(e=>e.type==='feed'), diapers=entries.filter(e=>e.type==='diaper'), sleeps=entries.filter(e=>e.type==='sleep');
 $('#feedsCount').textContent=feeds.length; $('#diaperCount').textContent=diapers.length; $('#wetCount').textContent=diapers.filter(e=>e.kind==='wet'||e.kind==='both').length+' wet'; $('#dirtyCount').textContent=diapers.filter(e=>e.kind==='dirty'||e.kind==='both').length+' dirty';
 let mins=sleeps.reduce((n,e)=>n+(Number(e.duration)||0),0); $('#sleepTotal').textContent=Math.floor(mins/60)+'h '+(mins%60)+'m'; $('#sleepBarFill').style.width=Math.min(100,mins/900*100)+'%';
 const timeline=$('#timeline'); timeline.classList.toggle('empty-state',!entries.length);
 timeline.innerHTML=entries.length?entries.map(e=>`<div class="timeline-entry"><div class="entry-time">${formatTime(e.time)}</div><div class="entry-rail"><i class="entry-dot"></i></div><div class="entry-body"><button class="delete-entry" data-delete="${e.id}" aria-label="Delete entry">×</button><div class="entry-title">${esc(label(e))}</div><div class="entry-meta">${esc(meta(e))}${e.note?' · '+esc(e.note):''}</div></div></div>`).join(''):`<div class="empty-illustration">☼</div><h3>A quiet start</h3><p>Log a feed, nap, diaper, or note to begin today's rhythm.</p>`;
 document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{state.entries=state.entries.filter(e=>e.id!==b.dataset.delete);save();toast('Entry removed')});
}
function label(e){return e.type==='feed'?'Feed':e.type==='sleep'?'Sleep':e.type==='diaper'?'Diaper':'Note'}
function meta(e){if(e.type==='feed')return `${e.method||'Feed'}${e.amount?' · '+e.amount+' oz':''}`;if(e.type==='sleep')return `${e.duration||0} minutes`;if(e.type==='diaper')return (e.kind||'wet').replace(/^./,x=>x.toUpperCase());return 'Remembered moment'}
function fields(type){return type==='feed'?'<label>Method<select id="fieldMethod"><option>Breast</option><option>Bottle</option><option>Formula</option></select></label><label>Amount (optional)<input id="fieldAmount" type="number" min="0" step="0.5" placeholder="oz"></label>':type==='sleep'?'<label>Duration (minutes)<input id="fieldDuration" type="number" min="1" required placeholder="e.g. 45"></label>':type==='diaper'?'<label>Type<select id="fieldKind"><option value="wet">Wet</option><option value="dirty">Dirty</option><option value="both">Wet + dirty</option></select></label>':'<p class="subtle" style="margin-top:14px">Capture a sweet moment, a question, or anything you want to remember.</p>'}
 function openModal(type='feed'){ $('#entryType').value=type; $('#dynamicFields').innerHTML=fields(type); $('#entryTime').value=new Date().toTimeString().slice(0,5); $('#modalBackdrop').hidden=false; $('#entryType').focus() }
 function closeModal(){ $('#modalBackdrop').hidden=true }
 $('#addEntryButton').onclick=()=>openModal(); document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>openModal(b.dataset.quick)); $('#closeModal').onclick=closeModal; $('#modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()}; $('#entryType').onchange=e=>$('#dynamicFields').innerHTML=fields(e.target.value);
 $('#entryForm').onsubmit=e=>{e.preventDefault();let type=$('#entryType').value;let x={id:crypto.randomUUID(),date:today(),time:$('#entryTime').value,type,note:$('#entryNote').value.trim()};if(type==='feed'){x.method=$('#fieldMethod').value;x.amount=$('#fieldAmount').value}else if(type==='sleep')x.duration=$('#fieldDuration').value;else if(type==='diaper')x.kind=$('#fieldKind').value;state.entries.push(x);save();closeModal();toast('Saved to today');e.target.reset()};
 $('#clearToday').onclick=()=>{if(confirm('Clear all of today\'s entries?')){state.entries=state.entries.filter(e=>e.date!==today());save();toast('Today cleared')}};
 $('#babyNameButton').onclick=()=>{let n=prompt('What should we call your baby?',state.name);if(n&&n.trim()){state.name=n.trim();save()}};
 const exportData=()=>download('tiny-routines.json',JSON.stringify(state,null,2),'application/json'); $('#exportTop').onclick=exportData; $('#downloadJson').onclick=exportData; $('#copyData').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(state,null,2));toast('Data copied to clipboard')}catch{toast('Copy unavailable in this browser')}};
function download(name,data,type){let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href);toast('Download ready')}
function toast(t){let x=$('#toast');x.textContent=t;x.classList.add('show');setTimeout(()=>x.classList.remove('show'),2200)}
render();
