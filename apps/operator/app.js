const root=document.getElementById('operator-app');
const csrfKey='lt-operator-csrf';
let session=null,overview=null,readiness=null,security=null,errorMessage='';

function esc(value=''){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function initials(name='LT'){return String(name).trim().split(/\s+/).filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase()||'LT'}
function dateTime(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short'}).format(d)}
async function api(path,options={}){
  const headers={Accept:'application/json',...(options.headers||{})};
  const response=await fetch('/api/operator/v1'+path,{credentials:'same-origin',...options,headers});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const e=new Error(data.error||'Begäran misslyckades.');e.code=data.code;e.status=response.status;e.data=data;throw e}
  return data;
}
function loginView(){
  root.innerHTML=`<section class="login-shell">
    <div class="login-brand"><div class="mark"><span class="mark-icon"></span><span>LT STUDIO</span></div><div><h1>Driftadmin för hela plattformen.</h1><p>En separat operatörsyta för kundmiljöer, hälsokontroller och säkerhetsvarningar. Kundernas ekonomidata visas inte här.</p></div><small>Read-only driftvy · separat MFA-inloggning</small></div>
    <div class="login-panel"><form class="card" id="login-form"><h2>Operatörsinloggning</h2><p>Logga in med ert separata LT Studio-operatörskonto.</p>
      <label class="field"><span>Användarnamn</span><input name="username" autocomplete="username" required></label>
      <label class="field"><span>Lösenord</span><input name="password" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>MFA-kod</span><input name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
      <button class="button" type="submit">Logga in</button>
      ${errorMessage?`<div class="error">${esc(errorMessage)}</div>`:''}
    </form></div>
  </section>`;
}
function readinessState(){
  if(!readiness)return{label:'Laddar',kind:'warning'};
  return readiness.ok?{label:'OK',kind:'ok'}:{label:'Varning',kind:'critical'};
}
function securityState(){
  const critical=Number(overview?.security?.critical||0),warning=Number(overview?.security?.warning||0);
  if(critical)return{label:`${critical} kritiska`,kind:'critical'};
  if(warning)return{label:`${warning} varningar`,kind:'warning'};
  return{label:'Ingen aktiv varning',kind:'ok'};
}
function companyRows(){
  const rows=overview?.companies||[];
  if(!rows.length)return '<tr><td colspan="6" class="empty">Inga företag är registrerade ännu.</td></tr>';
  return rows.map(company=>{
    const access=company.accessConfigured?'<span class="status-pill"><span class="dot ok"></span>Konfigurerad</span>':'<span class="status-pill"><span class="dot warning"></span>Saknar medlem</span>';
    return `<tr><td><strong>${esc(company.displayName)}</strong><br><small>${esc(company.legalName)}</small></td><td>${esc(company.orgNumber||'—')}</td><td>${access}</td><td>${company.activeSessionCount}</td><td>${company.invoiceRecordCount}</td><td>${dateTime(company.lastActivityAt)}</td></tr>`;
  }).join('');
}
function securityEventLabel(kind){
  return ({
    LOGIN_FAILURE_THRESHOLD:'Många felaktiga kundinloggningar',
    OPERATOR_LOGIN_FAILURE_THRESHOLD:'Många felaktiga LT-admininloggningar'
  })[kind]||String(kind||'Säkerhetshändelse').replaceAll('_',' ');
}
function severityLabel(value){
  return ({critical:'Kritisk',warning:'Varning',info:'Information'})[value]||String(value||'Okänd');
}
function securityEvents(){
  const events=security?.events||[];
  if(!events.length)return '<div class="empty">Inga säkerhetshändelser i listan.</div>';
  return events.map(event=>`<div class="event"><span class="status-pill"><span class="dot ${esc(event.severity)}"></span>${esc(severityLabel(event.severity))}</span><strong>${esc(securityEventLabel(event.kind))}</strong><time>${dateTime(event.createdAt)}</time></div>`).join('');
}
function readinessChecks(){
  const checks=readiness?.checks&&typeof readiness.checks==='object'?readiness.checks:{};
  const rows=[
    ['databaseRead','Databas · läsning'],
    ['databaseWrite','Databas · skrivning'],
    ['diskSpace','Diskutrymme'],
    ['backup','Lokal backup'],
    ['offsiteBackup','Krypterad extern backup'],
    ['r2StagingAudit','R2 · privata objekt'],
    ['restoreDrill','Lokal restore-test'],
    ['r2RestoreDrill','R2 · restore-test'],
    ['monitoring','Extern monitoring']
  ];
  return rows.map(([key,label])=>{
    const ok=checks[key]===true,known=typeof checks[key]==='boolean';
    const state=known?(ok?'OK':'Problem'):'Saknas';
    const kind=known?(ok?'ok':'critical'):'warning';
    let detail='';
    if(key==='backup'&&readiness?.backupAgeMinutes!==null&&readiness?.backupAgeMinutes!==undefined)detail=`${readiness.backupAgeMinutes} min sedan`;
    if(key==='offsiteBackup'&&readiness?.offsiteBackupAgeMinutes!==null&&readiness?.offsiteBackupAgeMinutes!==undefined)detail=`${readiness.offsiteBackupAgeMinutes} min sedan`;
    if(key==='r2StagingAudit'&&readiness?.r2StagingAuditAgeMinutes!==null&&readiness?.r2StagingAuditAgeMinutes!==undefined)detail=`${readiness.r2StagingAuditAgeMinutes} min sedan`;
    if(key==='restoreDrill'&&readiness?.restoreDrillAgeMinutes!==null&&readiness?.restoreDrillAgeMinutes!==undefined)detail=`${Math.round(readiness.restoreDrillAgeMinutes/60)} h sedan`;
    if(key==='r2RestoreDrill'&&readiness?.r2RestoreDrillAgeMinutes!==null&&readiness?.r2RestoreDrillAgeMinutes!==undefined)detail=`${Math.round(readiness.r2RestoreDrillAgeMinutes/60)} h sedan`;
    if(key==='monitoring'&&readiness?.monitoringAgeMinutes!==null&&readiness?.monitoringAgeMinutes!==undefined)detail=`${Math.round(readiness.monitoringAgeMinutes/60)} h sedan`;
    return `<div class="health-row"><strong>${esc(label)}</strong><span>${esc(detail||'')}</span><span class="status-pill"><span class="dot ${kind}"></span>${state}</span></div>`;
  }).join('');
}
function dashboard(){
  const ready=readinessState(),sec=securityState(),operator=session?.operator||{};
  root.innerHTML=`<div class="operator-shell"><aside class="sidebar"><div class="mark"><span class="mark-icon"></span><span>LT STUDIO</span></div><div class="side-copy">Central driftadmin för den gemensamma SaaS-plattformen.</div><nav class="side-nav"><button class="active">Översikt</button></nav><div class="side-footer">Read-only version. Kundernas affärsdata visas inte i driftvyn.</div></aside>
  <section class="main"><header class="topbar"><div><h1>Plattformsöversikt</h1><p>Företag, driftstatus och säkerhetssignaler.</p></div><div class="actions"><div class="operator-user"><span class="avatar">${initials(operator.displayName)}</span><div><strong>${esc(operator.displayName||operator.username||'Operatör')}</strong><small>LT Studio-operatör</small></div></div><button class="button secondary" data-action="logout">Logga ut</button></div></header>
  ${errorMessage?`<div class="notice">${esc(errorMessage)}</div>`:''}
  <section class="status-grid">
    <article class="metric"><span>Företag</span><strong>${overview?.companyCount??'—'}</strong><small>miljöer i plattformen</small></article>
    <article class="metric"><span>Aktiva sessioner</span><strong>${overview?.activeSessionCount??'—'}</strong><small>kundsessioner just nu</small></article>
    <article class="metric"><span>Readiness</span><strong class="${ready.kind}">${ready.label}</strong><small>backup, R2, restore, monitoring och databas</small></article>
    <article class="metric"><span>Säkerhet 24 h</span><strong class="${sec.kind}">${sec.label}</strong><small>${overview?.security?.total??0} händelser totalt</small></article>
  </section>
  <section class="panel"><div class="panel-head"><div><h2>Kundmiljöer</h2><p>Teknisk metadata för varje företag.</p></div><button class="button secondary" data-action="refresh">Uppdatera</button></div><div class="table-wrap"><table><thead><tr><th>Företag</th><th>Org.nr</th><th>Åtkomst</th><th>Sessioner</th><th>Fakturaposter</th><th>Senaste aktivitet</th></tr></thead><tbody>${companyRows()}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><div><h2>Hälsokontroller</h2><p>Exakt vilken del av driften som är frisk eller behöver åtgärdas.</p></div></div><div class="health-list">${readinessChecks()}</div></section>
  <section class="panel"><div class="panel-head"><div><h2>Säkerhetshändelser</h2><p>Redigerad driftvy utan IP, användarnamn eller tekniska fingeravtryck.</p></div></div><div class="event-list">${securityEvents()}</div></section>
  </section></div>`;
}
async function loadData(){
  const [o,r,s]=await Promise.all([
    api('/overview'),
    api('/readiness').catch(err=>err.data&&typeof err.data==='object'?err.data:{ok:false,error:err.message,checks:{}}),
    api('/security-events?limit=50')
  ]);
  overview=o;readiness=r;security=s;
}
async function refresh(){
  errorMessage='';
  try{await loadData()}catch(error){errorMessage=error.message}
  dashboard();
}
document.addEventListener('submit',async event=>{
  if(event.target.id!=='login-form')return;
  event.preventDefault();errorMessage='';
  const button=event.target.querySelector('button[type="submit"]');button.disabled=true;
  const data=Object.fromEntries(new FormData(event.target).entries());
  try{
    const signed=await api('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    session={authenticated:true,operator:signed.operator};sessionStorage.setItem(csrfKey,signed.csrfToken||'');
    await loadData();dashboard();
  }catch(error){errorMessage=error.message;loginView()}
});
document.addEventListener('click',async event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(action==='refresh'){await refresh();return}
  if(action==='logout'){
    const csrf=sessionStorage.getItem(csrfKey)||'';
    try{await api('/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:'{}'})}catch{}
    sessionStorage.removeItem(csrfKey);session=null;overview=null;readiness=null;security=null;errorMessage='';loginView();
  }
});
async function boot(){
  try{
    const current=await api('/session');
    if(!current.authenticated){loginView();return}
    session=current;await loadData();dashboard();
  }catch(error){errorMessage=error.message;loginView()}
}
boot();
