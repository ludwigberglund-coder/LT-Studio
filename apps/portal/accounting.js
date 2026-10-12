const app=document.getElementById('accounting-app');
const isDemo=new URLSearchParams(location.search).get('demo')==='1';
const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!isDemo;
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
let Demo=globalThis.RollandsDemoScenario;
let session=null,entries=[],periods=[],monthCoverage=null,unmatchedBankEvidence=null,unlockRequests=[],unlockPolicy={eligibleCustomerApprovers:0,selfUnlockAllowed:false,adminSelfUnlockAllowed:false},selectedEntry=null,journalExpanded=false,journalQuery='',journalSuggestionsOpen=false,journalSuggestionIndex=-1,openingYear=today().slice(0,4),openingBalance=null,openingBatch=null,openingMessage='';
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function ore(v){return new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',minimumFractionDigits:2}).format(Number(v||0)/100)}
function today(){return isDemo&&Demo?Demo.AS_OF_DATE:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function currentPeriod(){return today().slice(0,7)}
function url(path){return `${path}${isDemo?'?demo=1':''}`}
function amountToOre(value){
  const raw=String(value??'').trim().replace(/\s/g,'').replace(',','.');
  if(!raw)return 0;
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw))throw new Error('Belopp måste anges i kronor med högst två decimaler.');
  const [whole,dec='']=raw.split('.');
  const ore=Number(whole)*100+Number(dec.padEnd(2,'0'));
  if(!Number.isSafeInteger(ore)||ore<0)throw new Error('Beloppet är för stort.');
  return ore;
}
function openingLineRow(index){
  return `<div class="opening-line-row">
    <label>Konto<input data-opening="account" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="1930" required></label>
    <label>Text<input data-opening="text" maxlength="240" placeholder="Beskrivning"></label>
    <label>Debet (kr)<input data-opening="debit" inputmode="decimal" placeholder="0,00"></label>
    <label>Kredit (kr)<input data-opening="credit" inputmode="decimal" placeholder="0,00"></label>
    <button class="button ghost small opening-remove" type="button" aria-label="Ta bort rad">Ta bort</button>
  </div>`;
}

