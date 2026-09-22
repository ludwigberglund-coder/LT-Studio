const root=document.getElementById('operator-app');
const csrfKey='lt-operator-csrf';
let session=null,overview=null,readiness=null,security=null,errorMessage='',view='overview',selectedCompany=null;

function esc(value=''){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function initials(name='LT'){return String(name).trim().split(/\s+/).filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase()||'LT'}
function dateTime(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short'}).format(d)}
function roleLabel(role){return({admin:'Admin',accountant:'Ekonom',approver:'Attestant',readonly:'Läsbehörighet'})[role]||role}
async function api(path,options={}){
  const headers={Accept:'application/json',...(options.headers||{})};
  const response=await fetch('/api/operator/v1'+path,{credentials:'same-origin',...options,headers});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const e=new Error(data.error||'Begäran misslyckades.');e.code=data.code;e.status=response.status;e.data=data;throw e}
  return data;
}
function csrf(){return sessionStorage.getItem(csrfKey)||''}
function loginView(){
  root.innerHTML=`<section class="login-shell">
    <div class="login-brand"><div class="mark"><span class="mark-icon"></span><span>LT STUDIO</span></div><div><h1>Adminportal för hela plattformen.</h1><p>Här hanterar LT Studio kundföretag, användare, behörigheter, statistik och drift. Kundernas användare har aldrig tillgång till denna portal.</p></div><small>Separat LT Studio-inloggning · MFA · spårbar administratörslogg</small></div>
    <div class="login-panel"><form class="card" id="login-form"><h2>LT Studio-inloggning</h2><p>Logga in med ert separata operatörskonto.</p>
      <label class="field"><span>Användarnamn</span><input name="username" autocomplete="username" required></label>
      <label class="field"><span>Lösenord</span><input name="password" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>MFA-kod</span><input name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
      <button class="button" type="submit">Logga in</button>
      ${errorMessage?`<div class="error">${esc(errorMessage)}</div>`:''}
    </form></div>
  </section>`;
}
function readinessState(){if(!readiness)return{label:'Laddar',kind:'warning'};return readiness.ok?{label:'OK',kind:'ok'}:{label:'Varning',kind:'critical'}}
function securityState(){const critical=Number(overview?.security?.critical||0),warning=Number(overview?.security?.warning||0);if(critical)return{label:`${critical} kritiska`,kind:'critical'};if(warning)return{label:`${warning} varningar`,kind:'warning'};return{label:'Ingen aktiv varning',kind:'ok'}}
function nav(){
  const items=[['overview','Översikt'],['companies','Kunder & företag'],['statistics','Statistik'],['security','Säkerhetsportal']];
  return items.map(([id,label])=>`<button class="${view===id?'active':''}" data-view="${id}">${label}${id==='security'?'<span class="nav-badge">nästa</span>':''}</button>`).join('');
}
function shell(body,title,subtitle){
  const operator=session?.operator||{};
  root.innerHTML=`<div class="operator-shell"><aside class="sidebar"><div class="mark"><span class="mark-icon"></span><span>LT STUDIO</span></div><div class="side-copy">Central adminportal för alla kundföretag.</div><nav class="side-nav">${nav()}</nav><div class="side-footer">Endast LT Studio-operatörer. Alla ändringar loggas.</div></aside>
  <section class="main"><header class="topbar"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions"><div class="operator-user"><span class="avatar">${initials(operator.displayName)}</span><div><strong>${esc(operator.displayName||operator.username||'Operatör')}</strong><small>LT Studio-operatör</small></div></div><button class="button secondary" data-action="logout">Logga ut</button></div></header>
  ${errorMessage?`<div class="notice">${esc(errorMessage)}</div>`:''}${body}</section></div>`;
}
function companyRows(){
  const rows=overview?.companies||[];
  if(!rows.length)return '<tr><td colspan="7" class="empty">Inga företag är registrerade ännu.</td></tr>';
  return rows.map(company=>{
    const access=company.accessConfigured?'<span class="status-pill"><span class="dot ok"></span>Konfigurerad</span>':'<span class="status-pill"><span class="dot warning"></span>Saknar användare</span>';
    return `<tr class="click-row" data-company-id="${esc(company.id)}"><td><strong>${esc(company.displayName)}</strong><br><small>${esc(company.legalName)}</small></td><td>${esc(company.orgNumber||'—')}</td><td>${company.memberCount}</td><td>${access}</td><td>${company.activeSessionCount}</td><td>${company.invoiceRecordCount}</td><td>${dateTime(company.lastActivityAt)}</td></tr>`;
  }).join('');
}
function readinessChecks(){
  const checks=readiness?.checks&&typeof readiness.checks==='object'?readiness.checks:{};
  return [['databaseRead','Databas · läsning'],['databaseWrite','Databas · skrivning'],['backup','Lokal backup'],['offsiteBackup','Extern backup'],['r2StagingAudit','R2 · privata objekt'],['restoreDrill','Restore-test'],['auditAnchor','Audit · externt ankare'],['monitoring','Extern monitoring']].map(([key,label])=>{
    const ok=checks[key]===true,known=typeof checks[key]==='boolean',state=known?(ok?'OK':'Problem'):'Saknas',kind=known?(ok?'ok':'critical'):'warning';
    return `<div class="health-row"><strong>${esc(label)}</strong><span></span><span class="status-pill"><span class="dot ${kind}"></span>${state}</span></div>`;
  }).join('');
}
function securityEvents(){
  const events=security?.events||[];
  if(!events.length)return '<div class="empty">Inga säkerhetshändelser i listan.</div>';
  return events.map(event=>`<div class="event"><span class="status-pill"><span class="dot ${esc(event.severity)}"></span>${esc(({critical:'Kritisk',warning:'Varning',info:'Information'})[event.severity]||event.severity)}</span><strong>${esc(String(event.kind||'Säkerhetshändelse').replaceAll('_',' '))}</strong><time>${dateTime(event.createdAt)}</time></div>`).join('');
}
function overviewView(){
  const ready=readinessState(),sec=securityState();
  shell(`<section class="status-grid">
    <article class="metric"><span>Företag</span><strong>${overview?.companyCount??'—'}</strong><small>kundmiljöer</small></article>
    <article class="metric"><span>Aktiva sessioner</span><strong>${overview?.activeSessionCount??'—'}</strong><small>kundsessioner just nu</small></article>
    <article class="metric"><span>Readiness</span><strong class="${ready.kind}">${ready.label}</strong><small>drift, backup och återställning</small></article>
    <article class="metric"><span>Säkerhet 24 h</span><strong class="${sec.kind}">${sec.label}</strong><small>${overview?.security?.total??0} händelser totalt</small></article>
  </section>
  <section class="panel"><div class="panel-head"><div><h2>Kundföretag</h2><p>Klicka på ett företag för att öppna dess adminöversikt.</p></div><button class="button secondary" data-action="refresh">Uppdatera</button></div><div class="table-wrap"><table><thead><tr><th>Företag</th><th>Org.nr</th><th>Användare</th><th>Åtkomst</th><th>Sessioner</th><th>Fakturor</th><th>Senaste aktivitet</th></tr></thead><tbody>${companyRows()}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><div><h2>Hälsokontroller</h2><p>Teknisk status för plattformen.</p></div></div><div class="health-list">${readinessChecks()}</div></section>`,'Adminöversikt','Alla LT Studios kunder, användare, driftstatus och viktiga signaler.');
}
function companiesView(){
  shell(`<section class="panel"><div class="panel-head"><div><h2>Alla kunder & företag</h2><p>Öppna ett företag för användare, behörigheter och statistik.</p></div><button class="button secondary" data-action="refresh">Uppdatera</button></div><div class="table-wrap"><table><thead><tr><th>Företag</th><th>Org.nr</th><th>Användare</th><th>Åtkomst</th><th>Sessioner</th><th>Fakturor</th><th>Senaste aktivitet</th></tr></thead><tbody>${companyRows()}</tbody></table></div></section>`,'Kunder & företag','Central administration för varje kundmiljö.');
}
function statisticsView(){
  const companies=overview?.companies||[];
  const invoiceTotal=companies.reduce((sum,c)=>sum+Number(c.invoiceRecordCount||0),0);
  const customerTotal=companies.reduce((sum,c)=>sum+Number(c.customerRecordCount||0),0);
  const usersTotal=companies.reduce((sum,c)=>sum+Number(c.memberCount||0),0);
  shell(`<section class="status-grid"><article class="metric"><span>Kundföretag</span><strong>${companies.length}</strong><small>registrerade miljöer</small></article><article class="metric"><span>Användarmedlemskap</span><strong>${usersTotal}</strong><small>över alla företag</small></article><article class="metric"><span>Kundposter</span><strong>${customerTotal}</strong><small>i kundregistren</small></article><article class="metric"><span>Fakturaposter</span><strong>${invoiceTotal}</strong><small>över hela plattformen</small></article></section>
  <section class="panel"><div class="panel-head"><div><h2>Företagsstatistik</h2><p>Operativ metadata utan att visa fakturainnehåll eller annan ekonomisk detaljdata.</p></div></div><div class="table-wrap"><table><thead><tr><th>Företag</th><th>Användare</th><th>Kunder</th><th>Fakturor</th><th>Aktiva sessioner</th></tr></thead><tbody>${companies.map(c=>`<tr><td><strong>${esc(c.displayName)}</strong></td><td>${c.memberCount}</td><td>${c.customerRecordCount}</td><td>${c.invoiceRecordCount}</td><td>${c.activeSessionCount}</td></tr>`).join('')}</tbody></table></div></section>`,'Statistik','Nyckeltal som hjälper LT Studio att följa användning och kundmiljöer.');
}
function securityView(){
  shell(`<section class="panel callout-panel"><div><span class="eyebrow">Nästa etapp</span><h2>Säkerhetsportal</h2><p>Den fulla säkerhetsportalen byggs som nästa separata del. Här ska incidenter, inloggningsförsök, hälsokontroller, backup, R2, audit, övervakning och säkerhetsåtgärder samlas.</p></div></section>
  <section class="panel"><div class="panel-head"><div><h2>Nuvarande säkerhetshändelser</h2><p>Den befintliga read-only-vyn finns kvar tills säkerhetsportalen byggs färdigt.</p></div></div><div class="event-list">${securityEvents()}</div></section>`,'Säkerhetsportal','Planerad separat säkerhetsyta för LT Studio.');
}
function memberRows(detail){
  return (detail.members||[]).map(m=>`<tr><td><strong>${esc(m.displayName)}</strong><br><small>${esc(m.username)}</small></td><td><select data-role-user="${esc(m.userId)}">${['admin','accountant','approver','readonly'].map(r=>`<option value="${r}" ${m.role===r?'selected':''}>${roleLabel(r)}</option>`).join('')}</select></td><td>${m.disabled?'Inaktiv':'Aktiv'}</td><td><button class="button secondary small" data-action="reset-password" data-user-id="${esc(m.userId)}" data-user-name="${esc(m.displayName)}">Byt lösenord</button> <button class="button danger small" data-action="remove-user" data-user-id="${esc(m.userId)}" data-user-name="${esc(m.displayName)}">Ta bort</button></td></tr>`).join('')||'<tr><td colspan="4" class="empty">Inga användare i företaget.</td></tr>';
}
function companyDetailView(detail){
  selectedCompany=detail;
  const c=detail.company,s=detail.stats||{};
  shell(`<div class="detail-back"><button class="button secondary" data-action="back-companies">← Alla företag</button></div>
  <section class="detail-hero"><div><span class="eyebrow">Kundföretag</span><h2>${esc(c.displayName)}</h2><p>${esc(c.legalName)} · ${esc(c.orgNumber)}</p></div></section>
  <section class="status-grid"><article class="metric"><span>Användare</span><strong>${s.memberCount||0}</strong></article><article class="metric"><span>Aktiva sessioner</span><strong>${s.activeSessionCount||0}</strong></article><article class="metric"><span>Kunder</span><strong>${s.customerRecordCount||0}</strong></article><article class="metric"><span>Fakturor</span><strong>${s.invoiceRecordCount||0}</strong></article></section>
  <section class="panel"><div class="panel-head"><div><h2>Användare & behörigheter</h2><p>Endast LT Studio kan skapa, ändra eller ta bort användare.</p></div></div><div class="table-wrap"><table><thead><tr><th>Användare</th><th>Roll</th><th>Status</th><th>Åtgärder</th></tr></thead><tbody>${memberRows(detail)}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><div><h2>Lägg till användare</h2><p>Minst 8 tecken, stora och små bokstäver samt minst en siffra eller ett specialtecken. MFA skapas samtidigt.</p></div></div>
    <form id="add-user-form" class="form-grid compact-form">
      <label class="field"><span>Namn</span><input name="displayName" required maxlength="120"></label>
      <label class="field"><span>Användarnamn / e-post</span><input name="username" required maxlength="120"></label>
      <label class="field"><span>Tillfälligt lösenord</span><input name="password" type="password" required minlength="8"></label>
      <label class="field"><span>Behörighet</span><select name="role"><option value="admin">Admin</option><option value="accountant">Ekonom</option><option value="approver">Attestant</option><option value="readonly">Läsbehörighet</option></select></label>
      <div><button class="button" type="submit">Skapa användare</button></div>
    </form><div id="mfa-result"></div>
  </section>`,'Företagsadmin',`Inställningar och åtgärder för ${c.displayName}.`);
}
function render(){if(selectedCompany)return companyDetailView(selectedCompany);if(view==='companies')return companiesView();if(view==='statistics')return statisticsView();if(view==='security')return securityView();return overviewView()}
async function loadData(){
  const [o,r,s]=await Promise.all([api('/overview'),api('/readiness').catch(err=>err.data&&typeof err.data==='object'?err.data:{ok:false,error:err.message,checks:{}}),api('/security-events?limit=50')]);
  overview=o;readiness=r;security=s;
}
async function openCompany(id){errorMessage='';try{selectedCompany=await api('/companies/'+encodeURIComponent(id));render()}catch(error){errorMessage=error.message;selectedCompany=null;render()}}
async function refresh(){errorMessage='';try{await loadData();if(selectedCompany)selectedCompany=await api('/companies/'+encodeURIComponent(selectedCompany.company.id))}catch(error){errorMessage=error.message}render()}
async function mutate(path,options){return api(path,{...options,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf(),...(options?.headers||{})}})}
document.addEventListener('submit',async event=>{
  if(event.target.id==='login-form'){
    event.preventDefault();errorMessage='';const button=event.target.querySelector('button[type="submit"]');button.disabled=true;const data=Object.fromEntries(new FormData(event.target).entries());
    try{const signed=await api('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});session={authenticated:true,operator:signed.operator};sessionStorage.setItem(csrfKey,signed.csrfToken||'');await loadData();render()}catch(error){errorMessage=error.message;loginView()}return;
  }
  if(event.target.id==='add-user-form'){
    event.preventDefault();const data=Object.fromEntries(new FormData(event.target).entries());
    try{const created=await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users',{method:'POST',body:JSON.stringify(data)});selectedCompany=await api('/companies/'+encodeURIComponent(selectedCompany.company.id));render();const box=document.getElementById('mfa-result');if(box)box.innerHTML=`<div class="success-box"><strong>Användaren skapades.</strong><p>MFA-hemlighet (visa bara för användaren): <code>${esc(created.mfaSecret)}</code></p><p>Spara inte denna kod i GitHub eller andra delade dokument.</p></div>`}catch(error){errorMessage=error.message;render()}return;
  }
});
document.addEventListener('change',async event=>{
  const userId=event.target.dataset.roleUser;if(!userId||!selectedCompany)return;
  try{await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users/'+encodeURIComponent(userId)+'/role',{method:'PUT',body:JSON.stringify({role:event.target.value})});selectedCompany=await api('/companies/'+encodeURIComponent(selectedCompany.company.id));render()}catch(error){errorMessage=error.message;render()}
});
document.addEventListener('click',async event=>{
  const companyRow=event.target.closest('[data-company-id]');if(companyRow){await openCompany(companyRow.dataset.companyId);return}
  const viewButton=event.target.closest('[data-view]');if(viewButton){selectedCompany=null;view=viewButton.dataset.view;render();return}
  const button=event.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action;
  if(action==='refresh'){await refresh();return}
  if(action==='back-companies'){selectedCompany=null;view='companies';render();return}
  if(action==='reset-password'){
    const password=prompt('Nytt tillfälligt lösenord för '+(button.dataset.userName||'användaren')+'\nMinst 8 tecken, stora och små bokstäver samt siffra eller specialtecken.');
    if(!password)return;
    try{await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users/'+encodeURIComponent(button.dataset.userId)+'/password',{method:'PUT',body:JSON.stringify({password})});alert('Lösenordet är ändrat och användarens tidigare sessioner har loggats ut.')}catch(error){errorMessage=error.message;render()}return;
  }
  if(action==='remove-user'){
    if(!confirm('Ta bort '+(button.dataset.userName||'användaren')+' från företaget? Kontot tas inte bort från andra företag.'))return;
    try{await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users/'+encodeURIComponent(button.dataset.userId),{method:'DELETE',body:'{}'});selectedCompany=await api('/companies/'+encodeURIComponent(selectedCompany.company.id));render()}catch(error){errorMessage=error.message;render()}return;
  }
  if(action==='logout'){
    try{await mutate('/auth/logout',{method:'POST',body:'{}'})}catch{}
    sessionStorage.removeItem(csrfKey);session=null;overview=null;readiness=null;security=null;selectedCompany=null;errorMessage='';loginView();
  }
});
async function boot(){try{const current=await api('/session');if(!current.authenticated){loginView();return}session=current;await loadData();render()}catch(error){errorMessage=error.message;loginView()}}
boot();
