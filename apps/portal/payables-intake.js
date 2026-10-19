const root=document.getElementById('payables-app');
const isDemo=new URLSearchParams(location.search).get('demo')==='1';
const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!isDemo;
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
const Safety=globalThis.LTStudioIntakeSafety,Store=globalThis.LTStudioSupplierPersistence;
let suppliers=[],dialog=null,opening=false;
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function api(path,options={}){const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};if(options.method&&options.method!=='GET'&&csrfToken)headers['X-CSRF-Token']=csrfToken;const r=await fetch(`/api/v1${path}`,{credentials:'same-origin',...options,headers,body:options.body?JSON.stringify(options.body):undefined});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Begäran misslyckades.');return data}
async function loadSuppliers(){
  if(isDemo){suppliers=[{id:'supplier-demo-1',supplierNumber:'L-100',name:'Grön Grossist AB'},{id:'supplier-demo-2',supplierNumber:'L-120',name:'Kustens Emballage AB'}];return null}
  if(!isSupabase){suppliers=(await api('/payables/suppliers')).suppliers||[];return null}
  const ctx=await window.LTSupabaseUat.context(),scope=Store.scope(ctx);
  if(!['admin','accountant'].includes(scope.role))throw new Error('SUPPLIER_ACCESS_DENIED');
  const rows=await window.LTSupabase.from('suppliers',ctx.accessToken).select('*','company_id=eq.'+encodeURIComponent(scope.companyId)+'&archived_at=is.null');
  const fresh=Store.assertScope(scope,await window.LTSupabaseUat.context());
  if(!Array.isArray(rows)||rows.some(r=>r.company_id!==scope.companyId))throw new Error('SUPPLIER_CONTEXT_CHANGED');
  suppliers=rows.map(Store.record);return fresh;
}
function modalHtml(){return `<div class="intake-backdrop" data-intake-backdrop><section class="intake-modal" role="dialog" aria-modal="true" aria-labelledby="intake-title"><header><div><span class="eyebrow">Registrering</span><h2 id="intake-title">Ny leverantörsfaktura</h2><p>Kontrollera leverantör, rätt fakturamottagare och belopp mot originalet. Registrering attesterar, bokför eller betalar inte fakturan.</p></div><button class="intake-close" type="button" data-intake-close aria-label="Stäng">×</button></header><form id="supplier-invoice-intake"><div class="intake-grid"><label class="intake-pdf">Faktura i PDF<input type="file" name="pdf" accept="application/pdf,.pdf" required><small>Max 10 MB. Passivt PDF-original krävs.</small></label><div><button type="button" class="button ghost" data-read-intake-pdf>Läs uppgifter från PDF</button><small>Textläsning på din enhet – inte AI. Skannade underlag kan registreras med manuellt ifyllda uppgifter.</small><p data-intake-reading role="status" aria-live="polite"></p></div><label>Leverantör<select name="supplierId" required><option value="">Välj leverantör…</option>${suppliers.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.supplierNumber)})</option>`).join('')}<option value="__new__">+ Ny leverantör</option></select></label><div class="new-supplier-fields" hidden><label>Leverantörsnummer<input name="supplierNumber" maxlength="40"></label><label>Namn<input name="supplierName" maxlength="160"></label><label>Organisationsnummer<input name="orgNumber" maxlength="40"></label><label>Bankgiro<input name="bankgiro" maxlength="40"><small>Kontrollera betalningsmottagaren separat. PDF-läsningen fyller aldrig i eller ändrar bankgiro.</small></label><label>Standardkonto<input name="defaultCostAccount" inputmode="numeric" maxlength="4" placeholder="4010"></label></div><label>Leverantörens fakturanummer<input name="supplierInvoiceNumber" maxlength="100" required></label><label>Fakturadatum<input type="date" name="invoiceDate" required></label><label>Förfallodatum<input type="date" name="dueDate" required></label><label>Totalbelopp inkl. moms<input name="totalAmount" inputmode="decimal" placeholder="1 250,00" required></label><label>Moms<input name="vatAmount" inputmode="decimal" placeholder="250,00" required></label><label>Momsbehandling<select name="vatTreatment" required><option value="">Välj momsbehandling…</option><option value="se-domestic-full-input-vat">Svensk faktura · full avdragsrätt</option><option value="unsupported">Annat momsfall · manuell hantering krävs</option></select><small>EU, import, omvänd moms, momsfritt och begränsad avdragsrätt kräver separat hantering.</small></label></div><div class="intake-error" role="alert" hidden></div><p data-intake-progress role="status" aria-live="polite"></p><footer><button class="button ghost" type="button" data-intake-close>Avbryt</button><button class="button" type="submit">Registrera faktura</button></footer></form></section></div>`}
function closeModal(){if(dialog?.busy)return;dialog=null;document.querySelector('.intake-backdrop')?.remove()}
function showError(message){const el=document.querySelector('.intake-error');if(el){el.hidden=false;el.textContent=message}}
function showSupplierFields(form){const active=form.elements.supplierId.value==='__new__';const fields=form.querySelector('.new-supplier-fields');fields.hidden=!active;for(const input of fields.querySelectorAll('input'))input.required=active&&['supplierNumber','supplierName'].includes(input.name)}
function formInput(form){const entries=Object.fromEntries(new FormData(form));delete entries.pdf;return entries}
async function readPdf(form){
  const state=dialog;if(!state||state.busy)return;
  const file=form.elements.pdf.files[0],revision=state.revision,request=++state.readRequest;
  const status=form.querySelector('[data-intake-reading]');
  if(!file){status.textContent='Välj PDF-originalet först.';return}
  status.textContent='Läser PDF-text…';
  try{
    const facts=await window.LTStudioDocumentReader.readPdf(file,'supplier-invoice');
    if(isSupabase)Store.assertScope(state.scope,await window.LTSupabaseUat.context());
    if(dialog!==state||state.busy||revision!==state.revision||request!==state.readRequest)return;
    const suggestion=Safety.prefill(facts,suppliers);
    if(suggestion.blocked){state.unsupported=file;status.textContent='PDF-läsningen upptäckte en risk: kredit, felaktiga totalsummor, okänd eller blandad moms, utländsk valuta eller motstridiga uppgifter. Registrera inte här; kontrollera originalet och använd separat manuell hantering.';return}
    for(const [name,value] of Object.entries(suggestion.values))if(!form.elements[name].value)form.elements[name].value=value;
    if(!form.elements.supplierId.value&&suggestion.supplierName){
      if(suggestion.possibleSupplierId)form.elements.supplierId.value=suggestion.possibleSupplierId;
      else{
        form.elements.supplierId.value='__new__';
        if(!form.elements.supplierName.value)form.elements.supplierName.value=suggestion.supplierName;
        if(!form.elements.supplierNumber.value){const max=suppliers.reduce((n,s)=>Math.max(n,Number(String(s.supplierNumber||'').replace(/\D/g,''))||0),0);form.elements.supplierNumber.value='L-'+String(max+1).padStart(4,'0');}
      }
    }
    showSupplierFields(form);
    status.textContent='Tomma fält har förberetts från PDF-texten. Namnmatchningen är bara ett förslag, inte verifierad juridisk identitet. Kontrollera original, leverantör och mottagare. Inget är sparat.';
  }catch(error){if(dialog===state&&revision===state.revision&&request===state.readRequest)status.textContent='Texten kunde inte läsas säkert. Fyll i uppgifterna manuellt och kontrollera originalet. Inget är sparat.';}
}
async function submit(form){
  const state=dialog;if(!state||state.busy)return;
  const input=formInput(form),file=form.elements.pdf.files[0];
  // All amount/date/type validation precedes every supplier mutation.
  const validated=Safety.validate(input);
  if(!file||state.unsupported===file)throw new Error('INVALID_INTAKE_PDF');
  state.busy=true;++state.readRequest;
  const controls=[...form.querySelectorAll('input,select,button')];controls.forEach(x=>{x.disabled=true});
  const progress=form.querySelector('[data-intake-progress]');
  const stages={original:'Kontrollerar och sparar PDF-original…',supplier:'Kontrollerar leverantören…',invoice:'Registrerar fakturan…',document:'Bekräftar kopplingen till PDF-originalet…'};
  let lastStage='validation';
  try{
    if(isSupabase){
      const ctx=Store.assertScope(state.scope,await window.LTSupabaseUat.context());
      const operation=await Safety.prepare({input,file,context:ctx,store:Store,pdf:window.LTStudioPassivePdf,pdfLibrary:window.PDFLib});
      if(dialog!==state)return;
      await Safety.save({operation,client:window.LTSupabase,store:Store,getContext:()=>window.LTSupabaseUat.context(),onStage:stage=>{lastStage=stage;if(dialog===state)progress.textContent=stages[stage]||''}});
      if(dialog===state){state.busy=false;closeModal();location.reload()}
      return;
    }
    await window.LTStudioPassivePdf.assertSafePdfDeep(new Uint8Array(await file.arrayBuffer()),{fileName:file.name},window.PDFLib);
    if(isDemo){state.busy=false;closeModal();await window.LTStudioDialog.alert({title:'Demoläge',message:'Uppgifterna har kontrollerats. Ingen riktig leverantör, faktura eller bokföring sparas i demoläget.'});return}
    let supplierId=validated.supplierId;
    if(validated.supplier)supplierId=(await api('/payables/suppliers',{method:'POST',body:validated.supplier})).supplier.id;
    const invoiceInput={supplierId,supplierInvoiceNumber:validated.supplierInvoiceNumber,invoiceDate:validated.invoiceDate,dueDate:validated.dueDate,totalOre:validated.totalOre,vatOre:validated.vatOre,currency:'SEK',vatTreatment:validated.vatTreatment};
    const created=(await api('/payables/invoices',{method:'POST',body:invoiceInput})).invoice;
    const uploaded=await fetch(`/api/v1/payables/invoices/${encodeURIComponent(created.id)}/document`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/pdf','X-CSRF-Token':csrfToken,'X-Document-Name':encodeURIComponent(file.name)},body:file});
    if(!uploaded.ok)throw new Error('PDF_UPLOAD_UNCONFIRMED');
    location.reload();
  }catch(error){
    if(dialog!==state)return;
    showError(Safety.message(error));
    progress.textContent=lastStage==='validation'?'Inga registreringssteg har påbörjats.':
      'Registreringen är inte klar. PDF eller registeruppgifter kan redan vara sparade. Försök igen med samma original och uppgifter för att återanvända stegen. Inget har attesterats, bokförts eller betalats av detta flöde.';
  }finally{state.busy=false;if(dialog===state)controls.forEach(x=>{x.disabled=false})}
}
async function openModal(){
  if(dialog||opening)return;opening=true;
  try{
    const context=await loadSuppliers();
    dialog={context,scope:context?Store.scope(context):null,busy:false,revision:0,readRequest:0,unsupported:null};
    document.body.insertAdjacentHTML('beforeend',modalHtml());
    const form=document.getElementById('supplier-invoice-intake');
    form.addEventListener('input',()=>{if(dialog){dialog.revision++;form.querySelector('[data-intake-reading]').textContent=''}});
    form.elements.pdf.addEventListener('change',()=>{if(dialog){dialog.unsupported=null;dialog.revision++}});
    form.elements.supplierId.addEventListener('change',()=>showSupplierFields(form));
    form.querySelector('[data-read-intake-pdf]').addEventListener('click',()=>void readPdf(form));
    form.addEventListener('submit',event=>{event.preventDefault();void submit(form).catch(error=>showError(Safety.message(error)))});
    form.elements.pdf.focus();
  }finally{opening=false}
}
function addButton(){const head=document.querySelector('.queue-head');if(!head||head.querySelector('[data-intake-open]'))return;const button=document.createElement('button');button.type='button';button.className='button';button.dataset.intakeOpen='1';button.textContent='Ny leverantörsfaktura';const anchor=head.querySelector('.queue-overdue');if(anchor)anchor.before(button);else head.append(button)}
document.addEventListener('click',event=>{if(event.target.closest('[data-intake-open]'))void openModal().catch(error=>window.LTStudioDialog.alert({title:'Kunde inte öppna registreringen',message:Safety.message(error),tone:'danger'}));if(event.target.closest('[data-intake-close]')||event.target.matches('[data-intake-backdrop]'))closeModal()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeModal()});
const observer=new MutationObserver(addButton);observer.observe(root,{childList:true,subtree:true});addButton();
