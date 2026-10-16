const app=document.getElementById('suppliers-app');
const isDemo=new URLSearchParams(location.search).get('demo')==='1';
const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!isDemo;
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
const Demo=globalThis.RollandsDemoScenario;
const Store=globalThis.LTStudioSupplierPersistence;
let session=null,suppliers=[],selected=null,history=[],message='',creating=false,searchQuery='',searchOpen=false,searchActiveIndex=-1,toast=null;
let toastTimer=null,busy=false,generation=0,historyRequest=0,pageContext=null;
const pendingForms=new WeakMap();
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function api(path,options={}){const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})};const r=await fetch(`/api/v1${path}`,{credentials:'same-origin',...options,headers,body:options.body?JSON.stringify(options.body):undefined});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Begäran misslyckades.');return data}
function url(path){return `${path}${isDemo?'?demo=1':''}`}
function nextSupplierNumber(){const max=suppliers.reduce((n,s)=>Math.max(n,Number(String(s.supplierNumber||'').replace(/\D/g,''))||0),0);return 'L-'+String(Math.max(1,max+1)).padStart(4,'0')}
function normalizeSearch(value){return String(value||'').trim().toLocaleLowerCase('sv-SE')}
function supplierMatchesPrefix(supplier,query){const q=normalizeSearch(query);if(!q)return true;return supplier&&[supplier.name,supplier.supplierNumber,supplier.orgNumber].some(value=>normalizeSearch(value).startsWith(q))}
function supplierSuggestions(){return searchQuery?suppliers.filter(s=>supplierMatchesPrefix(s,searchQuery)).slice(0,8):[]}
function supplierSuggestionHtml(){const rows=supplierSuggestions();if(!rows.length)return '<div class="supplier-search-empty">Inga leverantörer börjar på det du har skrivit.</div>';return rows.map((s,index)=>`<button type="button" class="supplier-search-option ${index===searchActiveIndex?'active':''}" role="option" aria-selected="${index===searchActiveIndex?'true':'false'}" data-supplier-suggestion="${esc(s.id)}"><span><b>${esc(s.name)}</b><small>${esc(s.supplierNumber)}${s.orgNumber?' · '+esc(s.orgNumber):''}</small></span><span>${esc(s.bankgiro||s.plusgiro||'')}</span></button>`).join('')}
function updateSearchUi(){const field=document.getElementById('supplier-search'),box=document.getElementById('supplier-search-results');if(!field||!box)return;const open=Boolean(searchOpen&&searchQuery);field.setAttribute('aria-expanded',open?'true':'false');box.hidden=!open;if(open)box.innerHTML=supplierSuggestionHtml();document.querySelectorAll('.supplier-row').forEach(row=>{const supplier=suppliers.find(s=>s.id===row.dataset.supplierId);row.hidden=Boolean(searchQuery&&!supplierMatchesPrefix(supplier,searchQuery))})}
function queueToast(text){toast={text:String(text||'Sparad')};clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast=null;app.querySelector('.supplier-toast')?.remove()},2400)}
function toastHtml(){return toast?`<div class="supplier-toast" role="status" aria-live="polite"><span class="supplier-toast-check">✓</span><span><b>Sparad</b><small>${esc(toast.text)}</small></span></div>`:''}
function countryField(value=''){return `<label>Landskod (valfritt)<input name="countryCode" value="${esc(value)}" maxlength="2" pattern="[A-Z]{2}" placeholder="SE"><small>Lämna tomt om landet inte är verifierat.</small></label>`}
function createSupplierForm(){return `<section class="sales-panel supplier-detail"><div class="panel-head"><div><span class="eyebrow">Ny leverantör</span><h2>Lägg till leverantör</h2></div><button type="button" class="button ghost small" data-cancel-new-supplier>Avbryt</button></div><form data-form="create" class="detail-grid supplier-create-form"><label>Leverantörsnummer<input name="supplierNumber" value="${esc(nextSupplierNumber())}" required maxlength="40"></label><label>Namn<input name="name" required maxlength="160"></label><label>Organisationsnummer<input name="orgNumber" maxlength="40"></label>${isSupabase?countryField():''}<label>E-post<input name="email" type="email" maxlength="254"></label><label>Standardkonto<input name="defaultCostAccount" inputmode="numeric" maxlength="4" placeholder="4010"></label><label>Bankgiro<input name="bankgiro" maxlength="40"></label><label>Plusgiro<input name="plusgiro" maxlength="40"></label><div class="critical-box"><strong>Betalningsuppgifter</strong><p>Kontrollera betalningsmottagaren separat. Registrering av leverantören innebär inte att en faktura attesteras eller betalas.</p></div><div class="modal-actions"><button class="button" type="submit">Skapa leverantör</button><button class="button ghost" type="button" data-cancel-new-supplier>Avbryt</button></div></form></section>`}
function supplierList(){return `<section class="sales-panel supplier-list"><div class="panel-head"><div><span class="eyebrow">Register</span><h2>Leverantörer</h2><p>Sök på namn, leverantörsnummer eller organisationsnummer.</p></div><div class="supplier-count"><strong>${suppliers.length}</strong><small>leverantörer</small></div></div><div class="supplier-search-wrap"><label class="supplier-search-label" for="supplier-search">Sök leverantör</label><div class="supplier-search-control"><input id="supplier-search" type="search" role="combobox" aria-autocomplete="list" aria-controls="supplier-search-results" aria-expanded="false" autocomplete="off" placeholder="Börja skriva namn eller nummer…" value="${esc(searchQuery)}"></div><div id="supplier-search-results" class="supplier-search-results" role="listbox" hidden></div></div><div id="supplier-rows" class="supplier-rows">${suppliers.map(s=>`<button class="supplier-row ${selected?.id===s.id?'selected':''}" data-supplier-id="${esc(s.id)}"><span><b>${esc(s.name)}</b><small>${esc(s.supplierNumber)} · ${esc(s.orgNumber||'Org.nr saknas')}</small></span><span>${esc(s.bankgiro||s.plusgiro||'Betalningsuppgift saknas')}</span></button>`).join('')}</div></section>`}
function detail(){if(creating)return createSupplierForm();if(!selected)return'<section class="sales-panel supplier-detail"><p class="empty">Välj en leverantör eller skapa en ny.</p></section>';return `<section class="sales-panel supplier-detail"><div class="panel-head"><div><span class="eyebrow">Leverantör</span><h2>${esc(selected.name)}</h2></div><span>${esc(selected.supplierNumber)}</span></div><div class="detail-grid"><form data-form="profile"><label>Namn<input name="name" value="${esc(selected.name)}" required maxlength="160"></label><label>Organisationsnummer<input name="orgNumber" value="${esc(selected.orgNumber||'')}" maxlength="40"></label>${isSupabase?countryField(selected.countryCode):''}<label>E-post<input name="email" type="email" value="${esc(selected.email||'')}" maxlength="254"></label><label>Standardkonto<input name="defaultCostAccount" maxlength="4" value="${esc(selected.defaultCostAccount||'')}"></label><button class="button" type="submit">Spara leverantörsuppgifter</button></form><form data-form="payment"><div class="critical-box"><strong>Betalningsuppgifter</strong><p>Kontrollera nya uppgifter via en tidigare känd kontaktväg. Ändringen och historiken sparas tillsammans. Ingen betalning utförs.</p></div><label>Bankgiro<input name="bankgiro" value="${esc(selected.bankgiro||'')}" maxlength="40"></label><label>Plusgiro<input name="plusgiro" value="${esc(selected.plusgiro||'')}" maxlength="40"></label><button class="button" type="submit">Spara betalningsuppgifter</button></form></div><div class="history"><h3>Ändringshistorik</h3>${history.length?history.map(h=>`<article><b>${esc(h.changeType==='payment-details'?'Betalningsuppgifter':'Leverantörsuppgifter')}</b><span>${esc(new Date(h.changedAt).toLocaleString('sv-SE'))}</span><small>Ändrad av ${esc(h.changedBy)}</small></article>`).join(''):'<p class="empty">Ingen ändringshistorik ännu.</p>'}</div></section>`}
function render(){app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Leverantörer</h1><p>Register & verksamhet / Leverantörsregister</p></div></header><main class="content sales-content">${isDemo?'<div class="demo-banner"><b>Gemensamt UAT-scenario.</b> Samma leverantörer används av Leverantörsfakturor och Automationskö.</div>':''}${message?`<div class="notice" role="alert">${esc(message)}</div>`:''}<div class="sales-head supplier-page-head"><div><h2>Leverantörsregister & betalningsuppgifter</h2><p>Hantera leverantörer, betalningsuppgifter och ändringshistorik.</p></div><div class="sales-actions"><a class="button ghost" href="${url('./payables.html')}">Leverantörsfakturor</a><button type="button" class="button" data-new-supplier>+ Ny leverantör</button></div></div><div class="supplier-layout">${supplierList()}${detail()}</div></main></section></div>${toastHtml()}`;updateSearchUi()}
function syncDemo(){const state=Demo.state();suppliers=structuredClone(state.suppliers);if(selected)selected=suppliers.find(s=>s.id===selected.id)||null;history=selected?structuredClone(state.supplierHistory[selected.id]||[]):[]}
async function loadHistory(){
  const target=selected,request=++historyRequest,epoch=generation;
  if(!target){history=[];return}
  let rows;
  if(isDemo)rows=structuredClone(Demo.state().supplierHistory[target.id]||[]);
  else if(isSupabase){
    const ctx=Store.assertScope(Store.scope(pageContext),await window.LTSupabaseUat.context());
    const result=await window.LTSupabase.from('supplier_change_events',ctx.accessToken).select('*','company_id=eq.'+encodeURIComponent(ctx.company.id)+'&supplier_id=eq.'+encodeURIComponent(target.id)+'&order=changed_at.desc&limit=100');
    Store.assertScope(Store.scope(pageContext),await window.LTSupabaseUat.context());
    if(!Array.isArray(result)||result.some(r=>r.company_id!==ctx.company.id||r.supplier_id!==target.id))throw new Error('SUPPLIER_CONTEXT_CHANGED');
    rows=result.map(r=>({changeType:r.change_type,changedAt:r.changed_at,changedBy:r.changed_by,before:r.before_json,after:r.after_json}));
  }else rows=(await api(`/suppliers/${encodeURIComponent(target.id)}/history`)).history||[];
  if(request===historyRequest&&epoch===generation&&selected?.id===target.id)history=rows;
}
async function load(preferredId=''){
  const epoch=++generation;
  if(isDemo){if(!Demo)throw new Error('Det gemensamma demoscenariot kunde inte laddas.');session={user:{displayName:'Demoanvändare'}};syncDemo();}
  else if(isSupabase){
    if(!Store)throw new Error('Säker registerhantering kunde inte laddas.');
    const ctx=await window.LTSupabaseUat.context();
    if(!ctx?.authenticated||!ctx.company){location.href='./index.html';return}
    // Viewer accounts retain read-only access; writes are separately authorized.
    const result=await window.LTSupabase.from('suppliers',ctx.accessToken).select('*','company_id=eq.'+encodeURIComponent(ctx.company.id)+'&archived_at=is.null');
    const fresh=await window.LTSupabaseUat.context();
    if(epoch!==generation)return;
    if(!fresh?.authenticated||fresh.company?.id!==ctx.company.id||fresh.authUser?.id!==ctx.authUser?.id||fresh.membership?.role!==ctx.membership?.role||
       !Array.isArray(result)||result.some(r=>r.company_id!==ctx.company.id))throw new Error('SUPPLIER_CONTEXT_CHANGED');
    pageContext=fresh;session={user:fresh.user,company:fresh.company};suppliers=result.map(Store.record);
  }else{const s=await api('/session');if(!s.authenticated){location.href='./index.html';return}session=s;suppliers=(await api('/suppliers')).suppliers||[];}
  if(epoch!==generation)return;
  selected=suppliers.find(s=>s.id===preferredId)||suppliers[0]||null;
  await loadHistory();if(epoch===generation)render();
}
async function saveForm(form){
  if(busy)return;busy=true;
  const epoch=generation,target=selected?{...selected}:null,kind=form.dataset.form;
  const payload=Object.fromEntries(new FormData(form));
  const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
    if(!['create','profile','payment'].includes(kind))throw new Error('INVALID_SUPPLIER_INPUT');
    if(kind!=='create'&&!target)throw new Error('INVALID_SUPPLIER_INPUT');
    if(isSupabase){
      const expected=Store.scope(pageContext);
      const ctx=Store.assertScope(expected,await window.LTSupabaseUat.context());
      if(epoch!==generation||!form.isConnected)return;
      const fingerprint=JSON.stringify([kind,target?.id,target?.rowVersion,payload]);
      let pending=pendingForms.get(form);
      if(!pending||pending.fingerprint!==fingerprint){
        pending={fingerprint,operation:Store.operation({context:ctx,supplier:target,payload,kind,
          id:kind==='create'?crypto.randomUUID():target.id,requestId:crypto.randomUUID()})};
        pendingForms.set(form,pending);
      }
      const saved=await Store.save({client:window.LTSupabase,getContext:()=>window.LTSupabaseUat.context(),operation:pending.operation});
      if(epoch!==generation||!form.isConnected)return;
      const index=suppliers.findIndex(s=>s.id===saved.id);
      if(index<0)suppliers.push(saved);else suppliers[index]=saved;
      selected=saved;creating=false;pendingForms.delete(form);
    }else if(isDemo){
      const id=kind==='create'?crypto.randomUUID():target.id;
      Demo.patch(state=>{
        state.supplierHistory??={};
        if(kind==='create'){state.suppliers.push({id,...payload});state.supplierHistory[id]=[];}
        else{const supplier=state.suppliers.find(s=>s.id===id),before={...supplier};Object.assign(supplier,payload);(state.supplierHistory[id]??=[]).unshift({changeType:kind==='payment'?'payment-details':'profile',changedBy:'demo-accountant',changedAt:new Date().toISOString(),before,after:{...supplier}});}
      });
      syncDemo();selected=suppliers.find(s=>s.id===id)||null;creating=false;
    }else{
      let pending=pendingForms.get(form);
      const fingerprint=JSON.stringify([kind,target?.id,payload]);
      if(!pending||pending.fingerprint!==fingerprint){pending={fingerprint,requestId:`supplier-${kind}-${crypto.randomUUID()}`};pendingForms.set(form,pending);}
      let id=target?.id;
      if(kind==='create')id=(await api('/payables/suppliers',{method:'POST',body:payload})).supplier.id;
      else await api(`/suppliers/${encodeURIComponent(id)}/${kind==='payment'?'payment-details':'profile'}`,{method:kind==='payment'?'POST':'PUT',body:{...payload,requestId:pending.requestId}});
      suppliers=(await api('/suppliers')).suppliers||[];selected=suppliers.find(s=>s.id===id)||null;creating=false;pendingForms.delete(form);
    }
    message='';queueToast(kind==='create'?'Leverantören har skapats.':'Ändringen är sparad med historik.');
    await loadHistory();if(epoch===generation)render();
  }catch(error){
    if(epoch!==generation)return;
    message=isSupabase?Store.errorMessage(error):error.message;
    const existing=app.querySelector('.notice');if(existing)existing.textContent=message;
    else app.querySelector('.content')?.insertAdjacentHTML('afterbegin',`<div class="notice" role="alert">${esc(message)}</div>`);
  }finally{busy=false;if(button.isConnected)button.disabled=false;}
}
async function chooseSupplier(id){if(busy)return;const epoch=++generation;creating=false;selected=suppliers.find(s=>s.id===id)||null;history=[];searchQuery='';searchOpen=false;searchActiveIndex=-1;message='';render();await loadHistory();if(epoch===generation)render()}
document.addEventListener('click',e=>{
  if(busy)return;
  if(e.target.closest('[data-new-supplier]')){generation++;creating=true;selected=null;history=[];message='';searchOpen=false;render();return}
  if(e.target.closest('[data-cancel-new-supplier]')){void chooseSupplier(suppliers[0]?.id).catch(showLoadError);return}
  const choice=e.target.closest('[data-supplier-suggestion]')||e.target.closest('[data-supplier-id]');
  if(choice){void chooseSupplier(choice.dataset.supplierSuggestion||choice.dataset.supplierId).catch(showLoadError);return}
  if(!e.target.closest('.supplier-search-wrap')){searchOpen=false;updateSearchUi()}
});
document.addEventListener('submit',e=>{const form=e.target.closest('form[data-form]');if(!form)return;e.preventDefault();void saveForm(form)});
document.addEventListener('input',e=>{if(e.target.id!=='supplier-search')return;searchQuery=e.target.value;searchOpen=Boolean(normalizeSearch(searchQuery));searchActiveIndex=-1;updateSearchUi()});
document.addEventListener('focusin',e=>{if(e.target.id==='supplier-search'&&normalizeSearch(e.target.value)){searchOpen=true;updateSearchUi()}});
document.addEventListener('keydown',e=>{if(e.target.id!=='supplier-search'||busy)return;const rows=supplierSuggestions();if(e.key==='Escape'){searchOpen=false;searchActiveIndex=-1;updateSearchUi();return}if(!rows.length)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();searchOpen=true;searchActiveIndex=(searchActiveIndex+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;updateSearchUi();return}if(e.key==='Enter'&&searchOpen){e.preventDefault();void chooseSupplier(rows[Math.max(0,searchActiveIndex)].id).catch(showLoadError)}});
function showLoadError(error){message=isSupabase&&Store?Store.errorMessage(error):error.message;app.innerHTML=`<main class="boot"><strong>Leverantörsregistret kunde inte laddas</strong><span>${esc(message)}</span></main>`}
load().catch(showLoadError);