async function api(path,options={}){const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})};const r=await fetch(`/api/v1${path}`,{credentials:'same-origin',...options,headers,body:options.body?JSON.stringify(options.body):undefined});const data=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(data.error||'Begäran misslyckades.');e.code=data.code;throw e}return data}
function sidebar(){return `<aside class="sidebar"><div class="logo"><strong>LT Studio</strong><small>LT STUDIO</small></div><div class="company-pill">${esc(session?.company?.name||(isDemo?'Demoföretag':'Företaget'))}<br>${isDemo?'Demoföretag':'Skyddad företagsmiljö'}</div><div class="side-group"><span>Arbetsyta</span><a class="side-link" href="${url('./dashboard.html')}">Översikt</a></div><div class="side-group"><span>Ekonomi</span><a class="side-link" href="${url('./payables.html')}">Leverantörsfakturor</a><a class="side-link active" href="${url('./accounting.html')}">Bokföring</a><a class="side-link" href="${url('./reports.html')}">Rapporter</a><a class="side-link" href="${url('./documents.html')}">Dokument</a></div><div class="sidebar-footer">${isDemo?'Gemensamt UAT-scenario · ingen skarp bokföring':'Personlig session · servervaliderad behörighet'}</div></aside>`}
function statusLabel(status){return status==='locked'?'Låst':status==='pending'?'Väntar beslut':status==='approved'?'Godkänd':status==='rejected'?'Avslagen':'Öppen'}
function entryTotal(entry){return (entry.lines||[]).reduce((sum,line)=>sum+Number(line.debitOre||0),0)}
function syncDemo(selectedId){const state=Demo.state();monthCoverage=null;unmatchedBankEvidence=null;entries=structuredClone(state.accountingEntries);periods=structuredClone(state.accountingPeriods);unlockRequests=structuredClone(state.accountingUnlockRequests);selectedEntry=entries.find(e=>e.id===(selectedId||selectedEntry?.id))||sortedJournalEntries()[0]||null}
function openingBalancePanel(){
  if(isDemo)return `<article class="panel opening-panel"><span class="eyebrow">Ingående balans</span><h2>Startsaldo vid systembyte</h2><p>Import av ingående balans är avstängd i den publika demon och används bara i den skyddade företagsmiljön.</p><div class="notice-box">Kundfordringar och leverantörsskulder importeras inte som totalsummor. De måste senare tas in tillsammans med sina öppna fakturor.</div></article>`;
  const selector=`<form class="opening-year-form" id="opening-year-form"><label>Räkenskapsår<input name="year" type="number" min="1900" max="2199" value="${esc(openingYear)}" required></label><button class="button ghost" type="submit">Visa år</button><p class="form-error"></p></form>`;
  if(openingBalance){
    return `<article class="panel opening-panel"><div class="section-head"><div><span class="eyebrow">Ingående balans</span><h2>${esc(openingBalance.number)} · ${esc(openingYear)}</h2><p>Importerad ${esc(openingBalance.postingDate)}. Originalet bevaras som en särskild IB-verifikation.</p></div>${selector}</div>
      <div class="entry-lines">${(openingBalance.lines||[]).map(line=>`<div class="entry-line"><b>${esc(line.account)}</b><span>${esc(line.text||'')}</span><span class="money">Debet ${line.debitOre?ore(line.debitOre):'—'}</span><span class="money">Kredit ${line.creditOre?ore(line.creditOre):'—'}</span></div>`).join('')}</div>
      <div class="notice-box warning">1510 Kundfordringar och 2440 Leverantörsskulder måste importeras tillsammans med öppna reskontraposter och ingår därför inte i denna totalsaldoimport.</div>
    </article>`;
  }
  if(openingBatch){return `<article class="panel opening-panel"><div class="section-head"><div><span class="eyebrow">Ingående balans</span><h2>Väntar i bunt #${esc(String(openingBatch.batchNumber||'').padStart(5,'0'))}</h2><p>Startsaldot är validerat men påverkar ännu inte huvudboken.</p></div>${selector}</div><div class="notice-box"><b>Ekonomisk kvalitetskontroll:</b> öppna Buntar och godkänn bunten. Först därefter skapas IB-verifikationen.</div></article>`}
  return `<article class="panel opening-panel"><div class="section-head"><div><span class="eyebrow">Ingående balans</span><h2>Importera startsaldo</h2><p>För vanliga balanskonton när ett företag börjar använda LT Studio.</p></div>${selector}</div>
    ${openingMessage?`<div class="notice-box warning">${esc(openingMessage)}</div>`:''}
    <div class="notice-box warning"><b>Viktigt:</b> 1510 och 2440 är blockerade här. Öppna kund- och leverantörsfakturor måste importeras tillsammans med reskontran.</div>
    <form class="accounting-form" id="opening-balance-form">
      <div class="opening-meta"><label>Bokföringsdatum<input value="${esc(openingYear)}-01-01" disabled></label><span>Importen måste göras innan andra verifikationer finns i året.</span></div>
      <div class="opening-lines" id="opening-lines">${openingLineRow(0)}${openingLineRow(1)}</div>
      <label class="opening-confirm"><input type="checkbox" name="confirm" required> Jag har kontrollerat underlaget och att debet och kredit balanserar. Importen skapar först en bunt och därefter, efter godkännande, en spårbar IB-verifikation.</label>
      <div class="toolbar"><button class="button ghost" data-action="add-opening-line" type="button">Lägg till rad</button><button class="button" type="submit">Importera ingående balans</button></div>
      <p class="form-error"></p>
    </form>
  </article>`;
}
async function loadOpeningBalance(){
  if(isSupabase){openingBalance=entries.find(entry=>entry.sourceType==='opening-balance'&&String(entry.sourceId)===String(openingYear))||null;openingBatch=null;openingMessage='';if(openingBalance)return;const ctx=await window.LTSupabaseUat.context(),filter='company_id=eq.'+encodeURIComponent(ctx.company.id);const txRows=await window.LTSupabase.from('financial_batch_transactions',ctx.accessToken).select('*',filter+'&source_type=eq.opening-balance&source_id=eq.'+encodeURIComponent(openingYear)+'&activation_type=eq.opening-balance');const tx=txRows?.[0];if(tx){const batchRows=await window.LTSupabase.from('financial_batches',ctx.accessToken).select('*',filter+'&id=eq.'+encodeURIComponent(tx.batch_id));const batch=batchRows?.[0];if(batch&&batch.status==='ready')openingBatch={id:batch.id,batchNumber:batch.batch_number,status:batch.status}}return}
  if(isDemo){openingBalance=null;return}
  try{openingBalance=(await api(`/accounting/opening-balances/${encodeURIComponent(openingYear)}`)).entry;openingMessage=''}
  catch(error){
    if(error.code==='OPENING_BALANCE_NOT_FOUND'){openingBalance=null;return}
    throw error;
  }
}
function beginnerGuide(){
  return '<details class="accounting-help"><summary>Ny på bokföring? Förstå orden här</summary>'+
    '<div class="accounting-help-body"><p>Du behöver inte kunna debet och kredit för att granska vad som har hänt. Välj en rad under Bokförda poster för att se vilka konton som använts.</p>'+
    '<dl>'+
    '<div><dt>Verifikation</dt><dd>En registrerad bokföringshändelse med datum, belopp och konton. Den bevaras så att det går att följa vad som har hänt.</dd></div>'+
    '<div><dt>Debet och kredit</dt><dd>Två sidor av samma bokföring. De betyder inte automatiskt pengar in eller ut. Summorna ska balansera.</dd></div>'+
    '<div><dt>Bunt</dt><dd>Ett antal poster som kan behöva granskas och godkännas innan de bokförs.</dd></div>'+
    '<div><dt>Periodlås</dt><dd>Skyddar en avslutad tidsperiod från nya bokföringar. Bara behöriga personer kan låsa upp.</dd></div>'+
    '</dl><p class="accounting-help-note">Den här hjälpen förklarar begreppen men ändrar inga verifikationer eller perioder. Kontrollera alltid underlaget innan du godkänner bokföring.</p></div></details>';
}
function monthBounds(period){
  const year=Number(period.slice(0,4)),month=Number(period.slice(5,7));
  const next=month===12?(year+1)+'-01':year+'-'+String(month+1).padStart(2,'0');
  return {start:period+'-01',end:next+'-01'};
}
function monthlyGuide(current){
  const renderer=globalThis.LTMonthCloseGuide?.render;
  if(typeof renderer!=='function')return '';
  return renderer({
    period:current.period,
    periodStatus:current.status,
    periodExists:periods.some(p=>p.period===current.period),
    visibleEntries:entries.filter(e=>String(e.postingDate||'').slice(0,7)===current.period).length,
    journalEntries:entries.filter(e=>String(e.postingDate||'').slice(0,7)===current.period),
    companyId:session?.company?.id||null,
    coverage:monthCoverage,
    unmatchedBankEvidence,
    demo:isDemo
  });
}
function render(){const current=periods.find(p=>p.period===currentPeriod())||{period:currentPeriod(),status:'open'};app.innerHTML=`<div class="accounting-shell">${sidebar()}<section class="accounting-main"><header class="topbar"><div><h1>Bokföring & perioder</h1><p>Verifikationer bevaras. Rättelser sker med nya spårbara poster.</p></div><div class="user-chip"><b>${esc(session?.user?.displayName||'Demoanvändare')}</b></div></header><main class="accounting-content">${isDemo?'<div class="demo-banner"><b>Gemensamt UAT-scenario.</b> Här visas även verifikationer som skapas av andra demoflöden, till exempel bekräftade leverantörsbetalningar.</div>':''}${beginnerGuide()}<section class="accounting-grid"><article class="panel" id="journal-entries"><span class="eyebrow">Verifikationer</span><h2>Bokförda poster</h2><p>Klicka på en rad för att se exakt konto, debet och kredit.</p>${entryTable()}${entryDetail()}</article><article class="panel"><span class="eyebrow">Periodkontroll</span><h2>${esc(current.period)} · <span class="status-pill ${current.status==='locked'?'locked':''}">${statusLabel(current.status)}</span></h2><p>En låst period kan inte ta emot nya verifikationer. Admin kan alltid låsa upp perioden själv; övriga följer företagets kontrollregler.</p>${periodControls(current)}${periodList()}${unlockList()}</article></section>${monthlyGuide(current)}${openingBalancePanel()}</main></section></div>`;bind()}
function sortedJournalEntries(){
  const timeOf=entry=>{
    const created=Date.parse(String(entry.createdAt||entry.created_at||''));
    if(Number.isFinite(created))return created;
    const posted=Date.parse(String(entry.postingDate||entry.date||''));
    return Number.isFinite(posted)?posted:0;
  };
  return [...entries].sort((left,right)=>{
    const chronological=timeOf(right)-timeOf(left);
    if(chronological)return chronological;
    const byNumber=String(right.number||'').localeCompare(String(left.number||''),'sv',{numeric:true});
    return byNumber||String(right.id||'').localeCompare(String(left.id||''));
  });
}
function filteredJournalEntries(){
  const query=journalQuery.trim().toLocaleLowerCase("sv-SE");
  const ordered=sortedJournalEntries();
  if(!query)return ordered;
  return ordered.filter(entry=>{
    const lines=Array.isArray(entry.lines)?entry.lines:[];
    const searchable=[entry.number,entry.postingDate,entry.description,entry.sourceType,
      ...lines.flatMap(line=>[line.account,line.text])];
    return searchable.some(value=>String(value??"").toLocaleLowerCase("sv-SE").includes(query));
  });
}
function journalSearchCoverage(){
  // Reuse the month guide's tenant-, period-, age- and integrity-aware checks.
  // Matching row counts cannot establish that the ledger is reconciled.
  if(!isSupabase)return '';
  const state={companyId:session?.company?.id||null,coverage:monthCoverage};
  const coverage=globalThis.LTMonthCloseGuide?.evaluateCoverage?.(state,currentPeriod());
  if(!coverage||coverage.status==='unavailable'){
    return '<p class="journal-coverage-warning" role="status">Sökningens kontrolluppgifter saknas, är för gamla eller kunde inte verifieras. Sökresultatet kan vara ofullständigt. Uppdatera sidan och kontrollera underlaget.</p>';
  }
  if(coverage.status==='matched')return '';
  const c=coverage.counts;
  const missing=c.loadedEntries!==c.totalEntries||c.loadedLines!==c.totalLines;
  const detail=missing
    ? 'Vi har läst in '+c.loadedEntries+' av '+c.totalEntries+' verifikationer och '+c.loadedLines+' av '+c.totalLines+' konteringsrader.'
    :'Det finns en avvikelse i de inlästa bokföringsraderna.';
  return '<p class="journal-coverage-warning" role="status">'+detail+' Sökresultatet kan därför vara ofullständigt. Kontrollera underlaget innan du drar slutsatser.</p>';
}
function entryTable(){
  const ordered=filteredJournalEntries(),searched=Boolean(journalQuery.trim());
  const hasOlder=ordered.length>5,expanded=hasOlder&&journalExpanded;
  const count=searched?ordered.length+(ordered.length===1?" träff":" träffar")+" av "+entries.length+" inlästa":entries.length+" totalt";
  const hint=searched?"Sökresultat":"Senaste verifikationerna";
  const suggestions=searched?ordered.slice(0,5):[];
  const suggestionOpen=journalSuggestionsOpen&&suggestions.length>0;
  const empty=searched?"Inga verifikationer matchar sökningen. Prova ett annat nummer, datum eller konto.":"Inga verifikationer ännu.";
  return `<section class="journal-list" aria-label="Verifikationslista">
    <div class="journal-list-heading"><strong>${hint}</strong><span id="journal-search-status" role="status" aria-live="polite">${count}${hasOlder?" · rulla i tabellen för äldre":""}</span></div>
    <div class="journal-search">
      <label for="journal-search-field">Sök verifikation</label>
      <div class="journal-search-controls">
        <input id="journal-search-field" type="search" role="combobox" aria-autocomplete="list" aria-controls="journal-search-suggestions" aria-expanded="${suggestionOpen?"true":"false"}" aria-activedescendant="${suggestionOpen&&journalSuggestionIndex>=0?"journal-suggestion-"+journalSuggestionIndex:""}" maxlength="100" autocomplete="off" spellcheck="false" placeholder="Nummer, datum, text eller konto" value="${esc(journalQuery)}">
        ${journalQuery?`<button class="button ghost small journal-search-clear" data-action="clear-journal-search" type="button">Rensa sökning</button>`:""}
      </div>
      <div id="journal-search-suggestions" class="journal-search-suggestions" role="listbox" aria-label="Förslag på verifikationer" ${suggestionOpen?"":"hidden"}>
        ${suggestionOpen?suggestions.map((entry,index)=>`<button id="journal-suggestion-${index}" type="button" role="option" aria-selected="${index===journalSuggestionIndex?"true":"false"}" data-journal-suggestion="${esc(entry.id)}" tabindex="-1"><strong>${esc(entry.number)} · ${esc(entry.postingDate)}</strong><span>${esc(entry.description)}</span></button>`).join(""):""}
      </div>
      <p>Sökningen omfattar bara de verifikationer som redan lästs in för detta företag.</p>
      ${journalSearchCoverage()}
    </div>
    <div id="journal-scroll-region" class="accounting-table-scroll journal-scroll ${expanded?"journal-scroll-expanded":""}" role="region" tabindex="0" aria-label="Verifikationer, rulla med musens hjul för att se äldre">
      <table class="accounting-table journal-table">
        <thead><tr><th>Nr</th><th>Datum</th><th>Text</th><th>Källa</th><th class="money">Belopp</th></tr></thead>
        <tbody>${ordered.map(e=>`<tr data-entry="${esc(e.id)}" tabindex="0" aria-current="${selectedEntry?.id===e.id?"true":"false"}" title="Visa verifikation ${esc(e.number)}"><td><b>${esc(e.number)}</b></td><td>${esc(e.postingDate)}</td><td title="${esc(e.description)}">${esc(e.description)}</td><td title="${esc(e.sourceType)}">${esc(e.sourceType)}</td><td class="money">${ore(entryTotal(e))}</td></tr>`).join("")||`<tr><td colspan="5" class="empty-state">${empty}</td></tr>`}</tbody>
      </table>
    </div>
    ${hasOlder?`<button class="button ghost journal-toggle" type="button" data-action="toggle-journals" aria-expanded="${expanded?"true":"false"}" aria-controls="journal-scroll-region">${expanded?"Visa färre":"Visa fler verifikationer"} <span aria-hidden="true">${expanded?"▴":"▾"}</span></button>`:""}
  </section>`;
}
function entryDetail(){if(!selectedEntry)return'';const opening=selectedEntry.sourceType==='opening-balance';if(isSupabase){const manual=['manual','manual-journal'].includes(selectedEntry.sourceType)&&!(selectedEntry.lines||[]).some(line=>/^(151|244)\d$/.test(String(line.account)));const action=opening?'<div class="notice-box warning">Ingående balans rättas inte genom det generella rättelseflödet.</div>':manual?`<div class="notice-box">Originalverifikationen ändras aldrig. Rättelsen skapar en ny motverifikation med omvänd debet/kredit.</div><form class="accounting-form" id="correction-form"><label>Rättelsedatum<input name="postingDate" type="date" value="${today()}" required></label><label>Orsak<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><button class="button" type="submit">Skapa motverifikation</button><p class="form-error"></p></form>`:'<div class="notice-box warning">Den här posten kommer från faktura, betalning, lön eller annat källflöde. En fristående motverifikation kan ge fel reskontra och är därför spärrad här.</div>';return `<div class="entry-detail"><div class="section-head"><div><span class="eyebrow">${esc(selectedEntry.number)}</span><h2>${esc(selectedEntry.description)}</h2></div></div><div class="entry-lines">${(selectedEntry.lines||[]).map(line=>`<div class="entry-line"><b>${esc(line.account)}</b><span>${esc(line.text||'')}</span><span class="money">Debet ${line.debitOre?ore(line.debitOre):'—'}</span><span class="money">Kredit ${line.creditOre?ore(line.creditOre):'—'}</span></div>`).join('')}</div>${action}</div>`}return `<div class="entry-detail"><div class="section-head"><div><span class="eyebrow">${esc(selectedEntry.number)}</span><h2>${esc(selectedEntry.description)}</h2></div></div><div class="entry-lines">${(selectedEntry.lines||[]).map(line=>`<div class="entry-line"><b>${esc(line.account)}</b><span>${esc(line.text||'')}</span><span class="money">Debet ${line.debitOre?ore(line.debitOre):'—'}</span><span class="money">Kredit ${line.creditOre?ore(line.creditOre):'—'}</span></div>`).join('')}</div>${opening?'<div class="notice-box warning">Ingående balans rättas inte genom det generella rättelseflödet. Granska migreringsunderlaget och använd ett särskilt dokumenterat migrations-/rättelseflöde.</div>':`<div class="notice-box">Originalverifikationen ändras aldrig. En rättelse skapar en ny motverifikation med omvänd debet/kredit.</div><form class="accounting-form" id="correction-form"><label>Rättelsedatum<input name="postingDate" type="date" value="${today()}" required></label><label>Orsak<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><button class="button" type="submit">Skapa motverifikation</button><p class="form-error"></p></form>`}</div>`}
function periodControls(current){if(current.status==='locked'){if(session?.role==='admin'||unlockPolicy.adminSelfUnlockAllowed)return `<form class="accounting-form" id="unlock-form"><label>Orsak till upplåsning<textarea name="reason" minlength="5" maxlength="500" required>Admin öppnar perioden för fortsatt bokföringsarbete.</textarea></label><button class="button" type="submit">Lås upp ${esc(current.period)}</button><p class="form-error"></p></form>`;return `<form class="accounting-form" id="unlock-form"><label>Orsak till upplåsning<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><button class="button" type="submit">Begär upplåsning</button><p class="form-error"></p></form>`}return `<div class="toolbar"><button class="button" data-action="lock-current" type="button">Lås ${esc(current.period)}</button></div>`}
function periodList(){return `<div class="period-list">${periods.map(p=>`<div class="period-row"><div><b>${esc(p.period)}</b><br><small>${p.lockedAt?`Låst ${esc(String(p.lockedAt).slice(0,10))}`:'Öppen för bokföring'}</small></div><span class="status-pill ${p.status==='locked'?'locked':''}">${statusLabel(p.status)}</span><span></span></div>`).join('')}</div>`}
function unlockList(){
  const pending=unlockRequests.filter(r=>r.status==='pending');
  const permissions=new Set(session?.permissions||[]);
  return `<div class="entry-detail"><span class="eyebrow">Upplåsningskö</span><h2>Väntande beslut</h2>${pending.map(r=>{
    if(isDemo)return `<div class="period-row"><div><b>${esc(r.period)}</b><br><small>${esc(r.reason)}</small></div><span class="status-pill pending">Väntar beslut</span><button class="button ghost small" type="button" data-action="approve-unlock" data-id="${esc(r.id)}">Godkänn demo</button></div>`;
    const ownRequest=r.requestedBy===session?.user?.id;
    const canDecide=permissions.has('period.unlock');
    if(ownRequest&&session?.role==='admin'&&canDecide){
      return `<div class="period-row"><div><b>${esc(r.period)}</b><br><small>${esc(r.reason)}</small><br><small>Admin kan låsa upp sin egen period direkt. Åtgärden loggas.</small></div><span class="status-pill pending">Väntar beslut</span><button class="button small" type="button" data-action="approve-unlock" data-id="${esc(r.id)}">Lås upp period</button></div>`;
    }
    if(ownRequest&&unlockPolicy.selfUnlockAllowed&&canDecide){
      return `<div class="period-row unlock-self-row"><div><b>${esc(r.period)}</b><br><small>${esc(r.reason)}</small><div class="notice-box warning"><b>Ensam behörig användare.</b> Du kan låsa upp själv efter ny verifiering med lösenord och MFA. Åtgärden loggas särskilt.</div><form class="accounting-form self-unlock-form" data-id="${esc(r.id)}"><label>Beslutsorsak<textarea name="reason" minlength="5" maxlength="500" required>Kontrollerad självupplåsning för fortsatt bokföringsarbete.</textarea></label><label>Lösenord<input name="password" type="password" autocomplete="current-password" required></label><label>Aktuell MFA-kod<input name="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="button" type="submit">Verifiera och lås upp</button><p class="form-error"></p></form></div><span class="status-pill pending">Väntar beslut</span></div>`;
    }
    if(ownRequest)return `<div class="period-row"><div><b>${esc(r.period)}</b><br><small>${esc(r.reason)}</small><br><small>En annan behörig användare hos företaget måste fatta beslutet.</small></div><span class="status-pill pending">Väntar beslut</span><span></span></div>`;
    if(canDecide)return `<div class="period-row"><div><b>${esc(r.period)}</b><br><small>${esc(r.reason)}</small></div><span class="status-pill pending">Väntar beslut</span><div class="toolbar"><button class="button small" type="button" data-action="approve-unlock" data-id="${esc(r.id)}">Godkänn upplåsning</button><button class="button ghost small" type="button" data-action="reject-unlock" data-id="${esc(r.id)}">Avslå</button></div></div>`;
    return `<div class="period-row"><div><b>${esc(r.period)}</b><br><small>${esc(r.reason)}</small><br><small>Du saknar behörighet att fatta beslut om upplåsning.</small></div><span class="status-pill pending">Väntar beslut</span><span></span></div>`;
  }).join('')||'<p class="empty-state">Ingen väntande begäran.</p>'}</div>`;
}
async function loadSupabaseAccounting(){
  const ctx=await window.LTSupabaseUat.context();
  if(!ctx.authenticated||!ctx.company){location.href='./index.html';return false}
  const canManage=['admin','accountant'].includes(ctx.membership?.role);
  session={user:{...ctx.user,id:ctx.authUser.id},company:ctx.company,role:ctx.membership?.role||'',permissions:canManage?['period.unlock','accounting.correct']:[]};
  const filter='company_id=eq.'+encodeURIComponent(ctx.company.id);
  const [entryRows,lineRows,periodRows,unlockRows]=await Promise.all([
    window.LTSupabase.from('journal_entries',ctx.accessToken).select('*',filter+'&order=posting_date.desc,created_at.desc'),
    window.LTSupabase.from('journal_lines',ctx.accessToken).select('*',filter+'&order=journal_entry_id.asc,line_number.asc'),
    window.LTSupabase.from('accounting_periods',ctx.accessToken).select('*',filter+'&order=period.desc'),
    window.LTSupabase.from('period_unlock_requests',ctx.accessToken).select('*',filter+'&order=requested_at.desc')
  ]);
  // Alla tre antalen beräknas i databasen utan att hämta fler kunduppgifter.
  // Rest API may limit rows; missing/failed counts must never look complete.
  const period=currentPeriod(),bounds=monthBounds(period);
  try{
    const [totalEntries,totalLines,periodEntries]=await Promise.all([
      window.LTSupabase.from('journal_entries',ctx.accessToken).countExact(filter),
      window.LTSupabase.from('journal_lines',ctx.accessToken).countExact(filter),
      window.LTSupabase.from('journal_entries',ctx.accessToken).countExact(
        filter+'&posting_date=gte.'+bounds.start+'&posting_date=lt.'+bounds.end)
    ]);
    monthCoverage={
      status:'checked',companyId:ctx.company.id,period,
      totalEntries,totalLines,periodEntries,
      loadedEntries:entryRows.length,loadedLines:lineRows.length,
      loadedPeriodEntries:entryRows.filter(row=>String(row.posting_date||'').slice(0,7)===period).length,
      checkedAt:new Date().toISOString()
    };
  }catch{
    monthCoverage={status:'unavailable',companyId:ctx.company.id,period};
  }
  // A separate, tenant-scoped indication of unplaced bank payments.
  // This is company-wide, NOT month-specific and NOT a bank reconciliation.
  try{
    const count=await window.LTSupabase.from('bank_payments',ctx.accessToken)
      .countExact(filter+'&status=eq.unmatched');
    unmatchedBankEvidence={status:'checked',companyId:ctx.company.id,count,
      checkedAt:new Date().toISOString()};
  }catch{
    unmatchedBankEvidence={status:'unavailable',companyId:ctx.company.id};
  }
  // Count parity alone cannot reveal duplicate rows or lines attached to an unknown entry.
  // These local integrity checks never mutate or attest the underlying ledger.
  const entryIds=new Set(entryRows.map(row=>String(row.id)));
  const lineIds=new Set();
  let duplicateEntryIds=entryRows.length-entryIds.size;
  let duplicateLineIds=0,orphanLines=0,wrongCompanyLines=0;
  for(const line of lineRows){
    const lineId=String(line.id);
    if(lineIds.has(lineId))duplicateLineIds++;
    lineIds.add(lineId);
    if(!entryIds.has(String(line.journal_entry_id)))orphanLines++;
    if(String(line.company_id)!==String(ctx.company.id))wrongCompanyLines++;
  }
  if(monthCoverage?.status==='checked'){
    monthCoverage.integrity={
      duplicateEntryIds,duplicateLineIds,orphanLines,wrongCompanyLines,
      checkedEntries:entryRows.length,checkedLines:lineRows.length
    };
  }
  const linesByEntry=new Map();
  for(const row of lineRows||[]){
    const key=String(row.journal_entry_id);
    if(!linesByEntry.has(key))linesByEntry.set(key,[]);
    linesByEntry.get(key).push({id:row.id,account:row.account,text:row.description||'',debitOre:Number(row.debit_ore||0),creditOre:Number(row.credit_ore||0),lineNumber:Number(row.line_number||0)});
  }
  entries=(entryRows||[]).map(row=>({
    id:row.id,
    number:String(row.series||'A')+String(row.journal_number||''),
    series:row.series||'A',
    postingDate:row.posting_date,
    description:row.description,
    sourceType:row.source_type||'',
    sourceId:row.source_id||'',
    createdBy:row.created_by||'',
    createdAt:row.created_at,
    lines:linesByEntry.get(String(row.id))||[]
  }));
  periods=(periodRows||[]).map(row=>({period:row.period,status:row.status,lockedBy:row.locked_by||null,lockedAt:row.locked_at||null}));
  unlockRequests=(unlockRows||[]).map(row=>({id:row.id,period:row.period,reason:row.reason,status:row.status,requestedBy:row.requested_by,requestedAt:row.requested_at,decidedBy:row.decided_by,decidedAt:row.decided_at,decisionReason:row.decision_reason}));
  unlockPolicy={eligibleCustomerApprovers:0,selfUnlockAllowed:ctx.membership?.role==='admin',adminSelfUnlockAllowed:ctx.membership?.role==='admin'};
  selectedEntry=entries.find(e=>e.id===selectedEntry?.id)||sortedJournalEntries()[0]||null;
  await loadOpeningBalance();
  return true;
}
async function loadApi(){monthCoverage=null;unmatchedBankEvidence=null;const s=await api('/session');if(!s.authenticated){location.href='./index.html';return false}session=s;const entryData=await api('/accounting/entries');entries=entryData.entries||[];const detailed=[];for(const entry of entries.slice(0,200)){try{detailed.push((await api(`/accounting/entries/${encodeURIComponent(entry.id)}`)).entry)}catch{detailed.push(entry)}}entries=detailed;selectedEntry=sortedJournalEntries()[0]||null;periods=(await api('/accounting/periods')).periods||[];const unlockData=await api('/accounting/unlock-requests?status=all');unlockRequests=unlockData.requests||[];unlockPolicy=unlockData.unlockPolicy||{eligibleCustomerApprovers:0,selfUnlockAllowed:false,adminSelfUnlockAllowed:false};session.role=s.role||session.role||'';await loadOpeningBalance();return true}
function setError(form,message){const el=form.querySelector('.form-error');if(el)el.textContent=message||''}
function bindJournalControls(){
  // Keep selected debit/credit details ahead of the scrollable list in DOM and reading order.
  const journalList=document.querySelector(".journal-list");
  const journalDetail=document.querySelector(".accounting-grid > .panel:first-child > .entry-detail");
  if(journalList&&journalDetail&&journalList.parentNode===journalDetail.parentNode)journalList.before(journalDetail);

  // Rebuild only the journal list, not other forms or month-close controls.
  function updateJournalList({focusSearch=false,caret=0,scrollTop=0}={}){
    const existing=document.querySelector(".journal-list");
    if(!existing)return;
    existing.outerHTML=entryTable();
    bindJournalControls();
    const updated=document.getElementById("journal-scroll-region");
    if(updated)updated.scrollTop=scrollTop;
    if(focusSearch){
      const field=document.getElementById("journal-search-field");
      if(field){
        field.focus({preventScroll:true});
        if(typeof field.setSelectionRange==="function")field.setSelectionRange(caret,caret);
      }
    }
  }

  document.querySelector("#journal-search-field")?.addEventListener("input",event=>{
    const field=event.currentTarget;
    const caret=field.selectionStart??field.value.length;
    journalQuery=String(field.value||"").slice(0,100);
    journalSuggestionsOpen=Boolean(journalQuery.trim());
    journalSuggestionIndex=-1;
    updateJournalList({focusSearch:true,caret:Math.min(caret,journalQuery.length)});
  });
  document.querySelector('[data-action="clear-journal-search"]')?.addEventListener("click",()=>{
    journalQuery="";
    journalSuggestionsOpen=false;
    journalSuggestionIndex=-1;
    updateJournalList({focusSearch:true});
  });

  // A normal, interactive suggestion list: arrow keys choose and Enter opens the chosen journal.
  document.querySelector("#journal-search-field")?.addEventListener("keydown",event=>{
    const rows=journalQuery.trim()?filteredJournalEntries().slice(0,5):[];
    const key=event.key;
    if((key==="ArrowDown"||key==="ArrowUp")&&rows.length){
      event.preventDefault();
      journalSuggestionsOpen=true;
      const step=key==="ArrowDown"?1:-1;
      journalSuggestionIndex=journalSuggestionIndex<0?(step>0?0:rows.length-1):(journalSuggestionIndex+step+rows.length)%rows.length;
      const caret=event.currentTarget.selectionStart??event.currentTarget.value.length;
      updateJournalList({focusSearch:true,caret});
    }else if(key==="Enter"&&journalSuggestionsOpen&&journalSuggestionIndex>=0&&rows[journalSuggestionIndex]){
      event.preventDefault();
      selectedEntry=rows[journalSuggestionIndex];
      journalSuggestionsOpen=false;
      journalSuggestionIndex=-1;
      render();
    }else if(key==="Escape"&&journalSuggestionsOpen){
      event.preventDefault();
      journalSuggestionsOpen=false;
      journalSuggestionIndex=-1;
      updateJournalList({focusSearch:true,caret:event.currentTarget.selectionStart??0});
    }
  });
  document.querySelectorAll("[data-journal-suggestion]").forEach(button=>button.addEventListener("click",()=>{
    const entry=entries.find(item=>String(item.id)===button.dataset.journalSuggestion);
    if(!entry)return;
    selectedEntry=entry;
    journalSuggestionsOpen=false;
    journalSuggestionIndex=-1;
    render();
  }));

  function selectJournalRow(row,keyboard=false){
    const scroll=document.getElementById("journal-scroll-region");
    const scrollTop=scroll?.scrollTop||0;
    selectedEntry=entries.find(e=>String(e.id)===row.dataset.entry)||null;
    journalSuggestionsOpen=false;
    journalSuggestionIndex=-1;
    render();
    const updated=document.getElementById("journal-scroll-region");
    if(updated)updated.scrollTop=scrollTop;
    if(keyboard)for(const next of document.querySelectorAll("[data-entry]")){
      if(next.dataset.entry===row.dataset.entry){next.focus({preventScroll:true});break}
    }
  }
  document.querySelectorAll("[data-entry]").forEach(row=>{
    row.addEventListener("click",()=>selectJournalRow(row));
    row.addEventListener("keydown",event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();selectJournalRow(row,true)}
    });
  });
  document.querySelector('[data-action="toggle-journals"]')?.addEventListener("click",()=>{
    const previous=document.getElementById("journal-scroll-region");
    const scrollTop=previous?.scrollTop||0;
    journalExpanded=!journalExpanded;
    updateJournalList({scrollTop});
    document.querySelector('[data-action="toggle-journals"]')?.focus({preventScroll:true});
  });
}
function bind(){
  bindJournalControls();

  document.querySelector('[data-action="lock-current"]')?.addEventListener('click',async()=>{
    const period=currentPeriod();
    try{
      const confirmed=await window.LTStudioDialog.confirm({
        title:'Kontrollera månaden före låsning',
        message:'Har du själv granskat bank, oplacerade betalningar, fakturor, PDF-underlag, buntar, rapporter och moms? Checklistan i bokföringsvyn gör inte dessa kontroller automatiskt. Ett periodlås innebär inte att bokföringen är avstämd.',
        confirmLabel:'Jag har kontrollerat – lås perioden',
        cancelLabel:'Avbryt',
        tone:'warning'
      });
      if(!confirmed)return;
      if(isDemo){
        Demo.patch(state=>{
          const existing=state.accountingPeriods.find(p=>p.period===period);
          if(existing){existing.status='locked';existing.lockedAt=new Date().toISOString();existing.lockedBy='demo-user'}
          else state.accountingPeriods.push({period,status:'locked',lockedBy:'demo-user',lockedAt:new Date().toISOString()});
        });
        syncDemo();return render();
      }
      if(isSupabase){const ctx=await window.LTSupabaseUat.context();await window.LTSupabase.rpc('lock_accounting_period',{p_company_id:ctx.company.id,p_period:period},ctx.accessToken);await loadSupabaseAccounting();render();return}
      await api(`/accounting/periods/${period}/lock`,{method:'POST'});
      await loadApi();render();
    }catch(e){await window.LTStudioDialog.alert({title:'Kunde inte låsa perioden',message:e.message,tone:'danger'})}
  });

  document.getElementById('unlock-form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget,reason=String(new FormData(form).get('reason')||'');
    try{
      if(isDemo){
        Demo.patch(state=>state.accountingUnlockRequests.push({id:`u-${Date.now()}`,period:currentPeriod(),reason,status:'pending',requestedBy:'demo-user',requestedAt:new Date().toISOString()}));
        syncDemo();return render();
      }
      if(isSupabase){const ctx=await window.LTSupabaseUat.context();const created=(await window.LTSupabase.rpc('request_accounting_period_unlock',{p_company_id:ctx.company.id,p_period:currentPeriod(),p_reason:reason},ctx.accessToken))?.[0];if(ctx.membership?.role==='admin'&&created?.request_id){await window.LTSupabase.rpc('decide_accounting_period_unlock',{p_company_id:ctx.company.id,p_request_id:created.request_id,p_decision:'approved',p_reason:reason},ctx.accessToken)}await loadSupabaseAccounting();render();return}
      const created=await api(`/accounting/periods/${currentPeriod()}/unlock-request`,{method:'POST',body:{reason}});
      if(session?.role==='admin'&&created?.request?.id)await api(`/accounting/unlock-requests/${encodeURIComponent(created.request.id)}/approve`,{method:'POST',body:{reason}});
      await loadApi();render();
    }catch(e){setError(form,e.message)}
  });

  document.getElementById('correction-form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget,data=new FormData(form),original=selectedEntry;
    try{
      if(isDemo){
        const reversal={id:`demo-c-${Date.now()}`,number:`${original.number}R`,postingDate:String(data.get('postingDate')),description:`Motverifikation ${original.number} – ${String(data.get('reason'))}`,sourceType:'accounting-correction-reversal',sourceId:original.id,lines:original.lines.map(l=>({...l,debitOre:l.creditOre,creditOre:l.debitOre}))};
        Demo.patch(state=>state.accountingEntries.unshift(reversal));syncDemo(reversal.id);return render();
      }
      if(isSupabase){const ctx=await window.LTSupabaseUat.context();const result=(await window.LTSupabase.rpc('correct_manual_accounting_entry',{p_company_id:ctx.company.id,p_entry_id:original.id,p_posting_date:String(data.get('postingDate')),p_reason:String(data.get('reason')||''),p_replacement_lines:null},ctx.accessToken))?.[0];await loadSupabaseAccounting();selectedEntry=entries.find(entry=>entry.id===result?.reversal_entry_id)||entries[0]||null;render();return}
      await api(`/accounting/entries/${encodeURIComponent(original.id)}/correct`,{method:'POST',body:{postingDate:data.get('postingDate'),reason:data.get('reason')}});
      await loadApi();render();
    }catch(e){setError(form,e.message)}
  });

  document.querySelectorAll('[data-action="approve-unlock"]').forEach(button=>button.addEventListener('click',async()=>{
    if(isDemo){
      Demo.patch(state=>{
        const request=state.accountingUnlockRequests.find(r=>r.id===button.dataset.id);
        if(request){
          request.status='approved';
          const period=state.accountingPeriods.find(p=>p.period===request.period);
          if(period){period.status='open';period.lockedAt=null;period.lockedBy=null}
        }
      });
      syncDemo();return render();
    }
    const reason=await window.LTStudioDialog.prompt({title:'Godkänn upplåsning',message:'Ange beslutsorsak för upplåsningen.',confirmLabel:'Godkänn upplåsning',input:{label:'Beslutsorsak',value:'Kontrollerad upplåsning efter granskning.',maxLength:500}});
    if(reason===null)return;
    try{if(isSupabase){const ctx=await window.LTSupabaseUat.context();await window.LTSupabase.rpc('decide_accounting_period_unlock',{p_company_id:ctx.company.id,p_request_id:button.dataset.id,p_decision:'approved',p_reason:reason},ctx.accessToken);await loadSupabaseAccounting();render();return}await api(`/accounting/unlock-requests/${encodeURIComponent(button.dataset.id)}/approve`,{method:'POST',body:{reason}});await loadApi();render()}catch(e){await window.LTStudioDialog.alert({title:'Kunde inte godkänna upplåsningen',message:e.message,tone:'danger'})}
  }));
  document.querySelectorAll('[data-action="reject-unlock"]').forEach(button=>button.addEventListener('click',async()=>{
    const reason=await window.LTStudioDialog.prompt({title:'Avslå upplåsning',message:'Ange varför upplåsningsbegäran avslås.',confirmLabel:'Avslå begäran',tone:'danger',input:{label:'Beslutsorsak',value:'',maxLength:500}});
    if(reason===null)return;
    try{if(isSupabase){const ctx=await window.LTSupabaseUat.context();await window.LTSupabase.rpc('decide_accounting_period_unlock',{p_company_id:ctx.company.id,p_request_id:button.dataset.id,p_decision:'rejected',p_reason:reason},ctx.accessToken);await loadSupabaseAccounting();render();return}await api(`/accounting/unlock-requests/${encodeURIComponent(button.dataset.id)}/reject`,{method:'POST',body:{reason}});await loadApi();render()}catch(e){await window.LTStudioDialog.alert({title:'Kunde inte avslå upplåsningen',message:e.message,tone:'danger'})}
  }));
  document.querySelectorAll('.self-unlock-form').forEach(form=>form.addEventListener('submit',async event=>{
    event.preventDefault();
    setError(form,'');
    const data=new FormData(form);
    try{
      await api(`/accounting/unlock-requests/${encodeURIComponent(form.dataset.id)}/approve`,{method:'POST',body:{reason:String(data.get('reason')||''),password:String(data.get('password')||''),totp:String(data.get('totp')||'')}});
      await loadApi();render();
    }catch(e){setError(form,e.message)}
  }));

  document.getElementById('opening-year-form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const year=String(new FormData(form).get('year')||'').trim();
    if(!/^(19|20|21)\d{2}$/.test(year)){setError(form,'Året måste anges med fyra siffror.');return}
    openingYear=year;openingMessage='';
    try{await loadOpeningBalance();render()}catch(e){openingMessage=e.message;render()}
  });

  document.querySelector('[data-action="add-opening-line"]')?.addEventListener('click',()=>{
    const container=document.getElementById('opening-lines');
    if(!container)return;
    container.insertAdjacentHTML('beforeend',openingLineRow(container.querySelectorAll('.opening-line-row').length));
    bindOpeningRemoveButtons();
  });

  function bindOpeningRemoveButtons(){
    document.querySelectorAll('.opening-remove').forEach(button=>{
      button.onclick=()=>{
        const rows=document.querySelectorAll('.opening-line-row');
        if(rows.length<=2){const form=document.getElementById('opening-balance-form');if(form)setError(form,'Ingående balans måste innehålla minst två rader.');return}
        button.closest('.opening-line-row')?.remove();
      };
    });
  }
  bindOpeningRemoveButtons();

  document.getElementById('opening-balance-form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    setError(form,'');
    try{
      const rows=[...form.querySelectorAll('.opening-line-row')];
      if(rows.length<2)throw new Error('Ingående balans måste innehålla minst två rader.');
      const lines=rows.map((row,index)=>{
        const account=String(row.querySelector('[data-opening="account"]')?.value||'').trim();
        const text=String(row.querySelector('[data-opening="text"]')?.value||'').trim();
        const debitOre=amountToOre(row.querySelector('[data-opening="debit"]')?.value);
        const creditOre=amountToOre(row.querySelector('[data-opening="credit"]')?.value);
        if(!/^[12]\d{3}$/.test(account))throw new Error(`Rad ${index+1}: konto måste vara ett balanskonto i klass 1–2.`);
        if(account==='1510'||account==='2440')throw new Error(`Rad ${index+1}: konto ${account} kräver reskontraunderlag och kan inte importeras här.`);
        if((debitOre>0)===(creditOre>0))throw new Error(`Rad ${index+1}: ange belopp i antingen debet eller kredit.`);
        return{account,text,debitOre,creditOre};
      });
      const debit=lines.reduce((sum,line)=>sum+line.debitOre,0);
      const credit=lines.reduce((sum,line)=>sum+line.creditOre,0);
      if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||debit<=0||debit!==credit)throw new Error(`Debet och kredit måste balansera exakt. Debet ${ore(debit)}, kredit ${ore(credit)}.`);
      if(isSupabase){const ctx=await window.LTSupabaseUat.context();const result=(await window.LTSupabase.rpc('import_opening_balance',{p_company_id:ctx.company.id,p_year:openingYear,p_posting_date:`${openingYear}-01-01`,p_lines:lines},ctx.accessToken))?.[0];openingMessage=result?.journal_number?.startsWith('BUNT-')?`Ingående balans väntar i ${result.journal_number}.`:'';await loadSupabaseAccounting();render();return}
      await api(`/accounting/opening-balances/${encodeURIComponent(openingYear)}`,{method:'POST',body:{postingDate:`${openingYear}-01-01`,lines}});
      openingMessage='';
      await loadApi();
      render();
    }catch(e){setError(form,e.message)}
  });
}
async function ensureDemoScenario(){
  if(!isDemo||Demo)return;
  await new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='./demo-scenario.js';
    script.onload=()=>{Demo=globalThis.RollandsDemoScenario;resolve()};
    script.onerror=()=>reject(new Error('Det gemensamma demoscenariot kunde inte laddas.'));
    document.head.appendChild(script);
  });
}
function monitorMonthCoverage(){
  // Reload is explicit: do not write anything or silently mark the month reconciled.
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-action="refresh-month-coverage"]'))location.reload();
  });
  if(!isSupabase)return;
  const updateAge=()=>{
    const guide=globalThis.LTMonthCloseGuide;
    const state={companyId:session?.company?.id||null,coverage:monthCoverage,
      unmatchedBankEvidence};
    const node=document.querySelector('.month-close-coverage');
    if(node&&monthCoverage&&!node.classList.contains('month-close-coverage-unknown')
      &&guide?.evaluateCoverage?.(state,currentPeriod()).status==='unavailable'){
      node.outerHTML=guide.renderCoverage(state,currentPeriod());
    }
    // Update only the warning: never replace search input or any accounting drafts.
    const warning=document.querySelector('.journal-coverage-warning');
    const replacement=journalSearchCoverage();
    if(warning&&replacement!==warning.outerHTML)warning.outerHTML=replacement;
    else if(!warning&&replacement){
      document.querySelector('.journal-search')?.insertAdjacentHTML('beforeend',replacement);
    }
    const bankNode=document.querySelector('.month-close-bank-review');
    if(bankNode&&guide?.renderBankReview){
      const fresh=guide.renderBankReview(state);
      if(bankNode.outerHTML!==fresh)bankNode.outerHTML=fresh;
    }
  };
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateAge()});
  setInterval(updateAge,30000);
}
async function init(){monitorMonthCoverage();if(isDemo){await ensureDemoScenario();if(!Demo)throw new Error('Det gemensamma demoscenariot kunde inte laddas.');session={user:{displayName:'Demoanvändare'},company:{name:'Rollands Frukt o Grönt AB'}};syncDemo();return render()}if(isSupabase){if(await loadSupabaseAccounting())render();return}if(await loadApi())render()}
init().catch(error=>{app.innerHTML=`<main class="boot"><strong>Bokföringen kunde inte laddas</strong><span>${esc(error.message)}</span></main>`});
