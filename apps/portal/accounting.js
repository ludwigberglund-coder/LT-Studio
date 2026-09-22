const app=document.getElementById('accounting-app');
const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
let Demo=globalThis.RollandsDemoScenario;
let session=null,entries=[],periods=[],unlockRequests=[],unlockPolicy={eligibleCustomerApprovers:0,selfUnlockAllowed:false},selectedEntry=null,openingYear=today().slice(0,4),openingBalance=null,openingMessage='';
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
function sidebar(){return `<aside class="sidebar"><div class="logo"><strong>${esc(isDemo?'Rollands':session?.company?.name||'Företaget')}</strong><small>LT STUDIO</small></div><div class="company-pill">${esc(session?.company?.name||(isDemo?'Rollands Frukt o Grönt AB':'Företaget'))}<br>${isDemo?'Demoföretag':'Skyddad företagsmiljö'}</div><div class="side-group"><span>Arbetsyta</span><a class="side-link" href="${url('./dashboard.html')}">Översikt</a></div><div class="side-group"><span>Ekonomi</span><a class="side-link" href="${url('./payables.html')}">Leverantörsfakturor</a><a class="side-link active" href="${url('./accounting.html')}">Bokföring</a><a class="side-link" href="${url('./reports.html')}">Rapporter</a><a class="side-link" href="${url('./documents.html')}">Dokument</a></div><div class="sidebar-footer">${isDemo?'Gemensamt UAT-scenario · ingen skarp bokföring':'Personlig session · servervaliderad behörighet'}</div></aside>`}
function statusLabel(status){return status==='locked'?'Låst':status==='pending'?'Väntar beslut':status==='approved'?'Godkänd':status==='rejected'?'Avslagen':'Öppen'}
function entryTotal(entry){return (entry.lines||[]).reduce((sum,line)=>sum+Number(line.debitOre||0),0)}
function syncDemo(selectedId){const state=Demo.state();entries=structuredClone(state.accountingEntries);periods=structuredClone(state.accountingPeriods);unlockRequests=structuredClone(state.accountingUnlockRequests);selectedEntry=entries.find(e=>e.id===(selectedId||selectedEntry?.id))||entries[0]||null}
function openingBalancePanel(){
  if(isDemo)return `<article class="panel opening-panel"><span class="eyebrow">Ingående balans</span><h2>Startsaldo vid systembyte</h2><p>Import av ingående balans är avstängd i den publika demon och används bara i den skyddade företagsmiljön.</p><div class="notice-box">Kundfordringar och leverantörsskulder importeras inte som totalsummor. De måste senare tas in tillsammans med sina öppna fakturor.</div></article>`;
  const selector=`<form class="opening-year-form" id="opening-year-form"><label>Räkenskapsår<input name="year" type="number" min="1900" max="2199" value="${esc(openingYear)}" required></label><button class="button ghost" type="submit">Visa år</button><p class="form-error"></p></form>`;
  if(openingBalance){
    return `<article class="panel opening-panel"><div class="section-head"><div><span class="eyebrow">Ingående balans</span><h2>${esc(openingBalance.number)} · ${esc(openingYear)}</h2><p>Importerad ${esc(openingBalance.postingDate)}. Originalet bevaras som en särskild IB-verifikation.</p></div>${selector}</div>
      <div class="entry-lines">${(openingBalance.lines||[]).map(line=>`<div class="entry-line"><b>${esc(line.account)}</b><span>${esc(line.text||'')}</span><span class="money">Debet ${line.debitOre?ore(line.debitOre):'—'}</span><span class="money">Kredit ${line.creditOre?ore(line.creditOre):'—'}</span></div>`).join('')}</div>
      <div class="notice-box warning">1510 Kundfordringar och 2440 Leverantörsskulder måste importeras tillsammans med öppna reskontraposter och ingår därför inte i denna totalsaldoimport.</div>
    </article>`;
  }
  return `<article class="panel opening-panel"><div class="section-head"><div><span class="eyebrow">Ingående balans</span><h2>Importera startsaldo</h2><p>För vanliga balanskonton när ett företag börjar använda LT Studio.</p></div>${selector}</div>
    ${openingMessage?`<div class="notice-box warning">${esc(openingMessage)}</div>`:''}
    <div class="notice-box warning"><b>Viktigt:</b> 1510 och 2440 är blockerade här. Öppna kund- och leverantörsfakturor måste importeras tillsammans med reskontran.</div>
    <form class="accounting-form" id="opening-balance-form">
      <div class="opening-meta"><label>Bokföringsdatum<input value="${esc(openingYear)}-01-01" disabled></label><span>Importen måste göras innan andra verifikationer finns i året.</span></div>
      <div class="opening-lines" id="opening-lines">${openingLineRow(0)}${openingLineRow(1)}</div>
      <label class="opening-confirm"><input type="checkbox" name="confirm" required> Jag har kontrollerat underlaget och att debet och kredit balanserar. Importen skapar en spårbar IB-verifikation.</label>
      <div class="toolbar"><button class="button ghost" data-action="add-opening-line" type="button">Lägg till rad</button><button class="button" type="submit">Importera ingående balans</button></div>
      <p class="form-error"></p>
    </form>
  </article>`;
}
async function loadOpeningBalance(){
  if(isDemo){openingBalance=null;return}
  try{openingBalance=(await api(`/accounting/opening-balances/${encodeURIComponent(openingYear)}`)).entry;openingMessage=''}
  catch(error){
    if(error.code==='OPENING_BALANCE_NOT_FOUND'){openingBalance=null;return}
    throw error;
  }
}
function render(){const current=periods.find(p=>p.period===currentPeriod())||{period:currentPeriod(),status:'open'};app.innerHTML=`<div class="accounting-shell">${sidebar()}<section class="accounting-main"><header class="topbar"><div><h1>Bokföring & perioder</h1><p>Verifikationer bevaras. Rättelser sker med nya spårbara poster.</p></div><div class="user-chip"><b>${esc(session?.user?.displayName||'Demoanvändare')}</b></div></header><main class="accounting-content">${isDemo?'<div class="demo-banner"><b>Gemensamt UAT-scenario.</b> Här visas även verifikationer som skapas av andra demoflöden, till exempel bekräftade leverantörsbetalningar.</div>':''}<section class="accounting-grid"><article class="panel"><span class="eyebrow">Verifikationer</span><h2>Bokförda poster</h2><p>Klicka på en rad för att se exakt konto, debet och kredit.</p>${entryTable()}${entryDetail()}</article><article class="panel"><span class="eyebrow">Periodkontroll</span><h2>${esc(current.period)} · <span class="status-pill ${current.status==='locked'?'locked':''}">${statusLabel(current.status)}</span></h2><p>En låst period kan inte ta emot nya verifikationer. Upplåsning kräver separat beslut.</p>${periodControls(current)}${periodList()}${unlockList()}</article></section>${openingBalancePanel()}</main></section></div>`;bind()}
function entryTable(){return `<div class="accounting-table-scroll"><table class="accounting-table"><thead><tr><th>Nr</th><th>Datum</th><th>Text</th><th>Källa</th><th class="money">Belopp</th></tr></thead><tbody>${entries.map(e=>`<tr data-entry="${esc(e.id)}"><td><b>${esc(e.number)}</b></td><td>${esc(e.postingDate)}</td><td>${esc(e.description)}</td><td>${esc(e.sourceType)}</td><td class="money">${ore(entryTotal(e))}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-state">Inga verifikationer ännu.</td></tr>'}</tbody></table></div>`}
function entryDetail(){if(!selectedEntry)return'';const opening=selectedEntry.sourceType==='opening-balance';return `<div class="entry-detail"><div class="section-head"><div><span class="eyebrow">${esc(selectedEntry.number)}</span><h2>${esc(selectedEntry.description)}</h2></div></div><div class="entry-lines">${(selectedEntry.lines||[]).map(line=>`<div class="entry-line"><b>${esc(line.account)}</b><span>${esc(line.text||'')}</span><span class="money">Debet ${line.debitOre?ore(line.debitOre):'—'}</span><span class="money">Kredit ${line.creditOre?ore(line.creditOre):'—'}</span></div>`).join('')}</div>${opening?'<div class="notice-box warning">Ingående balans rättas inte genom det generella rättelseflödet. Granska migreringsunderlaget och använd ett särskilt dokumenterat migrations-/rättelseflöde.</div>':`<div class="notice-box">Originalverifikationen ändras aldrig. En rättelse skapar en ny motverifikation med omvänd debet/kredit.</div><form class="accounting-form" id="correction-form"><label>Rättelsedatum<input name="postingDate" type="date" value="${today()}" required></label><label>Orsak<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><button class="button" type="submit">Skapa motverifikation</button><p class="form-error"></p></form>`}</div>`}
function periodControls(current){if(current.status==='locked')return `<form class="accounting-form" id="unlock-form"><label>Orsak till upplåsning<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><button class="button" type="submit">Begär upplåsning</button><p class="form-error"></p></form>`;return `<div class="toolbar"><button class="button" data-action="lock-current" type="button">Lås ${esc(current.period)}</button></div>`}
function periodList(){return `<div class="period-list">${periods.map(p=>`<div class="period-row"><div><b>${esc(p.period)}</b><br><small>${p.lockedAt?`Låst ${esc(String(p.lockedAt).slice(0,10))}`:'Öppen för bokföring'}</small></div><span class="status-pill ${p.status==='locked'?'locked':''}">${statusLabel(p.status)}</span><span></span></div>`).join('')}</div>`}
function unlockList(){
  const pending=unlockRequests.filter(r=>r.status==='pending');
  const permissions=new Set(session?.permissions||[]);
  return `<div class="entry-detail"><span class="eyebrow">Upplåsningskö</span><h2>Väntande beslut</h2>${pending.map(r=>{
    if(isDemo)return `<div class="period-row"><div><b>${esc(r.period)}</b><br><small>${esc(r.reason)}</small></div><span class="status-pill pending">Väntar beslut</span><button class="button ghost small" type="button" data-action="approve-unlock" data-id="${esc(r.id)}">Godkänn demo</button></div>`;
    const ownRequest=r.requestedBy===session?.user?.id;
    const canDecide=permissions.has('period.unlock');
    if(ownRequest&&unlockPolicy.selfUnlockAllowed&&canDecide){
      return `<div class="period-row unlock-self-row"><div><b>${esc(r.period)}</b><br><small>${esc(r.reason)}</small><div class="notice-box warning"><b>Ensam behörig användare.</b> Du kan låsa upp själv efter ny verifiering med lösenord och MFA. Åtgärden loggas särskilt.</div><form class="accounting-form self-unlock-form" data-id="${esc(r.id)}"><label>Beslutsorsak<textarea name="reason" minlength="5" maxlength="500" required>Kontrollerad självupplåsning för fortsatt bokföringsarbete.</textarea></label><label>Lösenord<input name="password" type="password" autocomplete="current-password" required></label><label>Aktuell MFA-kod<input name="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="button" type="submit">Verifiera och lås upp</button><p class="form-error"></p></form></div><span class="status-pill pending">Väntar beslut</span></div>`;
    }
    if(ownRequest)return `<div class="period-row"><div><b>${esc(r.period)}</b><br><small>${esc(r.reason)}</small><br><small>En annan behörig användare hos företaget måste fatta beslutet.</small></div><span class="status-pill pending">Väntar beslut</span><span></span></div>`;
    if(canDecide)return `<div class="period-row"><div><b>${esc(r.period)}</b><br><small>${esc(r.reason)}</small></div><span class="status-pill pending">Väntar beslut</span><div class="toolbar"><button class="button small" type="button" data-action="approve-unlock" data-id="${esc(r.id)}">Godkänn upplåsning</button><button class="button ghost small" type="button" data-action="reject-unlock" data-id="${esc(r.id)}">Avslå</button></div></div>`;
    return `<div class="period-row"><div><b>${esc(r.period)}</b><br><small>${esc(r.reason)}</small><br><small>Du saknar behörighet att fatta beslut om upplåsning.</small></div><span class="status-pill pending">Väntar beslut</span><span></span></div>`;
  }).join('')||'<p class="empty-state">Ingen väntande begäran.</p>'}</div>`;
}
async function loadApi(){const s=await api('/session');if(!s.authenticated){location.href='./index.html';return false}session=s;const entryData=await api('/accounting/entries');entries=entryData.entries||[];const detailed=[];for(const entry of entries.slice(0,200)){try{detailed.push((await api(`/accounting/entries/${encodeURIComponent(entry.id)}`)).entry)}catch{detailed.push(entry)}}entries=detailed;selectedEntry=entries[0]||null;periods=(await api('/accounting/periods')).periods||[];const unlockData=await api('/accounting/unlock-requests?status=all');unlockRequests=unlockData.requests||[];unlockPolicy=unlockData.unlockPolicy||{eligibleCustomerApprovers:0,selfUnlockAllowed:false};await loadOpeningBalance();return true}
function setError(form,message){const el=form.querySelector('.form-error');if(el)el.textContent=message||''}
function bind(){
  document.querySelectorAll('[data-entry]').forEach(row=>row.addEventListener('click',()=>{
    selectedEntry=entries.find(e=>e.id===row.dataset.entry)||null;
    render();
  }));

  document.querySelector('[data-action="lock-current"]')?.addEventListener('click',async()=>{
    const period=currentPeriod();
    try{
      if(isDemo){
        Demo.patch(state=>{
          const existing=state.accountingPeriods.find(p=>p.period===period);
          if(existing){existing.status='locked';existing.lockedAt=new Date().toISOString();existing.lockedBy='demo-user'}
          else state.accountingPeriods.push({period,status:'locked',lockedBy:'demo-user',lockedAt:new Date().toISOString()});
        });
        syncDemo();return render();
      }
      await api(`/accounting/periods/${period}/lock`,{method:'POST'});
      await loadApi();render();
    }catch(e){alert(e.message)}
  });

  document.getElementById('unlock-form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget,reason=String(new FormData(form).get('reason')||'');
    try{
      if(isDemo){
        Demo.patch(state=>state.accountingUnlockRequests.push({id:`u-${Date.now()}`,period:currentPeriod(),reason,status:'pending',requestedBy:'demo-user',requestedAt:new Date().toISOString()}));
        syncDemo();return render();
      }
      await api(`/accounting/periods/${currentPeriod()}/unlock-request`,{method:'POST',body:{reason}});
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
    const reason=window.prompt('Beslutsorsak för upplåsningen:','Kontrollerad upplåsning efter granskning.');
    if(reason===null)return;
    try{await api(`/accounting/unlock-requests/${encodeURIComponent(button.dataset.id)}/approve`,{method:'POST',body:{reason}});await loadApi();render()}catch(e){alert(e.message)}
  }));
  document.querySelectorAll('[data-action="reject-unlock"]').forEach(button=>button.addEventListener('click',async()=>{
    const reason=window.prompt('Ange varför upplåsningsbegäran avslås:','');
    if(reason===null)return;
    try{await api(`/accounting/unlock-requests/${encodeURIComponent(button.dataset.id)}/reject`,{method:'POST',body:{reason}});await loadApi();render()}catch(e){alert(e.message)}
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
async function init(){if(isDemo){await ensureDemoScenario();if(!Demo)throw new Error('Det gemensamma demoscenariot kunde inte laddas.');session={user:{displayName:'Demoanvändare'},company:{name:'Rollands Frukt o Grönt AB'}};syncDemo();return render()}if(await loadApi())render()}
init().catch(error=>{app.innerHTML=`<main class="boot"><strong>Bokföringen kunde inte laddas</strong><span>${esc(error.message)}</span></main>`});
