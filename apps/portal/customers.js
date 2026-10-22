const app=document.getElementById('customers-app');
const Demo=globalThis.RollandsDemoScenario;
const isDemo=new URLSearchParams(location.search).get('demo')==='1';
const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!isDemo;
let editing=null,message='',privateCustomers=[],customerSearch='',csrfToken=sessionStorage.getItem('rollands-csrf')||'',createRequestId='',showArchived=false,pendingCustomerDelete=null;
const copy=value=>JSON.parse(JSON.stringify(value));
function esc(v=''){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function url(path){return `${path}${isDemo?(path.includes('?')?'&':'?')+'demo=1':''}`;}
function demoCustomers(){const s=Demo.state(),map=new Map();for(const i of s.customerInvoices||[])if(!map.has(i.customerNumber))map.set(i.customerNumber,{id:'customer-'+i.customerNumber,customerNumber:i.customerNumber,name:i.customerName,paymentTermsDays:30,reminderFeeAgreed:Boolean(i.reminderFeeAgreed)});for(const c of s.customers||[])map.set(c.customerNumber,c);return [...map.values()];}
function customers(){return isDemo?demoCustomers():privateCustomers;}
function stats(number){if(!isDemo)return {count:0,open:0};const list=(Demo.state().customerInvoices||[]).filter(i=>i.customerNumber===number);return {count:list.length,open:list.reduce((s,i)=>s+Math.max(0,Number(i.remainingOre||0)),0)};}
function money(v){return new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'}).format(v/100);}
function addressText(c){return typeof c.address==='string'?c.address:(c.address?.full||'');}
function editCustomer(c){editing={...copy(c),address:addressText(c)};createRequestId='';message='';}
function requestedCustomer(){const number=new URLSearchParams(location.search).get('customer');return number?customers().find(c=>c.customerNumber===number)||null:null;}
function returnToInvoice(){return new URLSearchParams(location.search).get('return')==='invoice';}
function resumeInvoice(){location.href=url('./invoices.html?resume=1');}

function normalizeCustomerSearch(value){
  return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('sv-SE').trim();
}
function customerHistoryCount(customer){
  // Supabase customer reads do not return an invoice aggregate. Do not
  // accidentally advertise the placeholder invoiceCount:0 as a real result.
  if(isSupabase)return null;
  if(isDemo)return stats(customer.customerNumber).count;
  const raw=customer.invoiceCount;
  return raw===null||raw===undefined||!Number.isSafeInteger(Number(raw))||Number(raw)<0
    ?null:Number(raw);
}
function filteredCustomers(){
  const query=normalizeCustomerSearch(customerSearch);
  return customers().filter(c=>{
    if(showArchived?!Boolean(c.archivedAt):Boolean(c.archivedAt))return false;
    if(!query)return true;
    return [c.customerNumber,c.name,c.orgNumber,c.email,addressText(c)]
      .some(value=>normalizeCustomerSearch(value).includes(query));
  });
}
function customerListCountText(){
  const total=customers().filter(c=>showArchived?Boolean(c.archivedAt):!c.archivedAt).length;
  return customerSearch.trim()
    ?`${filteredCustomers().length} av ${total} kunder visas`
    :`${total} ${total===1?'kund':'kunder'}`;
}
function customerRows(list=filteredCustomers()){
  if(!list.length)return `<tr class="customer-register-empty"><td colspan="5">${customerSearch.trim()
    ?'Inga kunder matchar sökningen.'
    :showArchived?'Inga arkiverade kunder.':'Inga aktiva kunder ännu. Välj Lägg till kund för att börja.'}</td></tr>`;
  return list.map(c=>{
    const count=customerHistoryCount(c);
    const archive=isSupabase||(count!==null&&count>0);
    const history=count===null
      ?'<span class="customer-history-unavailable">Ej sammanställt</span>'
      :`<strong class="customer-history-count">${count} ${count===1?'faktura':'fakturor'}</strong>`;
    const status=c.archivedAt?'<span class="customer-register-status">Arkiverad</span>':'';
    const contact=c.email?`<span>${esc(c.email)}</span>`:'<span>Ingen e-post angiven</span>';
    const address=addressText(c);
    return `<tr class="customer-register-row">
      <td data-label="Kundnummer"><strong class="customer-register-id">${esc(c.customerNumber)}</strong></td>
      <td data-label="Kund"><span class="customer-register-identity">
        <strong>${esc(c.name)}</strong>
        ${c.orgNumber?`<small>Org.nr ${esc(c.orgNumber)}</small>`:''}
        ${status}
      </span></td>
      <td data-label="Kontakt / adress"><span class="customer-register-contact">
        ${contact}${address?`<small>${esc(address)}</small>`:''}
      </span></td>
      <td data-label="Historik">${history}</td>
      <td data-label="Åtgärd"><div class="sales-actions customer-register-row-actions">
        <button class="button ghost small" type="button" data-edit-customer="${esc(c.id)}">Redigera</button>
        ${c.archivedAt
          ?`<button class="button ghost small" type="button" data-restore-customer="${esc(c.id)}" ${isDemo?'disabled title="Tillgängligt efter inloggning"':''}>Återställ</button>`
          :`<button class="button ghost small" type="button" data-delete-customer="${esc(c.id)}" ${isDemo?'disabled title="Tillgängligt efter inloggning"':''}>${archive?'Arkivera':'Ta bort'}</button>`}
      </div></td>
    </tr>`;
  }).join('');
}
function customerList(){
  return `<section class="customer-register-workspace" aria-label="Kundregister">
    <div class="customer-register-tools">
      <div class="customer-register-tools-heading">
        <div><h3>${showArchived?'Arkiverade kunder':'Aktiva kunder'}</h3>
          <p>${showArchived?'Tidigare kunder. Du kan återställa dem när de behövs.':'Hitta kunden du vill fakturera eller uppdatera.'}</p>
        </div>
        <span class="customer-register-count" data-customer-result-count role="status"
          aria-live="polite" aria-atomic="true">${customerListCountText()}</span>
      </div>
      <label for="customer-register-search">Sök kund</label>
      <input id="customer-register-search" type="text" inputmode="search" role="searchbox" autocomplete="off"
        placeholder="Namn, kundnummer, organisationsnummer eller e-post"
        aria-controls="customer-register-table" value="${esc(customerSearch)}">
    </div>
    <div class="sales-panel customer-register-panel"><div class="table-scroll">
      <table id="customer-register-table" class="sales-table" aria-label="Kundregister">
        <thead><tr><th scope="col">Kundnummer</th><th scope="col">Kund</th>
          <th scope="col">Kontakt / adress</th><th scope="col">Historik</th>
          <th scope="col">Åtgärd</th></tr></thead>
        <tbody data-customer-rows>${customerRows()}</tbody>
      </table>
    </div></div>
  </section>`;
}
function form(){
  const c=editing;
  const field=(label,key,type='text')=>`<label>${label}<input name="${key}" type="${type}" value="${esc(c[key]||'')}" maxlength="${key==='name'?160:(key==='ourReference'||key==='yourReference'?120:254)}" ${key==='name'?'required':''}></label>`;
  const moreOpen=Boolean(c.ourReference||c.yourReference||c.reminderFeeAgreed);
  return `<section class="sales-panel customer-form-panel">
    <header class="customer-form-heading">
      <span class="eyebrow">Kunduppgifter</span>
      <h3>${c.customerNumber?'Redigera kund '+esc(c.customerNumber):'Lägg till kund'}</h3>
      <p>Fyll i kundens namn och kontaktuppgifter. Extra fakturainställningar hittar du längre ner.</p>
    </header>
    <form id="customer-form" class="sales-form">
      ${field('Kundnamn *','name')}
      ${field('Organisationsnummer','orgNumber')}
      ${field('E-post','email','email')}
      <label class="full">Fakturaadress, postnummer och ort
        <textarea name="address" rows="3" maxlength="500">${esc(addressText(c))}</textarea>
      </label>
      <label>Betalningsvillkor, dagar
        <input name="paymentTermsDays" type="number" min="0" max="365"
          step="1" value="${esc(c.paymentTermsDays??30)}" required>
      </label>
      <details class="customer-form-advanced full" ${moreOpen?'open':''}>
        <summary>Fler fakturainställningar <small>Referenser & påminnelseavgift</small></summary>
        <div class="customer-form-advanced-grid">
          ${field('Vår referens','ourReference')}
          ${field('Er referens','yourReference')}
          <label>Påminnelseavgift avtalad<select name="reminderFeeAgreed">
            <option value="false" ${!c.reminderFeeAgreed?'selected':''}>Nej</option>
            <option value="true" ${c.reminderFeeAgreed?'selected':''}>Ja</option>
          </select></label>
        </div>
      </details>
      <div class="full sales-actions customer-form-actions">
        <button class="button" type="submit">Spara kund</button>
        <button class="button ghost" type="button" data-cancel>Avbryt</button>
      </div>
    </form>
  </section>`;
}
function customerDeleteModal(){
  if(!pendingCustomerDelete)return '';
  const customer=pendingCustomerDelete.customer;
  const count=customerHistoryCount(customer);
  const mustArchive=isSupabase||(count!==null&&count>0);
  const explanation=mustArchive
    ?isSupabase
      ?'Kunden arkiveras och kan återställas. Befintliga fakturor och historik bevaras.'
      :`Kunden har ${count} faktura/fakturor. Historiken bevaras, så kunden arkiveras i stället för att raderas.`
    :'Kunden saknar registrerad fakturahistorik och kan tas bort permanent.';
  return `<div class="modal-backdrop" data-customer-delete-cancel>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="customer-delete-title" data-stop>
      <header class="modal-head"><div><span class="eyebrow">${mustArchive?'Arkivera kund':'Ta bort kund'}</span>
        <h3 id="customer-delete-title">${esc(customer.customerNumber)} · ${esc(customer.name)}</h3></div>
        <button type="button" class="button ghost small" data-customer-delete-cancel aria-label="Stäng">×</button>
      </header>
      <div class="modal-body"><p>${explanation}</p>
        <p class="form-error">${esc(pendingCustomerDelete.error||'')}</p>
        <div class="modal-actions">
          <button type="button" class="button ghost" data-customer-delete-cancel>Avbryt</button>
          <button type="button" class="button" data-customer-delete-confirm>${mustArchive?'Arkivera kund':'Ta bort kund'}</button>
        </div>
      </div>
    </section>
  </div>`;
}
function render(){
  const all=customers();
  const activeCount=all.filter(c=>!c.archivedAt).length;
  const archivedCount=all.filter(c=>c.archivedAt).length;
  app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main">
    <header class="topbar"><div><h1>Kunder</h1><p>Fakturor & kunder / Kundregister</p></div></header>
    <main class="content sales-content customer-workspace">
      ${isDemo?'<div class="demo-banner">Fiktiv demodata. Kunduppgifterna sparas i denna webbläsare.</div>':''}
      <div class="sales-head customer-register-head">
        <div class="customer-register-intro">
          <span class="eyebrow">Fakturor & kunder</span>
          <h2>${editing?'Kunduppgifter':'Kundregister'}</h2>
          <p>${isDemo?'Registrera kunder och prova fakturering med fiktiva uppgifter.':'Hitta och uppdatera företagets kunder. Kunder med fakturahistorik arkiveras när de tas bort.'}</p>
        </div>
        <div class="sales-actions customer-register-top-actions">
          <a class="button ghost" href="${url('./invoices.html')}">Kundfakturor</a>
          ${editing?'':`<button class="button ghost" type="button" data-toggle-archived>
            ${showArchived?'Visa aktiva':'Visa arkiverade'} (${showArchived?activeCount:archivedCount})
          </button>
          <button class="button" type="button" data-new>+ Lägg till kund</button>`}
        </div>
      </div>
      ${message?`<p class="notice" role="alert">${esc(message)}</p>`:''}
      ${editing?form():customerList()}
    </main>
  </section></div>${customerDeleteModal()}`;
}
async function loadPrivateCustomers(){
  if(isSupabase){const ctx=await window.LTSupabaseUat.context();if(!ctx.authenticated||!ctx.company){location.href='./index.html';return;}const rows=await window.LTSupabase.from('customers',ctx.accessToken).select('*','company_id=eq.'+encodeURIComponent(ctx.company.id));privateCustomers=(rows||[]).map(r=>({id:r.id,customerNumber:r.customer_number,name:r.name,orgNumber:r.org_number||'',email:r.email||'',address:r.address_json?.full||'',paymentTermsDays:Number(r.payment_terms_days??30),ourReference:r.our_reference||'',yourReference:r.your_reference||'',reminderFeeAgreed:Boolean(r.reminder_fee_agreed),archivedAt:r.archived_at||null,invoiceCount:0}));return;}
  const response=await fetch('/api/v1/customers?includeArchived=1',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error((await response.json()).error||'Kundregistret kunde inte laddas.');privateCustomers=(await response.json()).customers||[];}
async function bootPrivate(){if(isSupabase){const ctx=await window.LTSupabaseUat.context();if(!ctx.authenticated||!ctx.company){location.href='./index.html';return;}await loadPrivateCustomers();const requested=requestedCustomer();if(requested)editCustomer(requested);render();return;}const sessionResponse=await fetch('/api/v1/session',{credentials:'same-origin',cache:'no-store'});const session=await sessionResponse.json();if(!session.authenticated){location.href='./index.html';return;}if(!csrfToken){location.href='./index.html';return;}await loadPrivateCustomers();const requested=requestedCustomer();if(requested)editCustomer(requested);render();}
document.addEventListener('input',event=>{
  if(event.target.id!=='customer-register-search')return;
  customerSearch=event.target.value;
  const tbody=app.querySelector('[data-customer-rows]');
  const count=app.querySelector('[data-customer-result-count]');
  if(tbody)tbody.innerHTML=customerRows();
  if(count)count.textContent=customerListCountText();
});
document.addEventListener('click',async event=>{const edit=event.target.closest('[data-edit-customer]');if(edit){const customer=customers().find(c=>c.id===edit.dataset.editCustomer);if(customer){editCustomer(customer);render();}return;}if(event.target.closest('[data-toggle-archived]')){showArchived=!showArchived;message='';render();return;}const remove=event.target.closest('[data-delete-customer]');if(remove&&!isDemo){const customer=customers().find(c=>c.id===remove.dataset.deleteCustomer);if(!customer)return;pendingCustomerDelete={customer,error:''};render();return;}const confirmDelete=event.target.closest('[data-customer-delete-confirm]');if(confirmDelete&&pendingCustomerDelete&&!isDemo){const customer=pendingCustomerDelete.customer;try{if(isSupabase){const ctx=await window.LTSupabaseUat.context();const values={archived_at:new Date().toISOString()};await window.LTSupabase.from('customers',ctx.accessToken).update(values,'id=eq.'+encodeURIComponent(customer.id)+'&company_id=eq.'+encodeURIComponent(ctx.company.id));message=`Kund ${customer.customerNumber} är arkiverad.`;}else{const response=await fetch('/api/v1/customers/'+encodeURIComponent(customer.id),{method:'DELETE',credentials:'same-origin',headers:{'X-CSRF-Token':csrfToken}}),data=await response.json();if(!response.ok)throw new Error(data.error||'Kunden kunde inte tas bort.');message=data.archived?`Kund ${customer.customerNumber} är arkiverad eftersom fakturahistorik finns kvar.`:`Kund ${customer.customerNumber} är borttagen.`;}await loadPrivateCustomers();pendingCustomerDelete=null;render();}catch(error){pendingCustomerDelete={...pendingCustomerDelete,error:error.message};render();}return;}const cancelDelete=event.target.closest('button[data-customer-delete-cancel]'),backdropDelete=event.target.matches?.('.modal-backdrop[data-customer-delete-cancel]');if(cancelDelete||backdropDelete){pendingCustomerDelete=null;render();return;}const restore=event.target.closest('[data-restore-customer]');if(restore&&!isDemo){try{if(isSupabase){const ctx=await window.LTSupabaseUat.context();await window.LTSupabase.from('customers',ctx.accessToken).update({archived_at:null},'id=eq.'+encodeURIComponent(restore.dataset.restoreCustomer)+'&company_id=eq.'+encodeURIComponent(ctx.company.id));await loadPrivateCustomers();message='Kunden är aktiv igen.';render();return;}const response=await fetch('/api/v1/customers/'+encodeURIComponent(restore.dataset.restoreCustomer)+'/restore',{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':csrfToken}}),data=await response.json();if(!response.ok)throw new Error(data.error||'Kunden kunde inte återställas.');await loadPrivateCustomers();message=`Kund ${data.customer.customerNumber} är aktiv igen.`;render();}catch(error){message=error.message;render();}return;}if(event.target.closest('[data-new]')){customerSearch='';editing={reminderFeeAgreed:false,paymentTermsDays:30,ourReference:'',yourReference:''};createRequestId=crypto.randomUUID();message='';render();return;}if(event.target.closest('[data-cancel]')){if(returnToInvoice()){resumeInvoice();return;}editing=null;createRequestId='';message='';render();}});
document.addEventListener('submit',async event=>{if(event.target.id!=='customer-form')return;event.preventDefault();const fd=new FormData(event.target),payload={name:fd.get('name'),orgNumber:fd.get('orgNumber'),email:fd.get('email'),address:fd.get('address'),paymentTermsDays:Number(fd.get('paymentTermsDays')??30),ourReference:String(fd.get('ourReference')||'').trim(),yourReference:String(fd.get('yourReference')||'').trim(),reminderFeeAgreed:fd.get('reminderFeeAgreed')==='true'};if(!Number.isInteger(payload.paymentTermsDays)||payload.paymentTermsDays<0||payload.paymentTermsDays>365){message='Betalningsvillkor måste vara 0–365 dagar.';render();return;}if(isDemo){const name=String(payload.name||'').trim();if(!name){message='Ange kundens namn.';render();return;}const existing=customers();if(editing?.customerNumber){const updated={...editing,...payload,name,address:String(payload.address||'')};Demo.patch(state=>{const stored=(state.customers||[]).filter(c=>c.customerNumber!==updated.customerNumber);state.customers=[...stored,updated];});editing=null;if(returnToInvoice()){resumeInvoice();return;}message=`Kund ${updated.customerNumber} är uppdaterad i demot.`;render();return;}const number='K-'+String(existing.reduce((n,c)=>Math.max(n,Number(String(c.customerNumber).replace(/\D/g,''))||0),1000)+1).padStart(4,'0'),customer={id:crypto.randomUUID(),customerNumber:number,...payload,name,type:'business',address:String(payload.address||'')};Demo.patch(state=>{state.customers=[...(state.customers||[]),customer];});editing=null;message='Kunden är sparad i demot.';render();return;}try{const updating=Boolean(editing?.id);if(isSupabase){const ctx=await window.LTSupabaseUat.context();if(!ctx.authenticated||!ctx.company)throw new Error('Ingen aktiv Supabase-session.');const payloadDb={company_id:ctx.company.id,name:String(payload.name||'').trim(),org_number:payload.orgNumber||null,email:payload.email||null,address_json:{full:String(payload.address||'')},payment_terms_days:payload.paymentTermsDays,our_reference:payload.ourReference||null,your_reference:payload.yourReference||null,reminder_fee_agreed:Boolean(payload.reminderFeeAgreed),updated_at:new Date().toISOString()};let saved;if(updating){saved=(await window.LTSupabase.from('customers',ctx.accessToken).update(payloadDb,'id=eq.'+encodeURIComponent(editing.id)+'&company_id=eq.'+encodeURIComponent(ctx.company.id)))?.[0];}else{const nextNumber='K-'+String(customers().reduce((n,row)=>Math.max(n,Number(String(row.customerNumber||'').replace(/\D/g,''))||0),1000)+1).padStart(4,'0');saved=(await window.LTSupabase.from('customers',ctx.accessToken).insert([{id:crypto.randomUUID(),company_id:ctx.company.id,customer_number:nextNumber,...payloadDb,customer_type:'business'}]))?.[0];}if(!saved)throw new Error('Kunden kunde inte sparas i Supabase.');await loadPrivateCustomers();editing=null;createRequestId='';if(updating&&returnToInvoice()){resumeInvoice();return;}message=`Kund ${saved.customer_number} är ${updating?'uppdaterad':'sparad'} i Supabase.`;render();return;}if(!updating&&!createRequestId)createRequestId=crypto.randomUUID();const endpoint=updating?'/api/v1/customers/'+encodeURIComponent(editing.id):'/api/v1/customers',body=updating?payload:{...payload,requestId:createRequestId},response=await fetch(endpoint,{method:updating?'PUT':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(body)}),data=await response.json();if(!response.ok)throw new Error(data.error||'Kunden kunde inte sparas.');privateCustomers=updating?privateCustomers.map(c=>c.id===data.customer.id?data.customer:c):privateCustomers.some(c=>c.id===data.customer.id)?privateCustomers:[...privateCustomers,data.customer];editing=null;createRequestId='';if(updating&&returnToInvoice()){resumeInvoice();return;}message=`Kund ${data.customer.customerNumber} är ${updating?'uppdaterad':'sparad'} i den privata databasen.`;render();}catch(error){message=error.message;render();}});
if(isDemo){const requested=requestedCustomer();if(requested)editCustomer(requested);render();}else bootPrivate().catch(error=>{app.innerHTML=`<main class="content"><h1>Kunder</h1><p role="alert">${esc(error.message)}</p><a href="./index.html">Till säker inloggning</a></main>`;});
