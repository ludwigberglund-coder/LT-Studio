const app=document.getElementById('customers-app');
const Demo=globalThis.RollandsDemoScenario;
const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
let editing=null,message='';
function esc(v=''){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function url(path){return `${path}${isDemo?(path.includes('?')?'&':'?')+'demo=1':''}`;}
function customers(){const s=Demo.state(),map=new Map();for(const i of s.customerInvoices||[])if(!map.has(i.customerNumber))map.set(i.customerNumber,{id:'customer-'+i.customerNumber,customerNumber:i.customerNumber,name:i.customerName,paymentTermsDays:30,reminderFeeAgreed:Boolean(i.reminderFeeAgreed)});for(const c of s.customers||[])map.set(c.customerNumber,c);return [...map.values()];}
function stats(number){const list=(Demo.state().customerInvoices||[]).filter(i=>i.customerNumber===number);return {count:list.length,open:list.reduce((s,i)=>s+Math.max(0,Number(i.remainingOre||0)),0)};}
function money(v){return new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'}).format(v/100);}
function form(){
 const c=editing;
 const field=(label,key,type='text')=>`<label>${label}<input name="${key}" type="${type}" value="${esc(c[key]||'')}" maxlength="${key==='name'?160:120}" ${key==='name'?'required':''}></label>`;
 return `<section class="sales-panel"><h2>${c.customerNumber?'Redigera kund '+esc(c.customerNumber):'Ny kund'}</h2><form id="customer-form" class="sales-form">${field('Kundnamn *','name')}${field('Organisationsnummer','orgNumber')}${field('VAT-nummer','vatNumber')}${field('E-post','email','email')}${field('Telefon','phone')}<label class="full">Fakturaadress, postnummer och ort<textarea name="address" rows="3" maxlength="500">${esc(typeof c.address==='string'?c.address:'')}</textarea></label><label>Betalningsvillkor<select name="paymentTermsDays">${[10,20,30,45,60].map(n=>`<option value="${n}" ${Number(c.paymentTermsDays||30)===n?'selected':''}>${n} dagar</option>`).join('')}</select></label><label>Påminnelseavgift avtalad<select name="reminderFeeAgreed"><option value="false" ${!c.reminderFeeAgreed?'selected':''}>Nej</option><option value="true" ${c.reminderFeeAgreed?'selected':''}>Ja</option></select></label><div class="full inline-note">Uppgifterna kan användas direkt på en ny faktura. En redan bokförd fakturas sparade originaluppgifter ändras inte.</div><div class="full sales-actions"><button class="button" type="submit">Spara kund</button><button class="button ghost" type="button" data-cancel>Avbryt</button></div></form></section>`;
}
function render(){
 const list=customers();
 app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Kunder</h1><p>Register & verksamhet / Kundregister</p></div></header><main class="content sales-content"><div class="demo-banner">Fiktiv demodata. Kunduppgifterna sparas i denna webbläsare.</div><div class="sales-head"><div><h2>Kundregister & faktureringsuppgifter</h2><p>Kontaktuppgifter, fakturaadresser och betalningsvillkor på ett ställe.</p></div><div class="sales-actions"><a class="button ghost" href="${url('./invoices.html')}">Kundfakturor</a><button class="button" data-new>+ Ny kund</button></div></div>${message?`<p class="notice" role="alert">${esc(message)}</p>`:''}${editing?form():`<section class="sales-grid"><article class="sales-metric"><span>Kunder</span><strong>${list.length}</strong></article><article class="sales-metric"><span>Öppet kundsaldo</span><strong>${money(list.reduce((s,c)=>s+stats(c.customerNumber).open,0))}</strong></article></section><section class="sales-panel"><div class="table-scroll"><table class="sales-table"><thead><tr><th>Kundnummer</th><th>Kund</th><th>Kontakt / adress</th><th>Villkor</th><th>Fakturor</th><th>Öppet saldo</th><th>Åtgärder</th></tr></thead><tbody>${list.map(c=>{const s=stats(c.customerNumber);return `<tr><td>${esc(c.customerNumber)}</td><td><b>${esc(c.name)}</b><br>${esc(c.orgNumber||'')}<br><small>${esc(c.vatNumber||'')}</small></td><td>${esc(c.email||'–')}<br>${esc(typeof c.address==='string'?c.address:'')}</td><td>${esc(c.paymentTermsDays||30)} dagar</td><td>${s.count}</td><td class="money">${money(s.open)}</td><td><button class="button ghost small" data-edit="${esc(c.customerNumber)}">Redigera</button> <a class="button ghost small" href="${url('./invoices.html?customer='+encodeURIComponent(c.customerNumber))}">Ny faktura</a></td></tr>`;}).join('')}</tbody></table></div></section>`}</main></section></div>`;
}
document.addEventListener('click',event=>{
 if(!isDemo)return;
 if(event.target.closest('[data-new]')){editing={paymentTermsDays:30,reminderFeeAgreed:false};message='';render();}
 const edit=event.target.closest('[data-edit]');if(edit){editing={...customers().find(c=>c.customerNumber===edit.dataset.edit)};message='';render();}
 if(event.target.closest('[data-cancel]')){editing=null;message='';render();}
});
document.addEventListener('submit',event=>{
 if(event.target.id!=='customer-form'||!isDemo)return;event.preventDefault();const fd=new FormData(event.target);
 try{
  const name=String(fd.get('name')||'').trim();if(!name)throw new Error('Ange kundens namn.');
  const existing=customers();const number=editing.customerNumber||'K-'+String(existing.reduce((n,c)=>Math.max(n,Number(String(c.customerNumber).replace(/\D/g,''))||0),1000)+1).padStart(4,'0');
  const c={...editing,id:editing.id||crypto.randomUUID(),customerNumber:number,name,type:'business',paymentTermsDays:Number(fd.get('paymentTermsDays')),reminderFeeAgreed:fd.get('reminderFeeAgreed')==='true'};
  for(const key of ['orgNumber','vatNumber','email','phone','address'])c[key]=String(fd.get(key)||'').trim();
  Demo.patch(state=>{state.customers=[...existing.filter(row=>row.customerNumber!==number),c];});editing=null;message='Kunden är sparad och kan väljas i fakturaverktyget.';render();
 }catch(error){message=error.message;editing={...editing,...Object.fromEntries(fd.entries())};render();}
});
if(isDemo)render();else app.innerHTML='<div class="portal"><aside class="sidebar"></aside><main class="content"><h1>Kunder</h1><p>Det nya kundregistret är en demo. Skyddat kundregister kräver anslutning till företagets backend.</p><a href="./index.html">Till säker inloggning</a></main></div>';
