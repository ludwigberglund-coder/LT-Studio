const root=document.getElementById('operator-app');
const csrfKey='lt-operator-csrf';
let session=null,overview=null,readiness=null,security=null,errorMessage='',view='overview',selectedCompany=null,modal=null,uiNotice='';

function esc(value=''){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function initials(name='LT'){return String(name).trim().split(/\s+/).filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase()||'LT'}
function dateTime(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short'}).format(d)}
function roleLabel(role){return({admin:'Admin',accountant:'Ekonom',approver:'Attestant',readonly:'Läsbehörighet'})[role]||role}
function num(value){return new Intl.NumberFormat('sv-SE').format(Number(value||0))}
function clamp(value,min=0,max=100){return Math.min(max,Math.max(min,Number(value)||0))}
function percent(part,total){return total?Math.round((Number(part||0)/Number(total))*100):0}
function toneForPercent(value){const score=clamp(value);return score>=80?'ok':score>=55?'warning':'critical'}
function readinessScore(){
  const checks=readiness?.checks&&typeof readiness.checks==='object'?Object.values(readiness.checks).filter(value=>typeof value==='boolean'):[];
  if(!checks.length)return 0;
  return Math.round(checks.filter(Boolean).length/checks.length*100);
}
function ringGauge(value,label,caption,tone=toneForPercent(value)){
  const pct=clamp(value),circumference=301.593,filled=(circumference*pct/100).toFixed(2),rest=(circumference-(circumference*pct/100)).toFixed(2);
  return `<div class="ring-gauge"><div class="ring-visual"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-track" cx="60" cy="60" r="48"></circle><circle class="ring-value ${esc(tone)}" cx="60" cy="60" r="48" stroke-dasharray="${filled} ${rest}" transform="rotate(-90 60 60)"></circle></svg><div class="ring-center"><strong>${pct}%</strong><span>${esc(label)}</span></div></div><p>${esc(caption)}</p></div>`;
}
function sparkline(items,key){
  const values=(items||[]).map(item=>Number(item?.[key]||0));
  const width=520,height=150,pad=14,max=Math.max(1,...values),step=values.length>1?(width-pad*2)/(values.length-1):0;
  const points=values.map((value,index)=>`${(pad+index*step).toFixed(1)},${(height-pad-(value/max)*(height-pad*2)).toFixed(1)}`).join(' ');
  const dots=values.map((value,index)=>{const x=(pad+index*step).toFixed(1),y=(height-pad-(value/max)*(height-pad*2)).toFixed(1);return `<circle cx="${x}" cy="${y}" r="4"></circle>`}).join('');
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Trend"><line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}"></line><polyline points="${points}"></polyline>${dots}</svg>`;
}
function miniBars(companies,key,label){
  const sorted=[...(companies||[])].sort((a,b)=>Number(b[key]||0)-Number(a[key]||0)).slice(0,7);
  const max=Math.max(1,...sorted.map(item=>Number(item[key]||0)));
  if(!sorted.length)return '<div class="empty">Ingen statistik ännu.</div>';
  return `<div class="bar-list">${sorted.map((item)=>`<div class="bar-row"><div><strong>${esc(item.displayName)}</strong><span>${num(item[key])} ${esc(label)}</span></div><meter min="0" max="${max}" value="${Number(item[key]||0)}"></meter></div>`).join('')}</div>`;
}
function roleBars(){
  const roles=overview?.roleDistribution||{},total=Object.values(roles).reduce((sum,value)=>sum+Number(value||0),0),max=Math.max(1,...Object.values(roles).map(Number));
  return ['admin','accountant','approver','readonly'].map(role=>`<div class="role-row"><div><strong>${roleLabel(role)}</strong><span>${num(roles[role])} · ${percent(roles[role],total)}%</span></div><meter min="0" max="${max}" value="${Number(roles[role]||0)}"></meter></div>`).join('');
}
function kpiCard(label,value,caption,detail='')}
  return `<article class="metric"><div class="metric-top"><span>${esc(label)}</span>${detail?`<em>${esc(detail)}</em>`:''}</div><strong>${esc(value)}</strong><small>${esc(caption)}</small></article>`;
}
function trendCard(title,description,key,totalLabel){
  const months=overview?.monthly||[],total=months.reduce((sum,item)=>sum+Number(item[key]||0),0);
  return `<article class="chart-card"><div class="chart-head"><div><span class="eyebrow">6 MÅNADER</span><h3>${esc(title)}</h3><p>${esc(description)}</p></div><div class="chart-total"><strong>${num(total)}</strong><span>${esc(totalLabel)}</span></div></div>${sparkline(months,key)}<div class="chart-axis">${months.map(item=>`<span>${esc(item.label)}</span>`).join('')}</div></article>`;
}
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
  const items=[['overview','Översikt','⌂'],['companies','Kunder & företag','◇'],['statistics','Statistik','▥'],['security','Säkerhetsportal','◈']];
  return items.map(([id,label,icon])=>`<button class="${view===id?'active':''}" data-view="${id}"><span class="nav-label"><span class="nav-icon">${icon}</span>${label}</span>${id==='security'?'<span class="nav-badge">nästa</span>':''}</button>`).join('');
}
function shell(body,title,subtitle){
  const operator=session?.operator||{};
  root.innerHTML=`<div class="operator-shell"><aside class="sidebar"><div><div class="mark"><span class="mark-icon"></span><span>LT STUDIO</span></div><div class="side-copy">ADMIN CONTROL CENTER</div></div><nav class="side-nav">${nav()}</nav><div class="side-spacer"></div><div class="side-status"><span class="live-dot"></span><div><strong>Operatorportal aktiv</strong><small>Separat säkerhetsgräns</small></div></div><div class="side-footer">Endast LT Studio-operatörer.<br>Alla administrativa ändringar loggas.</div></aside>
  <section class="main"><header class="topbar"><div><span class="page-kicker">LT STUDIO / ADMIN</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions"><div class="operator-user"><span class="avatar">${initials(operator.displayName)}</span><div><strong>${esc(operator.displayName||operator.username||'Operatör')}</strong><small>LT Studio-operatör</small></div></div><button class="icon-button" data-action="refresh" title="Uppdatera">↻</button><button class="button secondary" data-action="logout">Logga ut</button></div></header>
  ${errorMessage?`<div class="notice">${esc(errorMessage)}</div>`:''}${body}<footer class="portal-footer"><span>LT Studio Admin</span><span>Senast uppdaterad ${dateTime(overview?.generatedAt)}</span></footer></section></div>`;
}
function companyRows(){
  const rows=overview?.companies||[];
  if(!rows.length)return '<tr><td colspan="7" class="empty">Inga företag är registrerade ännu.</td></tr>';
  return rows.map(company=>{
    const access=company.accessConfigured?'<span class="status-pill"><span class="dot ok"></span>Aktiv</span>':'<span class="status-pill"><span class="dot warning"></span>Saknar användare</span>';
    return `<tr class="click-row" data-company-id="${esc(company.id)}"><td><div class="company-cell"><span class="company-avatar">${initials(company.displayName)}</span><div><strong>${esc(company.displayName)}</strong><small>${esc(company.legalName)}</small></div></div></td><td>${esc(company.orgNumber||'—')}</td><td>${company.memberCount}</td><td>${access}</td><td>${company.activeSessionCount}</td><td>${company.invoiceRecordCount}</td><td>${dateTime(company.lastActivityAt)}</td></tr>`;
  }).join('');
}
function readinessChecks(){
  const checks=readiness?.checks&&typeof readiness.checks==='object'?readiness.checks:{};
  return [['databaseRead','Databas · läsning'],['databaseWrite','Databas · skrivning'],['backup','Lokal backup'],['offsiteBackup','Extern backup'],['r2StagingAudit','R2 · privata objekt'],['restoreDrill','Restore-test'],['auditAnchor','Audit · externt ankare'],['monitoring','Extern monitoring']].map(([key,label])=>{
    const ok=checks[key]===true,known=typeof checks[key]==='boolean',state=known?(ok?'OK':'Problem'):'Saknas',kind=known?(ok?'ok':'critical'):'warning';
    return `<div class="health-row"><div class="health-name"><span class="health-dot ${kind}"></span><strong>${esc(label)}</strong></div><span class="health-line"></span><span class="status-pill"><span class="dot ${kind}"></span>${state}</span></div>`;
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
  return (detail.members||[]).map(m=>`<tr><td><strong>${esc(m.displayName)}</strong><br><small>${esc(m.username)}</small></td><td><select data-role-user="${esc(m.userId)}">${['admin','accountant','approver','readonly'].map(r=>`<option value="${r}" ${m.role===r?'selected':''}>${roleLabel(r)}</option>`).join('')}</select></td><td>${m.disabled?'Inaktiv':'Aktiv'}</td><td><button class="button secondary small" data-action="reset-password" data-user-id="${esc(m.userId)}" data-user-name="${esc(m.displayName)}">Byt lösenord</button> <button class="button danger small" data-action="remove-user" data-user-id="${esc(m.userId)}" data-user-name="${esc(m.displayName)}">Ta bort åtkomst</button></td></tr>`).join('')||'<tr><td colspan="4" class="empty">Inga användare i företaget.</td></tr>';
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
    event.preventDefault();const data=Object.fromEntries(new FormData(event.target).entries());const button=event.target.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{const created=await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users',{method:'POST',body:JSON.stringify(data)});selectedCompany=await api('/companies/'+encodeURIComponent(selectedCompany.company.id));uiNotice='Användaren skapades.';render();const box=document.getElementById('mfa-result');if(box)box.innerHTML=`<div class="success-box"><strong>MFA-hemlighet – visas bara nu</strong><p><code>${esc(created.mfaSecret)}</code></p><p>Ge koden direkt till användaren och spara den inte i GitHub eller delade dokument.</p></div>`}catch(error){errorMessage=error.message;render()}return;
  }
  if(event.target.id==='reset-password-form'){
    event.preventDefault();if(!modal||modal.kind!=='password')return;const data=Object.fromEntries(new FormData(event.target).entries());const button=event.target.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users/'+encodeURIComponent(modal.userId)+'/password',{method:'PUT',body:JSON.stringify({password:data.password})});selectedCompany=await api('/companies/'+encodeURIComponent(selectedCompany.company.id));modal=null;uiNotice='Lösenordet ändrades och användarens tidigare sessioner avslutades.';errorMessage='';render()}catch(error){errorMessage=error.message;modal=null;render()}return;
  }
});
document.addEventListener('change',async event=>{
  const userId=event.target.dataset.roleUser;if(!userId||!selectedCompany)return;
  event.target.disabled=true;
  try{await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users/'+encodeURIComponent(userId)+'/role',{method:'PUT',body:JSON.stringify({role:event.target.value})});selectedCompany=await api('/companies/'+encodeURIComponent(selectedCompany.company.id));uiNotice='Behörigheten uppdaterades och användarens tidigare sessioner avslutades.';errorMessage='';render()}catch(error){errorMessage=error.message;render()}
});
document.addEventListener('keydown',async event=>{
  const row=event.target.closest?.('[data-company-id]');if(!row||!['Enter',' '].includes(event.key))return;
  event.preventDefault();await openCompany(row.dataset.companyId);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&modal){modal=null;render();}
});
document.addEventListener('click',async event=>{
  if(event.target.matches?.('[data-modal-backdrop]')){modal=null;render();return}
  const companyRow=event.target.closest('[data-company-id]');if(companyRow){await openCompany(companyRow.dataset.companyId);return}
  const viewButton=event.target.closest('[data-view]');if(viewButton){selectedCompany=null;view=viewButton.dataset.view;render();return}
  const button=event.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action;
  if(action==='refresh'){await refresh();return}
  if(action==='back-companies'){selectedCompany=null;view='companies';render();return}
  if(action==='reset-password'){modal={kind:'password',userId:button.dataset.userId,userName:button.dataset.userName||'Användaren'};render();focusModal();return}
  if(action==='remove-user'){modal={kind:'remove',userId:button.dataset.userId,userName:button.dataset.userName||'Användaren'};render();focusModal();return}
  if(action==='close-modal'){modal=null;render();return}
  if(action==='dismiss-notice'){uiNotice='';render();return}
  if(action==='confirm-remove-user'){
    if(!modal||modal.kind!=='remove')return;button.disabled=true;
    try{await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users/'+encodeURIComponent(modal.userId),{method:'DELETE',body:'{}'});selectedCompany=await api('/companies/'+encodeURIComponent(selectedCompany.company.id));modal=null;uiNotice='Användarens åtkomst till företaget togs bort och aktiva sessioner avslutades.';errorMessage='';render()}catch(error){errorMessage=error.message;modal=null;render()}return;
  }
  if(action==='logout'){
    try{await mutate('/auth/logout',{method:'POST',body:'{}'})}catch{}
    sessionStorage.removeItem(csrfKey);session=null;overview=null;readiness=null;security=null;selectedCompany=null;errorMessage='';loginView();
  }
});
async function boot(){try{const current=await api('/session');if(!current.authenticated){loginView();return}session=current;await loadData();render()}catch(error){errorMessage=error.message;loginView()}}
boot();
