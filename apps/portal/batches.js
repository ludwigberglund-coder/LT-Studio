const app=document.getElementById('batches-app');
const isDemo=new URLSearchParams(location.search).get('demo')==='1';
let ctx=null,batches=[],selected=null,txs=[],events=[],searchQuery='';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kr=ore=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'}).format((Number(ore)||0)/100);
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const role=()=>ctx?.membership?.role||'readonly';
const canEdit=()=>['admin','accountant'].includes(role());
const canApprove=()=>['admin','accountant','approver'].includes(role());
function badge(s){const label={draft:'Utkast',ready:'Redo för godkännande',approved:'Godkänd',rejected:'Avvisad'}[s]||s;return '<span class="status-badge status-'+esc(s)+'">'+esc(label)+'</span>'}
function lineTemplate(line={}){return '<div class="line-grid batch-line"><input data-f="account" placeholder="Konto" maxlength="4" value="'+esc(line.account||'')+'"><input data-f="description" placeholder="Radtext" value="'+esc(line.description||'')+'"><input data-f="debit" inputmode="decimal" placeholder="Debet kr" value="'+esc(line.debit_ore?line.debit_ore/100:'')+'"><input data-f="credit" inputmode="decimal" placeholder="Kredit kr" value="'+esc(line.credit_ore?line.credit_ore/100:'')+'"><button class="button ghost sm" data-action="remove-line">Ta bort</button></div>'}
function txTemplate(tx={},i=0){const lines=(tx.lines?.length?tx.lines:[{},{}]).map(lineTemplate).join('');const no=tx.transaction_number||String(selected.batch_number).padStart(5,'0')+'-'+String(i+1).padStart(3,'0');return '<section class="transaction" data-tx="'+i+'"><div class="batch-meta">Transaktion '+esc(no)+'</div><div class="transaction-head"><input data-f="date" type="date" value="'+esc(tx.posting_date||today())+'"><textarea data-f="description" rows="2" placeholder="Beskriv transaktionen">'+esc(tx.description||'')+'</textarea><button class="button ghost sm" data-action="remove-tx">Ta bort transaktion</button></div><div class="lines">'+lines+'</div><button class="button ghost sm" data-action="add-line">+ Lägg till rad</button></section>'}
function render(){
 const list=batches.filter(b=>!searchQuery||String(b.batch_number).includes(searchQuery)).map(b=>'<button class="batch-card '+(selected?.id===b.id?'active':'')+'" data-id="'+esc(b.id)+'"><span><span class="batch-no">#'+String(b.batch_number).padStart(5,'0')+'</span><br><span>'+esc(b.title)+'</span><br><span class="batch-meta">'+b.transaction_count+' transaktioner · '+kr(b.total_debit_ore)+'</span></span>'+badge(b.status)+'</button>').join('');
 let editor='<div class="empty">Välj en bunt eller skapa en ny.</div>';
 if(selected){
   const sourceBatch=selected.kind==='source';const editable=canEdit()&&!sourceBatch&&['draft','rejected'].includes(selected.status);
   const ready=selected.status==='ready';
   const approved=selected.status==='approved';
   const controls=[];
   if(editable){controls.push('<button class="button ghost" data-action="undo">Ångra osparade ändringar</button>','<button class="button ghost" data-action="bulk">Massregistrera</button>','<button class="button ghost" data-action="save">Spara</button>','<button class="button" data-action="ready">Kontrollera & markera redo</button>');}
   if(ready&&canEdit()&&!sourceBatch)controls.push('<button class="button ghost" data-action="reopen">Återöppna</button>');
   if(ready&&canApprove()){if(!sourceBatch)controls.push('<button class="button ghost" data-action="reject">Avvisa</button>');controls.push('<button class="button" data-action="approve">Godkänn bunt</button>');}
   editor='<div class="batch-form-row"><label>Namn<input id="batch-title" value="'+esc(selected.title)+'" '+(!editable?'disabled':'')+'></label><label>Externt kontrollbelopp (kr)<input id="batch-external" inputmode="decimal" value="'+esc(selected.external_total_ore==null?'':selected.external_total_ore/100)+'" '+(!editable?'disabled':'')+'></label></div><div class="batch-summary"><span class="summary-pill">Bunt #'+String(selected.batch_number).padStart(5,'0')+'</span>'+(sourceBatch?'<span class="summary-pill">Systembunt · källstyrd</span>':'')+'<span class="summary-pill">'+selected.transaction_count+' transaktioner</span><span class="summary-pill">Debet '+kr(selected.total_debit_ore)+'</span><span class="summary-pill">Kredit '+kr(selected.total_credit_ore)+'</span><span class="summary-pill '+(selected.control_state==='balanced'?'ok':'err')+'">'+(selected.control_state==='balanced'?'Balanserad':'Kontroll krävs')+'</span>'+badge(selected.status)+'</div><div id="transactions">'+txs.map(txTemplate).join('')+'</div>'+(editable?'<button class="button ghost" data-action="add-tx">+ Lägg till transaktion</button>':'')+'<div class="batch-actions">'+controls.join('')+'</div>'+(sourceBatch?'<p class="batch-meta">Den här bunten skapades av ett ekonomiskt källflöde. Innehållet är låst; godkännande aktiverar bokföring och reskontra atomiskt.</p>':'')+(ready&&canApprove()?'<p class="batch-meta">Du kan godkänna även en bunt du själv har skapat eller kontrollerat. Godkännandet loggas i revisionsspåret.</p>':'')+'<details><summary>Revisionsspår</summary><div class="batch-meta">'+(events.length?events.map(e=>esc(new Date(e.created_at).toLocaleString('sv-SE'))+' · '+esc(e.event_type)).join('<br>'):'Inga händelser ännu.')+'</div></details>';
 }
 app.innerHTML='<div class="batch-workspace"><aside class="sidebar"></aside><section class="batch-main"><header class="topbar"><div><h1>Buntar</h1><p>Ekonomiskt granskningslager. Inget påverkar huvudboken före godkännande.</p></div></header><main class="batch-shell"><div class="batch-head"><div><strong>Kvalitetskontroll före bokföring</strong><p>Senaste buntarna visas först. Sök på det femsiffriga buntnumret.</p></div><div class="batch-actions"><input class="batch-search" data-search placeholder="Sök buntnummer" value="'+esc(searchQuery)+'">'+(canEdit()?'<button class="button" data-action="new">+ Ny bunt</button>':'')+'</div></div><div class="batch-layout"><aside class="batch-list">'+(list||'<div class="empty">Inga buntar hittades.</div>')+'</aside><article class="batch-editor">'+editor+'</article></div></main></section></div>';
}
async function load(){
 if(isDemo){ctx={authenticated:true,membership:{role:'admin'},company:{id:'demo'},accessToken:''};batches=[];selected=null;txs=[];events=[];render();return}
 ctx=await window.LTSupabaseUat.context();if(!ctx?.authenticated)throw new Error('Du måste logga in.');
 const token=ctx.accessToken,company=ctx.company.id;
 batches=await LTSupabase.from('financial_batches',token).select('*','company_id=eq.'+encodeURIComponent(company)+'&order=created_at.desc');
 if(selected){selected=batches.find(b=>b.id===selected.id)||null;if(selected)await loadDetail(selected.id)}
 render();
}
async function loadDetail(id){
 const token=ctx.accessToken,company=ctx.company.id;
 const raw=await LTSupabase.from('financial_batch_transactions',token).select('*','company_id=eq.'+encodeURIComponent(company)+'&batch_id=eq.'+encodeURIComponent(id)+'&order=sequence_number.asc');
 const ids=raw.map(x=>x.id);let lines=[];
 if(ids.length)lines=await LTSupabase.from('financial_batch_lines',token).select('*','company_id=eq.'+encodeURIComponent(company)+'&transaction_id=in.('+ids.join(',')+')&order=line_number.asc');
 txs=raw.map(t=>({...t,lines:lines.filter(l=>l.transaction_id===t.id)}));
 events=await LTSupabase.from('financial_batch_events',token).select('*','company_id=eq.'+encodeURIComponent(company)+'&batch_id=eq.'+encodeURIComponent(id)+'&order=created_at.desc');
}
function captureTransactions(){
 return [...document.querySelectorAll('.transaction')].map(tx=>({posting_date:tx.querySelector('[data-f=date]').value,description:tx.querySelector('textarea[data-f=description]').value,transaction_number:tx.querySelector('.batch-meta')?.textContent.replace(/^Transaktion\s+/,'')||'',lines:[...tx.querySelectorAll('.batch-line')].map(l=>({account:l.querySelector('[data-f=account]').value,description:l.querySelector('[data-f=description]').value,debit_ore:Math.round((Number(String(l.querySelector('[data-f=debit]').value).replace(',','.'))||0)*100),credit_ore:Math.round((Number(String(l.querySelector('[data-f=credit]').value).replace(',','.'))||0)*100)}))}));
}
function payloadTransactions(){return captureTransactions().map(t=>({postingDate:t.posting_date,description:t.description,sourceType:'manual',lines:t.lines.map(l=>({account:l.account,description:l.description,debitOre:l.debit_ore,creditOre:l.credit_ore}))}))}
async function rpc(name,args){return LTSupabase.rpc(name,args,ctx.accessToken)}
async function save(){
 const external=document.getElementById('batch-external').value.trim();
 if(external!==''&&!Number.isFinite(Number(external.replace(',','.'))))throw new Error('Kontrollbeloppet måste vara ett giltigt belopp.');
 await rpc('save_financial_batch',{p_company_id:ctx.company.id,p_batch_id:selected.id,p_title:document.getElementById('batch-title').value,p_external_total_ore:external===''?null:Math.round(Number(external.replace(',','.'))*100),p_transactions:payloadTransactions()});await load();
}
function bulkRegister(){
 const input=window.prompt('Klistra in en rad per transaktion i formatet:\nDATUM;BESKRIVNING;DEBETKONTO;KREDITKONTO;BELOPP\n\nExempel:\n2026-09-25;Kontorsmaterial;6110;1930;1250,00');
 if(!input)return;
 const parsed=[];
 for(const [index,row] of input.split(/\r?\n/).entries()){
   if(!row.trim())continue;
   const parts=row.split(';').map(x=>x.trim());
   if(parts.length!==5)throw new Error('Rad '+(index+1)+' har fel format.');
   const [posting_date,description,debitAccount,creditAccount,amountText]=parts;
   const amount=Math.round(Number(amountText.replace(/\s/g,'').replace(',','.'))*100);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(posting_date)||!description||!/^\d{4}$/.test(debitAccount)||!/^\d{4}$/.test(creditAccount)||!Number.isSafeInteger(amount)||amount<=0)throw new Error('Rad '+(index+1)+' innehåller ogiltiga värden.');
   parsed.push({posting_date,description,lines:[{account:debitAccount,description,debit_ore:amount,credit_ore:0},{account:creditAccount,description,debit_ore:0,credit_ore:amount}]});
 }
 if(!parsed.length)throw new Error('Inga transaktioner hittades.');
 txs=[...captureTransactions(),...parsed];render();
}
app.addEventListener('input',e=>{if(e.target.matches('[data-search]')){searchQuery=e.target.value.trim();render()}});
app.addEventListener('click',async e=>{
 const btn=e.target.closest('button');if(!btn)return;
 try{
  if(btn.dataset.id){selected=batches.find(b=>b.id===btn.dataset.id);await loadDetail(selected.id);render();return}
  const a=btn.dataset.action;
  if(a==='new'){const [r]=await rpc('create_financial_batch',{p_company_id:ctx.company.id,p_title:'Ny bunt',p_external_total_ore:null});await load();selected=batches.find(b=>b.id===r.batch_id);await loadDetail(selected.id);render()}
  if(a==='add-tx'){txs=captureTransactions();txs.push({posting_date:today(),description:'',lines:[{},{}]});render()}
  if(a==='remove-tx'){txs=captureTransactions();const i=Number(btn.closest('.transaction').dataset.tx);txs.splice(i,1);render()}
  if(a==='add-line'){txs=captureTransactions();const i=Number(btn.closest('.transaction').dataset.tx);txs[i].lines ||= [];txs[i].lines.push({});render()}
  if(a==='remove-line'){const tx=btn.closest('.transaction'),i=Number(tx.dataset.tx),li=[...tx.querySelectorAll('.batch-line')].indexOf(btn.closest('.batch-line'));txs=captureTransactions();txs[i].lines.splice(li,1);render()}
  if(a==='bulk'){bulkRegister()}
  if(a==='undo'){await loadDetail(selected.id);render()}
  if(a==='save')await save();
  if(a==='ready'){await save();await rpc('mark_financial_batch_ready',{p_company_id:ctx.company.id,p_batch_id:selected.id});await load()}
  if(a==='reopen'){await rpc('reopen_financial_batch',{p_company_id:ctx.company.id,p_batch_id:selected.id});await load()}
  if(a==='reject'){const reason=window.prompt('Ange varför bunten avvisas:');if(reason){await rpc('reject_financial_batch',{p_company_id:ctx.company.id,p_batch_id:selected.id,p_reason:reason});await load()}}
  if(a==='approve'){if(confirm('Godkänna bunten? Då blir transaktionerna definitiva och bunten låses.')){await rpc('approve_financial_batch',{p_company_id:ctx.company.id,p_batch_id:selected.id});await load()}}
 }catch(err){alert(err.message||String(err))}
});
(async()=>{try{await load()}catch(e){app.innerHTML='<main class="boot"><strong>Kunde inte öppna Buntar</strong><span>'+esc(e.message)+'</span></main>'}})();