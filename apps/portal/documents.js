const app=document.getElementById('documents-app');
const isDemo=new URLSearchParams(location.search).get('demo')==='1';
const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!isDemo;
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
const Demo=globalThis.RollandsDemoScenario;
let session=null,documents=[],category='all',query='',message='',documentSearchOpen=false,documentSearchActiveIndex=-1;
// PDF facts exist in memory only while their verified original's review dialog is open.
let activePdfReview=null,pdfReadBusy=false;
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function url(path){return `${path}${isDemo?'?demo=1':''}`}
function size(bytes){const value=Number(bytes||0);return value<1024?`${value} B`:value<1024*1024?`${(value/1024).toFixed(1)} kB`:`${(value/1024/1024).toFixed(1)} MB`}
function date(value){try{return new Intl.DateTimeFormat('sv-SE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Stockholm'}).format(new Date(value))}catch{return value}}
async function api(path,options={}){const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})};const r=await fetch(`/api/v1${path}`,{credentials:'same-origin',...options,headers,body:options.body?JSON.stringify(options.body):undefined});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Begäran misslyckades.');return data}
function sidebar(){return `<aside class="sidebar documents-nav"><div class="logo"><strong>LT Studio</strong><small>LT STUDIO</small></div><div class="company-pill">${esc(session?.company?.name||(isDemo?'Demoföretag':'Företaget'))}<br>${isDemo?'Demoföretag':'Skyddad företagsmiljö'}</div><div class="side-group"><span>Arbetsyta</span><a class="side-link" href="${url('./dashboard.html')}">Översikt</a></div><div class="side-group"><span>Ekonomi</span><a class="side-link" href="${url('./payables.html')}">Leverantörsfakturor</a><a class="side-link" href="${url('./accounting.html')}">Bokföring</a><a class="side-link active" href="${url('./documents.html')}">Dokument</a></div><div class="sidebar-footer">Originalunderlag är oföränderliga efter uppladdning.</div></aside>`}
function documentMatches(d,needle){const q=String(needle||'').trim().toLocaleLowerCase('sv-SE');if(!q)return true;return [d.title,d.fileName,d.category,...(d.links||[]).flatMap(l=>[l.entityType,l.entityId,l.label])].some(v=>String(v||'').toLocaleLowerCase('sv-SE').includes(q))}
function visibleDocs(){return documents.filter(d=>(category==='all'||d.category===category)&&documentMatches(d,query))}
function documentSearchSuggestions(){return query?visibleDocs().slice(0,8):[]}
function documentSearchResults(){const rows=documentSearchSuggestions();if(!rows.length)return '<div class="shared-search-empty">Inga dokument matchar sökningen.</div>';return rows.map((d,index)=>`<button type="button" class="shared-search-option ${index===documentSearchActiveIndex?'active':''}" role="option" aria-selected="${index===documentSearchActiveIndex?'true':'false'}" data-document-search-id="${esc(d.id)}"><span><b>${esc(d.title)}</b><small>${esc(d.fileName)} · ${esc(categoryLabel(d.category))}</small></span><strong>${size(d.sizeBytes)}</strong></button>`).join('')}
function closeDocumentSearch(){documentSearchOpen=false;documentSearchActiveIndex=-1;const field=document.querySelector('[data-filter="query"]'),results=document.getElementById('documents-search-results');field?.setAttribute('aria-expanded','false');if(results)results.hidden=true}
function categoryLabel(v){return ({'customer-invoice':'Kundfaktura','supplier-invoice':'Leverantörsfaktura',receipt:'Kvitto',bank:'Bank',accounting:'Bokföring',inventory:'Lager',other:'Övrigt'})[v]||v}
function render(){const rows=visibleDocs();app.innerHTML=`<div class="documents-shell">${sidebar()}<section class="documents-main"><header class="topbar"><div><h1>Dokument</h1><p>Originalunderlag · kontrollsumma · affärskoppling</p></div><div class="user-chip"><b>${esc(session?.user?.displayName||'Demo Dokument')}</b></div></header><main class="content">${isDemo?'<div class="demo-banner"><b>Gemensamt UAT-scenario.</b> Dokumentens kopplingar använder samma interna id som Leverantörsfakturor och Bokföring.</div>':''}${message?`<div class="notice">${esc(message)}</div>`:''}<div class="notice documents-note"><b>Spårbarhet:</b> ett original med kontrollsumma ersätts inte. En korrigerad version registreras som ett nytt dokument.</div><section class="documents-toolbar"><div class="documents-filters"><select data-filter="category"><option value="all">Alla kategorier</option>${['customer-invoice','supplier-invoice','receipt','bank','accounting','inventory','other'].map(v=>`<option value="${v}" ${category===v?'selected':''}>${categoryLabel(v)}</option>`).join('')}</select><div class="shared-search-shell documents-search-shell"><input type="search" role="combobox" aria-autocomplete="list" aria-controls="documents-search-results" aria-expanded="${documentSearchOpen&&query?'true':'false'}" autocomplete="off" data-filter="query" value="${esc(query)}" placeholder="Sök titel, fil eller koppling"><div id="documents-search-results" class="shared-search-results" role="listbox" ${documentSearchOpen&&query?'':'hidden'}>${documentSearchOpen&&query?documentSearchResults():''}</div></div></div><button class="button" data-action="upload">Lägg till dokument</button></section><section class="documents-panel"><div class="documents-head"><div><span class="eyebrow">Arkiv</span><h2>${rows.length} dokument</h2></div><strong>${documents.length} totalt</strong></div><div class="documents-table-wrap"><table class="documents-table"><thead><tr><th>Kategori</th><th>Dokument</th><th>Koppling</th><th>Storlek</th><th>SHA-256</th><th>Registrerat</th><th></th></tr></thead><tbody>${rows.map(d=>`<tr data-document-id="${esc(d.id)}"><td><span class="doc-category">${esc(categoryLabel(d.category))}</span></td><td><b>${esc(d.title)}</b><small>${esc(d.fileName)} · ${esc(d.mimeType)}</small></td><td>${(d.links||[]).map(l=>`${esc(l.label||l.entityType)}<small>${esc(l.entityType)} · ${esc(l.entityId)}</small>`).join('<br>')||'—'}</td><td>${size(d.sizeBytes)}</td><td class="doc-sha" title="${esc(d.sha256||'')}">${esc((d.sha256||'').slice(0,12))}${d.sha256?'…':''}</td><td>${date(d.createdAt)}</td><td>${isDemo?'<span>Demo</span>':isSupabase?`<button class="button ghost small" type="button" data-open-document="${esc(d.id)}">Öppna PDF</button>${['supplier-invoice','receipt'].includes(d.category)?`<button class="button ghost small" type="button" data-read-document="${esc(d.id)}">Läs PDF lokalt</button>`:''} `:`<a class="button ghost small" href="/api/v1/documents/${encodeURIComponent(d.id)}/content" target="_blank" rel="noopener">Ladda ner</a>`}</td></tr>`).join('')||'<tr><td colspan="7" class="documents-empty">Inga dokument matchar filtret.</td></tr>'}</tbody></table></div></section></main></section></div>`}
function modal(){const requestId=crypto.randomUUID();document.body.insertAdjacentHTML('beforeend',`<div class="documents-modal-backdrop" data-close><section class="documents-modal"><header><div><span class="eyebrow">Nytt original</span><h2>Lägg till dokument</h2></div><button class="documents-close" type="button" data-close>×</button></header><form id="document-upload" data-request-id="${esc(requestId)}"><div class="two"><label>Titel<input name="title" required maxlength="180"></label><label>Kategori<select name="category"><option value="customer-invoice">Kundfaktura</option><option value="supplier-invoice">Leverantörsfaktura</option><option value="receipt">Kvitto</option><option value="bank">Bank</option><option value="accounting">Bokföring</option><option value="inventory">Lager</option><option value="other">Övrigt</option></select></label></div><label>Fil<input type="file" name="file" accept="application/pdf,.pdf" required><small>Endast PDF · max 10 MB</small></label><div class="two"><label>Kopplingstyp<input name="entityType" placeholder="t.ex. supplier-invoice"></label><label>Kopplings-id<input name="entityId" placeholder="internt id"></label></div><label>Kommentar<textarea name="note" rows="3" maxlength="1000"></textarea></label><div class="notice"><b>Originalprincip:</b> efter uppladdning kan filen inte bytas ut.</div><footer><button class="button ghost" type="button" data-close>Avbryt</button><button class="button" type="submit">Ladda upp</button></footer></form></section></div>`)}
async function upload(form){const fd=new FormData(form),file=fd.get('file');if(!(file instanceof File)||!file.size)throw new Error('Välj en fil.');if(file.size>10*1024*1024)throw new Error('PDF-filen får vara högst 10 MB.');const mime=file.type||({'pdf':'application/pdf'})[file.name.split('.').pop().toLowerCase()]||'';if(!/\.pdf$/i.test(file.name)||mime!=='application/pdf')throw new Error('Endast PDF-filer stöds.');const meta={requestId:String(form.dataset.requestId||''),title:String(fd.get('title')||''),category:String(fd.get('category')||'other'),fileName:file.name,mimeType:mime,note:String(fd.get('note')||''),entityType:String(fd.get('entityType')||''),entityId:String(fd.get('entityId')||'')};if(isDemo){const created={id:`doc-demo-${Date.now()}`,...meta,sha256:`demo-${Date.now().toString(16)}`,sizeBytes:file.size,uploadedBy:'demo-user',createdAt:new Date().toISOString(),links:meta.entityType&&meta.entityId?[{entityType:meta.entityType,entityId:meta.entityId,label:''}]:[]};Demo.patch(state=>state.documents.unshift(created));documents=Demo.section('documents');message='Dokumentmetadata sparades i det gemensamma demoscenariot. Filinnehållet sparades inte.';return}if(isSupabase){
  const ctx=await window.LTSupabaseUat.context();if(!ctx.authenticated||!ctx.company)throw new Error('Ingen aktiv Supabase-session.');
  const bytes=new Uint8Array(await file.arrayBuffer()),digest=await crypto.subtle.digest('SHA-256',bytes),sha256=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const id='doc_'+crypto.randomUUID().replaceAll('-',''),safeName=file.name.replace(/[^A-Za-z0-9_.-]/g,'_'),path=ctx.company.id+'/documents/'+id+'/'+safeName;
  await window.LTSupabase.storage.upload('lt-documents',path,file,ctx.accessToken);
  try{
    const saved=(await window.LTSupabase.from('documents',ctx.accessToken).insert([{
      id,company_id:ctx.company.id,object_path:path,file_name:file.name,mime_type:'application/pdf',size_bytes:file.size,sha256,
      source_type:meta.entityType||null,source_id:meta.entityId||null,uploaded_by:ctx.authUser.id,title:meta.title,category:meta.category,note:meta.note
    }]))?.[0];
    if(!saved)throw new Error('Dokumentmetadata kunde inte sparas i Supabase.');
  }catch(error){await window.LTSupabase.storage.remove('lt-documents',[path],ctx.accessToken).catch(()=>{});throw error}
  await loadSupabaseDocuments();message='Dokumentet sparades privat i Supabase och fick en SHA-256-kontrollsumma.';return;
}
const created=(await api('/documents',{method:'POST',body:meta})).document;const r=await fetch(`/api/v1/documents/${encodeURIComponent(created.id)}/content`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':mime,'X-CSRF-Token':csrfToken},body:file});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Dokumentet registrerades men filinnehållet kunde inte sparas.');documents=(await api('/documents')).documents||[];message='Dokumentet sparades och fick en kontrollsumma.'}
document.addEventListener('change',e=>{
  if(e.target.dataset.filter==='category'){category=e.target.value;documentSearchActiveIndex=-1;render();return}
  if(e.target.matches?.('[data-document-expense],[data-document-payment]')){
    const modal=e.target.closest('.documents-pdf-preview');
    const result=modal?.querySelector('[data-document-review-result]');
    if(result)result.textContent='Valet har ändrats. Klicka på Visa granskningsutkast igen.';
  }
});
document.addEventListener('input',e=>{if(e.target.dataset.filter==='query'){query=e.target.value;documentSearchOpen=Boolean(query.trim());documentSearchActiveIndex=-1;render();requestAnimationFrame(()=>{const field=document.querySelector('[data-filter="query"]');field?.focus();field?.setSelectionRange?.(query.length,query.length)})}});
document.addEventListener('focusin',e=>{if(e.target.dataset.filter==='query'&&query.trim()){documentSearchOpen=true;const results=document.getElementById('documents-search-results');if(results){results.hidden=false;results.innerHTML=documentSearchResults()}e.target.setAttribute('aria-expanded','true')}});
document.addEventListener('keydown',e=>{if(e.target.dataset.filter!=='query')return;const rows=documentSearchSuggestions();if(e.key==='Escape'){closeDocumentSearch();return}if(!rows.length)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const step=e.key==='ArrowDown'?1:-1;documentSearchActiveIndex=(documentSearchActiveIndex+step+rows.length)%rows.length;documentSearchOpen=true;render();requestAnimationFrame(()=>document.querySelector('[data-filter="query"]')?.focus());return}if(e.key==='Enter'&&documentSearchOpen){e.preventDefault();const choice=rows[Math.max(0,documentSearchActiveIndex)];if(choice){query=choice.title||choice.fileName||'';documentSearchOpen=false;documentSearchActiveIndex=-1;render()}}});
document.addEventListener('click',async e=>{
  const interpret=e.target.closest('[data-read-document]');
  if(interpret){
    if(pdfReadBusy)return;
    pdfReadBusy=true;
    activePdfReview=null;
    document.querySelector('.documents-pdf-preview')?.closest('.documents-modal-backdrop')?.remove();
    try{await readSupabaseDocument(interpret.dataset.readDocument)}
    catch{message='PDF-filen kunde inte läsas lokalt. Kontrollera att den är textbaserad, passiv och hör till ditt företag.';render()}
    finally{pdfReadBusy=false}
    return;
  }
  const preview=e.target.closest('[data-preview-document]');
  if(preview){
    try{await previewSupabaseDocument(preview.dataset.previewDocument)}
    catch{
      activePdfReview=null;
      document.querySelector('.documents-pdf-preview')?.closest('.documents-modal-backdrop')?.remove();
      message='Granskningen avbröts. Logga in igen och öppna dokumentet på nytt.';
      render();
    }
    return;
  }
  const open=e.target.closest('[data-open-document]');
  if(open){try{await openSupabaseDocument(open.dataset.openDocument)}catch(err){message=err.message;render()}return}
  const suggestion=e.target.closest('[data-document-search-id]');
  if(suggestion){
    const choice=documents.find(d=>d.id===suggestion.dataset.documentSearchId);
    if(choice){query=choice.title||choice.fileName||'';documentSearchOpen=false;documentSearchActiveIndex=-1;render()}
    return;
  }
  if(!e.target.closest('.documents-search-shell')&&documentSearchOpen)closeDocumentSearch();
  if(e.target.closest('[data-action="upload"]'))modal();
  const backdrop=document.querySelector('.documents-modal-backdrop');
  if(!backdrop)return;
  const closeButton=e.target.closest('button[data-close]');
  if(closeButton||e.target===backdrop){
    if(backdrop.querySelector('.documents-pdf-preview'))activePdfReview=null;
    backdrop.remove();
  }
});
document.addEventListener('submit',async e=>{if(e.target.id!=='document-upload')return;e.preventDefault();const button=e.target.querySelector('[type="submit"]');button.disabled=true;try{await upload(e.target);document.querySelector('.documents-modal-backdrop')?.remove();render()}catch(err){message=err.message;button.disabled=false;render()}});
const documentAccessError=()=>new Error('Dokumentet kan inte öppnas säkert. Ladda om arkivet och välj rätt företag.');
const archiveAccessError=()=>new Error('Dokumentarkivet kunde inte verifieras för valt företag. Ladda om sidan och försök igen.');
function sameDocumentSession(expected,current){
  return Boolean(current?.authenticated&&current.company?.id&&current.accessToken&&
    String(current.company.id)===String(expected.company?.id||'')&&
    current.accessToken===expected.accessToken&&
    (!expected.authUser?.id||current.authUser?.id===expected.authUser.id));
}
function validArchivePath(doc,companyId){
  if(!doc||String(doc.companyId)!==String(companyId)||
     typeof doc.objectPath!=='string'||typeof doc.fileName!=='string')
    return false;
  const parts=doc.objectPath.split('/');
  if(parts.length!==4||parts[0]!==String(companyId)||
     !/^[A-Za-z0-9_.-]+\.pdf$/i.test(parts[3]))
    return false;
  // Normal archive originals (including older customer uploads).
  if(parts[1]==='documents')
    return parts[2]===String(doc.id)&&parts[2]!=='.'&&parts[2]!=='..'&&
      /^[A-Za-z0-9_-]{1,140}$/.test(parts[2]);
  // Issued customer invoices and credit notes have always lived in separate
  // verified staging folders. Do not break opening these existing originals.
  return doc.category==='customer-invoice'&&doc.sourceType==='customer-invoice'&&
    (parts[1]==='customer-invoices'||parts[1]==='customer-credit-notes')&&
    /^[A-Za-z0-9_-]{16,100}$/.test(parts[2])&&
    parts[3]===doc.fileName;
}
async function loadSupabaseDocuments(){
  const ctx=await window.LTSupabaseUat.context();
  if(!ctx?.authenticated||!ctx.company){documents=[];activePdfReview=null;location.href='./index.html';return false}
  if(!ctx.company.id||!ctx.accessToken)throw archiveAccessError();
  const companyId=String(ctx.company.id),token=ctx.accessToken;
  try{
    const rows=await window.LTSupabase.from('documents',token).select('*','company_id=eq.'+encodeURIComponent(companyId)+'&order=created_at.desc');
    const current=await window.LTSupabaseUat.context();
    if(!sameDocumentSession(ctx,current)||!Array.isArray(rows)||
       rows.some(row=>!row||String(row.company_id||'')!==companyId)){
      throw archiveAccessError();
    }
    const mapped=rows.map(r=>({
      id:r.id,companyId:r.company_id,sourceType:r.source_type||null,
      title:r.title||r.file_name,fileName:r.file_name,
      mimeType:r.mime_type,sizeBytes:Number(r.size_bytes||0),sha256:r.sha256||'',
      category:r.category||r.source_type||'other',note:r.note||'',createdAt:r.created_at,objectPath:r.object_path,
      links:r.source_type&&r.source_id?[{entityType:r.source_type,entityId:r.source_id,label:''}]:[]
    }));
    // Commit a single validated snapshot; no rows from an earlier company remain.
    documents=mapped;session={user:current.user,company:current.company};activePdfReview=null;
    return true;
  }catch{
    documents=[];session=null;activePdfReview=null;
    throw archiveAccessError();
  }
}
async function openSupabaseDocument(id){
  const ctx=await window.LTSupabaseUat.context();
  const doc=documents.find(d=>String(d.id)===String(id));
  if(!ctx?.authenticated||!ctx.company?.id||!ctx.accessToken||
     !doc||String(doc.companyId)!==String(ctx.company.id)||
     doc.mimeType!=='application/pdf'||
     typeof doc.objectPath!=='string'||
     !validArchivePath(doc,ctx.company.id)||
     !/^[a-f0-9]{64}$/i.test(doc.sha256||'')||
     !Number.isSafeInteger(doc.sizeBytes)||doc.sizeBytes<=0||doc.sizeBytes>10*1024*1024)
    throw documentAccessError();
  const blob=await window.LTSupabase.storage.download('lt-documents',doc.objectPath,ctx.accessToken);
  if(!blob||blob.size!==doc.sizeBytes||blob.size>10*1024*1024)throw documentAccessError();
  const bytes=await blob.arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const actual=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==doc.sha256.toLowerCase())throw documentAccessError();
  const current=await window.LTSupabaseUat.context();
  if(!sameDocumentSession(ctx,current)||
     !documents.some(row=>row.id===doc.id&&row.companyId===doc.companyId&&
       row.sha256===doc.sha256&&row.objectPath===doc.objectPath))
    throw documentAccessError();
  // Use a PDF-only blob, not a storage-controlled MIME type or URL.
  const href=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const tab=window.open(href,'_blank','noopener');
  if(!tab){URL.revokeObjectURL(href);throw new Error('Webbläsaren blockerade PDF-fönstret.');}
  setTimeout(()=>URL.revokeObjectURL(href),120000);
}
function reviewMarkup(proposal){
  const blocked=proposal.status==='blocked';
  const currency=new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'});
  const notes=[...proposal.blockers,...proposal.warnings];
  const lines=blocked?'':'<div class="documents-pdf-ledger-wrap"><table class="documents-pdf-ledger" aria-label="Preliminär kontering">'+
    '<thead><tr><th>Konto</th><th>Debet</th><th>Kredit</th></tr></thead><tbody>'+
    proposal.rows.map(row=>'<tr><td><strong>'+esc(row.account)+'</strong><small>'+esc(row.label)+'</small></td>'+
      '<td>'+esc(row.debitOre?currency.format(row.debitOre/100):'—')+'</td>'+
      '<td>'+esc(row.creditOre?currency.format(row.creditOre/100):'—')+'</td></tr>').join('')+
    '</tbody></table></div>';
  return '<div class="documents-pdf-review-panel"><strong>'+(blocked?'Kan inte skapa ett säkert utkast':'Granskningsutkast – inte AI')+'</strong>'+
    '<p>Ej bokfört · ej sparat · '+(blocked?'Utkastet stoppades':'Moms '+esc(proposal.checks.vatRate)+' % enligt beloppen')+'</p>'+
    lines+'<div class="documents-pdf-warnings"><strong>'+(blocked?'Varför utkastet stoppades':'Kontrollera före bokföring')+'</strong>'+
    '<ul>'+notes.map(note=>'<li>'+esc(note)+'</li>').join('')+'</ul></div>'+
    '<p>Utkastet går inte att godkänna, spara eller bokföra här. Kontrollera alltid originalet och att underlaget inte redan är bokfört.</p></div>';
}
async function previewSupabaseDocument(id){
  const source=activePdfReview,modal=document.querySelector('.documents-pdf-preview');
  if(!isSupabase||!source||!modal||!window.LTStudioDocumentReview||
    String(source.documentId)!==String(id)||String(modal.dataset.documentId)!==String(id)){
    throw new Error('DOCUMENT_REVIEW_EXPIRED');
  }
  const ctx=await window.LTSupabaseUat.context();
  const doc=documents.find(d=>String(d.id)===String(id));
  if(!ctx?.authenticated||!ctx.company?.id||!ctx.accessToken||
    ctx.company.id!==source.companyId||
    (source.userId&&ctx.authUser?.id!==source.userId)||
    !doc||doc.sha256!==source.sha256||doc.objectPath!==source.objectPath||
    doc.category!==source.category||!validArchivePath(doc,ctx.company.id)){
    throw new Error('DOCUMENT_REVIEW_EXPIRED');
  }
  const target=modal.querySelector('[data-document-review-result]');
  if(!target)throw new Error('DOCUMENT_REVIEW_EXPIRED');
  const expenseAccount=modal.querySelector('[data-document-expense]')?.value;
  const paymentAccount=modal.querySelector('[data-document-payment]')?.value;
  if(!expenseAccount||(source.category==='receipt'&&!paymentAccount)){
    target.textContent='Välj inköpstyp'+(source.category==='receipt'?' och hur kvittot betalades':'')+' för att visa ett granskningsutkast.';
    return;
  }
  try{
    const proposal=window.LTStudioDocumentReview.buildReview(source.extraction,{
      expenseAccount,...(source.category==='receipt'?{paymentAccount}:{})
    });
    target.innerHTML=reviewMarkup(proposal);
  }catch{
    target.textContent='Utkastet kunde inte beräknas säkert. Kontrollera originalet.';
  }
}
async function readSupabaseDocument(id){
  if(!isSupabase||!window.LTStudioDocumentReader||!window.LTStudioDocumentReview)throw new Error('LOCAL_READER_UNAVAILABLE');
  const ctx=await window.LTSupabaseUat.context();
  if(!ctx?.authenticated||!ctx.company?.id||!ctx.accessToken)throw new Error('AUTH_REQUIRED');
  const doc=documents.find(d=>String(d.id)===String(id));
  if(!doc||String(doc.companyId)!==String(ctx.company.id)||
     !['supplier-invoice','receipt'].includes(doc.category)||
     doc.mimeType!=='application/pdf'||!doc.objectPath||
     !validArchivePath(doc,ctx.company.id)||
     !/^[a-f0-9]{64}$/i.test(doc.sha256||''))throw new Error('DOCUMENT_NOT_VERIFIED');
  const blob=await window.LTSupabase.storage.download('lt-documents',doc.objectPath,ctx.accessToken);
  if(!blob||blob.size!==doc.sizeBytes||blob.size>10*1024*1024)throw new Error('DOCUMENT_SIZE_MISMATCH');
  const bytes=await blob.arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const actual=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==doc.sha256.toLowerCase())throw new Error('DOCUMENT_HASH_MISMATCH');
  const file=new File([bytes],doc.fileName,{type:'application/pdf'});
  const result=await window.LTStudioDocumentReader.readPdf(file,doc.category);
  // Recheck the personal session after asynchronous file reading.
  const current=await window.LTSupabaseUat.context();
  if(!current?.authenticated||current.company?.id!==ctx.company.id||
     current.accessToken!==ctx.accessToken||
     (ctx.authUser?.id&&current.authUser?.id!==ctx.authUser.id)||
     !documents.some(d=>d.id===doc.id&&d.sha256===doc.sha256&&d.objectPath===doc.objectPath)){
    throw new Error('DOCUMENT_REVIEW_EXPIRED');
  }
  const labels={supplier:'Leverantör / butik',reference:'Faktura- eller kvittonummer',
    invoiceDate:'Datum',dueDate:'Förfallodatum',netOre:'Exklusive moms',vatOre:'Moms',grossOre:'Totalt'};
  const currency=new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'});
  const rows=Object.entries(labels).map(([key,label])=>{
    const value=result.fields[key]?.value;
    return '<div class="documents-pdf-fact"><small>'+esc(label)+'</small><strong>'+
      esc(value==null?'Inte identifierat':key.endsWith('Ore')?currency.format(value/100):value)+'</strong></div>';
  }).join('');
  const warnings=result.warnings.map(w=>'<li>'+esc(w)+'</li>').join('');
  const accounts=Object.entries(window.LTStudioDocumentReview?.ACCOUNTS||{});
  const payments=Object.entries(window.LTStudioDocumentReview?.PAYMENT||{});
  const choices=accounts.map(([account,label])=>'<option value="'+esc(account)+'">'+esc(label)+'</option>').join('');
  const paymentChoices=payments.map(([account,label])=>'<option value="'+esc(account)+'">'+esc(label)+'</option>').join('');
  document.body.insertAdjacentHTML('beforeend',
    '<div class="documents-modal-backdrop" data-close><section class="documents-modal documents-pdf-preview" data-document-id="'+esc(doc.id)+'" role="dialog" aria-modal="true" aria-label="Lokal PDF-avläsning och granskningsutkast">'+
    '<header><div><span class="eyebrow">Lokal PDF-avläsning – inte AI</span><h2>'+esc(doc.title)+'</h2></div>'+
    '<button class="documents-close" type="button" data-close aria-label="Stäng">×</button></header>'+
    '<div class="documents-pdf-body"><p>Originalets SHA-256 kontrollerades. PDF-texten har lästs enbart i webbläsaren, utan att skickas till AI. Kontrollera allt mot originalet.</p>'+
    '<div class="documents-pdf-facts">'+rows+'</div>'+
    '<div class="documents-pdf-warnings"><strong>Att kontrollera</strong>'+
    (warnings?'<ul>'+warnings+'</ul>':'<p>Inga uppenbara beloppsavvikelser, men originalet måste fortfarande granskas.</p>')+'</div>'+
    '<section class="documents-pdf-review"><h3>Visa ett bokföringsutkast</h3><p>Välj själv vad inköpet gäller. Beräkningen sker lokalt, utan AI eller bokföring.</p>'+
    '<div class="documents-pdf-choices"><label>Vad köptes?<select data-document-expense><option value="">Välj inköpstyp</option>'+choices+'</select></label>'+
    (doc.category==='receipt'?'<label>Hur betalades kvittot?<select data-document-payment><option value="">Välj betalningssätt</option>'+paymentChoices+'</select></label>':'')+
    '</div><button type="button" class="button" data-preview-document="'+esc(doc.id)+'">Visa granskningsutkast</button>'+
    '<div data-document-review-result role="status" aria-live="polite"></div></section></div>'+
    '<footer><button class="button ghost" type="button" data-close>Stäng granskning</button></footer></section></div>');
  activePdfReview={documentId:doc.id,companyId:ctx.company.id,userId:ctx.authUser?.id||null,
    sha256:doc.sha256,objectPath:doc.objectPath,category:doc.category,extraction:result};
}
async function load(){if(isDemo){if(!Demo)throw new Error('Det gemensamma demoscenariot kunde inte laddas.');session={user:{displayName:'Demo Dokument'},company:{name:'Rollands Frukt o Grönt AB'}};documents=Demo.section('documents');render();return}if(isSupabase){if(await loadSupabaseDocuments())render();return}const s=await api('/session');if(!s.authenticated){location.href='./index.html';return}session=s;documents=(await api('/documents')).documents||[];render()}
load().catch(err=>{app.innerHTML=`<main class="boot"><strong>Dokumentarkivet kunde inte laddas</strong><span>${esc(err.message)}</span></main>`});
