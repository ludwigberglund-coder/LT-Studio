const app=document.getElementById('batches-app');
let ctx=null,batches=[],selected=null,txs=[],events=[];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kr=ore=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'}).format((Number(ore)||0)/100);
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function badge(s){const label={draft:'Utkast',ready:'Redo',approved:'Godkänd',rejected:'Avvisad'}[s]||s;return '<span class="status-badge status-'+esc(s)+'">'+esc(label)+'</span>'}
function lineTemplate(line={}){return '<div class="line-grid batch-line"><input data-f="account" placeholder="Konto" maxlength="4" value="'+esc(line.account||'')+'"><input data-f="description" placeholder="Radtext" value="'+esc(line.description||'')+'"><input data-f="debit" inputmode="decimal" placeholder="Debet kr" value="'+esc(line.debit_ore?line.debit_ore/100:'')+'"><input data-f="credit" inputmode="decimal" placeholder="Kredit kr" value="'+esc(line.credit_ore?line.credit_ore/100:'')+'"><button class="button ghost sm" data-action="remove-line">Ta bort</button></div>'}
function txTemplate(tx={},i=0){const lines=(tx.lines?.length?tx.lines:[{},{}]).map(lineTemplate).join('');return '<section class="transaction" data-tx="'+i+'"><div class="transaction-head"><input data-f="date" type="date" value="'+esc(tx.posting_date||today())+'"><textarea data-f="description" rows="2" placeholder="Beskriv transaktionen">'+esc(tx.description||'')+'</textarea><button class="button ghost sm" data-action="remove-tx">Ta bort transaktion</button></div><div class="lines">'+lines+'</div><button class="button ghost sm" data-action="add-line">+ Lägg till rad</button></section>'}
function render(){
 const q=(document.querySelector('[data-search]')?.value||'').trim();
 const list=batches.filter(b=>!q||String(b.batch_number).includes(q)).map(b=>'<button class="batch-card '+(selected?.id===b.id?'active':'')+'" data-id="'+esc(b.id)+'"><span><span class="batch-no">#'+String(b.batch_number).padStart(5,'0')+'</span><br><span>'+esc(b.title)+'</span><br><span class="batch-meta">'+b.transaction_count+' transaktioner · '+kr(b.total_debit_ore)+'</span></span>'+badge(b.status)+'</button>').join('');
 const editor=!selected?'<div class="empty">Välj en bunt eller skapa en ny.</div>':'<div class="batch-form-row"><label>Namn<input id="batch-title" value="'+esc(selected.title)+'" '+(selected.status==='approved'?'disabled':'')+'></label><label>Externt kontrollbelopp (kr)<input id="batch-external" inputmode="decimal" value="'+esc(selected.external_total_ore==null?'':selected.external_total_ore/100)+'" '+(selected.status==='approved'?'disabled':'')+'></label></div><div class="batch-summary"><span class="summary-pill">Bunt #'+String(selected.batch_number).padStart(5,'0')+'</span><span class="summary-pill">'+selected.transaction_count+' transaktioner</span><span class="summary-pill">Debet '+kr(selected.total_debit_ore)+'</span><span class="summary-pill">Kredit '+kr(selected.total_credit_ore)+'</span><span class="summary-pill '+(selected.control_state==='balanced'?'ok':'err')+'">'+(selected.control_state==='balanced'?'Balanserad':'Kontroll krävs')+'</span>'+badge(selected.status)+'</div><div id="transactions">'+txs.map(txTemplate).join('')+'</div>'+(selected.status!=='approved'?'<button class="button ghost" data-action="add-tx">+ Lägg till transaktion</button>':'')+'<div class="batch-actions">'+(selected.status!=='approved'?'<button class="button ghost" data-action="save">Spara</button><button class="button" data-action="ready">Kontrollera & markera redo</button>':'')+(selected.status==='ready'?'<button class="button" data-action="approve">Godkänn bunt</button>':'')+(selected.status!=='approved'&&selected.status!=='draft'?'<button class="button ghost" data-action="reopen">Återöppna</button>':'')+'</div><details><summary>Revisionsspår</summary><div class="batch-meta">'+events.map(e=>esc(new Date(e.created_at).toLocaleString('sv-SE'))+' · '+esc(e.event_type)).join('<br>')+'</div></details>';
 app.innerHTML='<main class="batch-shell"><div class="batch-head"><div><h1>Buntar</h1><p>Ekonomiskt granskningslager. Inget påverkar huvudboken före godkännande.</p></div><div class="batch-actions"><input class="batch-search" data-search placeholder="Sök buntnummer" value="'+esc(q)+'"><button class="button" data-action="new">+ Ny bunt</button></div></div><div class="batch-layout"><aside class="batch-list">'+(list||'<div class="empty">Inga buntar ännu.</div>')+'</aside><article class="batch-editor">'+editor+'</article></div></main>';
}
async function load(){
 ctx=await window.LTSupabaseUat.context();if(!ctx?.authenticated)throw new Error('Du måste logga in.');
 const token=ctx.session.access_token,company=ctx.company.id;
 batches=await LTSupabase.from('financial_batches',token).select('*','company_id=eq.'+encodeURIComponent(company)+'&order=created_at.desc');
 if(selected){selected=batches.find(b=>b.id===selected.id)||null;if(selected)await loadDetail(selected.id)}
 render();
}
async function loadDetail(id){
 const token=ctx.session.access_token,company=ctx.company.id;
 const raw=await LTSupabase.from('financial_batch_transactions',token).select('*','company_id=eq.'+encodeURIComponent(company)+'&batch_id=eq.'+encodeURIComponent(id)+'&order=sequence_number.asc');
 const ids=raw.map(x=>x.id);let lines=[];
 if(ids.length)lines=await LTSupabase.from('financial_batch_lines',token).select('*','company_id=eq.'+encodeURIComponent(company)+'&transaction_id=in.('+ids.map(encodeURIComponent).join(',')+')&order=line_number.asc');
 txs=raw.map(t=>({...t,lines:lines.filter(l=>l.transaction_id===t.id)}));
 events=await LTSupabase.from('financial_batch_events',token).select('*','company_id=eq.'+encodeURIComponent(company)+'&batch_id=eq.'+encodeURIComponent(id)+'&order=created_at.desc');
}
function readTransactions(){
 return [...document.querySelectorAll('.transaction')].map(tx=>({postingDate:tx.querySelector('[data-f=date]').value,description:tx.querySelector('textarea[data-f=description]').value,sourceType:'manual',lines:[...tx.querySelectorAll('.batch-line')].map(l=>({account:l.querySelector('[data-f=account]').value,description:l.querySelector('[data-f=description]').value,debitOre:Math.round((Number(String(l.querySelector('[data-f=debit]').value).replace(',','.'))||0)*100),creditOre:Math.round((Number(String(l.querySelector('[data-f=credit]').value).replace(',','.'))||0)*100)}))}));
}
async function rpc(name,args){return LTSupabase.rpc(name,args,ctx.session.access_token)}
async function save(){
 const external=document.getElementById('batch-external').value.trim();
 await rpc('save_financial_batch',{p_company_id:ctx.company.id,p_batch_id:selected.id,p_title:document.getElementById('batch-title').value,p_external_total_ore:external===''?null:Math.round(Number(external.replace(',','.'))*100),p_transactions:readTransactions()});await load();
}
app.addEventListener('input',e=>{if(e.target.matches('[data-search]'))render()});
app.addEventListener('click',async e=>{
 const btn=e.target.closest('button');if(!btn)return;
 try{
  if(btn.dataset.id){selected=batches.find(b=>b.id===btn.dataset.id);await loadDetail(selected.id);render();return}
  const a=btn.dataset.action;
  if(a==='new'){const [r]=await rpc('create_financial_batch',{p_company_id:ctx.company.id,p_title:'Ny bunt',p_external_total_ore:null});await load();selected=batches.find(b=>b.id===r.batch_id);await loadDetail(selected.id);render()}
  if(a==='add-tx'){txs.push({posting_date:today(),description:'',lines:[{},{}]});render()}
  if(a==='remove-tx'){const i=Number(btn.closest('.transaction').dataset.tx);txs.splice(i,1);render()}
  if(a==='add-line'){const i=Number(btn.closest('.transaction').dataset.tx);txs[i].lines ||= [];txs[i].lines.push({});render()}
  if(a==='remove-line'){const tx=btn.closest('.transaction'),i=Number(tx.dataset.tx),li=[...tx.querySelectorAll('.batch-line')].indexOf(btn.closest('.batch-line'));txs[i].lines.splice(li,1);render()}
  if(a==='save')await save();
  if(a==='ready'){await save();await rpc('mark_financial_batch_ready',{p_company_id:ctx.company.id,p_batch_id:selected.id});await load()}
  if(a==='reopen'){await rpc('reopen_financial_batch',{p_company_id:ctx.company.id,p_batch_id:selected.id});await load()}
  if(a==='approve'){if(confirm('Godkänna bunten? Då blir transaktionerna definitiva och bunten låses.')){await rpc('approve_financial_batch',{p_company_id:ctx.company.id,p_batch_id:selected.id});await load()}}
 }catch(err){alert(err.message||String(err))}
});
(async()=>{try{await load()}catch(e){app.innerHTML='<main class="boot"><strong>Kunde inte öppna Buntar</strong><span>'+esc(e.message)+'</span></main>'}})();