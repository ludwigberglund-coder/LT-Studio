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
function kpiCard(label,value,caption,detail=''){
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
function modalMarkup(){
  if(!modal)return '';
  if(modal.kind==='password')return `<div class="modal-backdrop" data-modal-backdrop><section class="modal-card portal-modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><span class="eyebrow">SÄKER ÅTGÄRD</span><h2 id="modal-title">Byt lösenord</h2><p>${esc(modal.userName)}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Stäng">×</button></div><form id="reset-password-form"><label class="field"><span>Nytt tillfälligt lösenord</span><input name="password" type="password" required minlength="8" autocomplete="new-password" autofocus></label><p class="form-help">Minst 8 tecken, stor och liten bokstav samt minst en siffra eller ett specialtecken. Alla tidigare sessioner avslutas efter bytet.</p><div class="modal-actions"><button class="button secondary" type="button" data-action="close-modal">Avbryt</button><button class="button" type="submit">Byt lösenord</button></div></form></section></div>`;
  if(modal.kind==='remove')return `<div class="modal-backdrop" data-modal-backdrop><section class="modal-card portal-modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><span class="eyebrow">BEKRÄFTA ÅTGÄRD</span><h2 id="modal-title">Ta bort åtkomst?</h2><p>${esc(modal.userName)}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Stäng">×</button></div><p class="modal-copy">Användaren tas bort från just detta företag och aktiva sessioner avslutas. Kontot påverkas inte i andra företag där personen har åtkomst.</p><div class="modal-actions"><button class="button secondary" type="button" data-action="close-modal">Avbryt</button><button class="button danger solid" type="button" data-action="confirm-remove-user">Ta bort åtkomst</button></div></section></div>`;
  return '';
}
function successNotice(){
  return uiNotice?`<div class="notice success"><span>${esc(uiNotice)}</span><button type="button" data-action="dismiss-notice" aria-label="Stäng meddelande">×</button></div>`:'';
}
function focusModal(){
  requestAnimationFrame(()=>document.querySelector('.modal-card input, .modal-card button')?.focus());
}
function nav(){
  const items=[['overview','Översikt','⌂'],['companies','Kunder & företag','◇'],['statistics','Statistik','▥'],['security','Säkerhetsportal','◈']];
  return items.map(([id,label,icon])=>`<button class="${view===id?'active':''}" data-view="${id}"><span class="nav-label"><span class="nav-icon">${icon}</span>${label}</span>${id==='security'?'<span class="nav-badge">nästa</span>':''}</button>`).join('');
}
function shell(body,title,subtitle){
  const operator=session?.operator||{};
  root.innerHTML=`<div class="operator-shell"><aside class="sidebar"><div><div class="mark"><span class="mark-icon"></span><span>LT STUDIO</span></div><div class="side-copy">ADMIN CONTROL CENTER</div></div><nav class="side-nav">${nav()}</nav><div class="side-spacer"></div><div class="side-status"><span class="live-dot"></span><div><strong>Operatorportal aktiv</strong><small>Separat säkerhetsgräns</small></div></div><div class="side-footer">Endast LT Studio-operatörer.<br>Alla administrativa ändringar loggas.</div></aside>
  <section class="main"><header class="topbar"><div><span class="page-kicker">LT STUDIO / ADMIN</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions"><div class="operator-user"><span class="avatar">${initials(operator.displayName)}</span><div><strong>${esc(operator.displayName||operator.username||'Operatör')}</strong><small>LT Studio-operatör</small></div></div><button class="icon-button" data-action="refresh" title="Uppdatera">↻</button><button class="button secondary" data-action="logout">Logga ut</button></div></header>
  ${errorMessage?`<div class="notice">${esc(errorMessage)}</div>`:''}${successNotice()}${body}<footer class="portal-footer"><span>LT Studio Admin</span><span>Senast uppdaterad ${dateTime(overview?.generatedAt)}</span></footer></section></div>${modalMarkup()}`;
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
  const totals=overview?.totals||{},companies=overview?.companies||[],ready=readinessState(),sec=securityState();
  const configuredPct=percent(totals.configuredCompanies,overview?.companyCount||0),activePct=percent(totals.activeCompanies30d,overview?.companyCount||0),health=readinessScore();
  const securityPenalty=Math.min(100,Number(overview?.security?.critical||0)*35+Number(overview?.security?.warning||0)*10);
  shell(`<section class="hero-dashboard">
    <div class="hero-copy"><span class="eyebrow">PLATTFORMSLÄGE</span><h2>Kontroll över hela kundbasen.</h2><p>En samlad bild av användning, kundaktivitet, drift och säkerhet — utan att öppna kundernas ekonomiska detaljdata.</p><div class="hero-badges"><span><i class="dot ${ready.kind}"></i> Drift: ${ready.label}</span><span><i class="dot ${sec.kind}"></i> Säkerhet: ${sec.label}</span></div></div>
    <div class="hero-gauges">${ringGauge(health,'Drift','Godkända tekniska hälsokontroller.')}${ringGauge(configuredPct,'Aktivering','Företag med minst en användare.')}${ringGauge(100-securityPenalty,'Säkerhet','Baserat på aktuella varningar senaste 24 h.',toneForPercent(100-securityPenalty))}</div>
  </section>
  <section class="status-grid six">
    ${kpiCard('Kundföretag',num(overview?.companyCount),'registrerade miljöer',totals.newCompanies30d?`+${totals.newCompanies30d} / 30d`:'')}
    ${kpiCard('Användare',num(totals.members),'företagsmedlemskap')}
    ${kpiCard('Aktiva sessioner',num(totals.activeSessions),'inloggade kundsessioner')}
    ${kpiCard('Kundposter',num(totals.customers),'i kundernas register')}
    ${kpiCard('Fakturor',num(totals.invoices),'registrerade fakturaposter')}
    ${kpiCard('Aktiva företag 30d',num(totals.activeCompanies30d),'med registrerad aktivitet',`${activePct}%`)}
  </section>
  <section class="dashboard-grid">
    <article class="panel dashboard-panel wide"><div class="panel-head"><div><span class="eyebrow">TREND</span><h2>Plattformsaktivitet</h2><p>Registrerade systemhändelser under de senaste sex månaderna.</p></div><span class="panel-stat">${num((overview?.monthly||[]).reduce((sum,item)=>sum+item.activity,0))} händelser</span></div><div class="chart-pad">${sparkline(overview?.monthly||[],'activity')}<div class="chart-axis">${(overview?.monthly||[]).map(item=>`<span>${esc(item.label)}</span>`).join('')}</div></div></article>
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">KUNDBAS</span><h2>Aktiveringsgrad</h2><p>Företag med minst en användare.</p></div></div><div class="instrument-pad">${ringGauge(configuredPct,'Aktiva',`${totals.configuredCompanies||0} av ${overview?.companyCount||0} företag har användare.`)}</div></article>
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">ROLLER</span><h2>Behörighetsfördelning</h2><p>Hur användarmedlemskap är fördelade.</p></div></div><div class="role-bars">${roleBars()}</div></article>
  </section>
  <section class="dashboard-grid equal">
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">ANVÄNDNING</span><h2>Fakturor per företag</h2><p>Visar volym, inte fakturainnehåll.</p></div></div><div class="chart-pad">${miniBars(companies,'invoiceRecordCount','fakturor')}</div></article>
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">KUNDREGISTER</span><h2>Kundposter per företag</h2><p>Jämför storleken på kundregistren.</p></div></div><div class="chart-pad">${miniBars(companies,'customerRecordCount','kunder')}</div></article>
  </section>
  <section class="panel"><div class="panel-head"><div><span class="eyebrow">KUNDMILJÖER</span><h2>Alla företag</h2><p>Klicka på ett företag för att öppna dess adminöversikt.</p></div><button class="button secondary" data-view="companies">Visa alla</button></div><div class="table-wrap"><table><thead><tr><th>Företag</th><th>Org.nr</th><th>Användare</th><th>Status</th><th>Sessioner</th><th>Fakturor</th><th>Senaste aktivitet</th></tr></thead><tbody>${companyRows()}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><div><span class="eyebrow">DRIFT</span><h2>Hälsokontroller</h2><p>Teknisk status för plattformens viktigaste skydd och tjänster.</p></div><span class="panel-stat ${ready.kind}">${health}% godkända</span></div><div class="health-list">${readinessChecks()}</div></section>`,'Adminöversikt','Kundbas, användning, drift och säkerhet i realtid.');
}
function companiesView(){
  const totals=overview?.totals||{},configuredPct=percent(totals.configuredCompanies,overview?.companyCount||0);
  shell(`<section class="page-intro-card"><div><span class="eyebrow">KUNDBAS</span><h2>${num(overview?.companyCount)} företag använder plattformen</h2><p>Härifrån öppnar ni varje kundmiljö och hanterar användare, behörigheter och teknisk statistik.</p></div><div class="intro-stats"><div><strong>${configuredPct}%</strong><span>aktiverade</span></div><div><strong>${num(totals.activeCompanies30d)}</strong><span>aktiva 30d</span></div><div><strong>${num(totals.members)}</strong><span>användare</span></div></div></section>
  <section class="panel"><div class="panel-head"><div><span class="eyebrow">FÖRETAG</span><h2>Alla kunder & företag</h2><p>Öppna ett företag för användare, behörigheter och statistik.</p></div></div><div class="table-wrap"><table><thead><tr><th>Företag</th><th>Org.nr</th><th>Användare</th><th>Status</th><th>Sessioner</th><th>Fakturor</th><th>Senaste aktivitet</th></tr></thead><tbody>${companyRows()}</tbody></table></div></section>`,'Kunder & företag','Central administration för varje kundmiljö.');
}
function statisticsView(){
  const companies=overview?.companies||[],totals=overview?.totals||{};
  const avgUsers=overview?.companyCount?totals.members/overview.companyCount:0,avgInvoices=overview?.companyCount?totals.invoices/overview.companyCount:0;
  shell(`<section class="status-grid six">
    ${kpiCard('Företag',num(overview?.companyCount),'totalt')}
    ${kpiCard('Användare',num(totals.members),'medlemskap')}
    ${kpiCard('Snitt användare',avgUsers.toLocaleString('sv-SE',{maximumFractionDigits:1}),'per företag')}
    ${kpiCard('Kundposter',num(totals.customers),'totalt')}
    ${kpiCard('Fakturor',num(totals.invoices),'totalt')}
    ${kpiCard('Snitt fakturor',avgInvoices.toLocaleString('sv-SE',{maximumFractionDigits:1}),'per företag')}
  </section>
  <section class="trend-grid">
    ${trendCard('Systemaktivitet','Audit-händelser som visar användning av systemet.','activity','händelser')}
    ${trendCard('Fakturor','Nya fakturaposter som skapats i systemet.','invoices','fakturor')}
    ${trendCard('Kundregister','Nya kundposter i kundföretagens register.','customers','kunder')}
    ${trendCard('Användare','Nya företagsmedlemskap i plattformen.','memberships','medlemskap')}
  </section>
  <section class="dashboard-grid equal">
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">FÖRETAG</span><h2>Fakturavolym</h2><p>Fakturaposter per kundföretag.</p></div></div><div class="chart-pad">${miniBars(companies,'invoiceRecordCount','fakturor')}</div></article>
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">FÖRETAG</span><h2>Användare</h2><p>Antal medlemskap per kundföretag.</p></div></div><div class="chart-pad">${miniBars(companies,'memberCount','användare')}</div></article>
  </section>
  <section class="dashboard-grid equal">
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">ROLLER</span><h2>Behörighetsfördelning</h2><p>Fördelning över alla kundföretag.</p></div></div><div class="role-bars roomy">${roleBars()}</div></article>
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">KONTOKVALITET</span><h2>Aktivering & konto-status</h2><p>Översikt över hur färdig kundbasen är.</p></div></div><div class="stat-stack"><div><span>Företag med användare</span><strong>${percent(totals.configuredCompanies,overview?.companyCount)}%</strong><meter min="0" max="100" value="${percent(totals.configuredCompanies,overview?.companyCount)}"></meter></div><div><span>Aktiva företag senaste 30 dagar</span><strong>${percent(totals.activeCompanies30d,overview?.companyCount)}%</strong><meter min="0" max="100" value="${percent(totals.activeCompanies30d,overview?.companyCount)}"></meter></div><div><span>Inaktiverade användarkonton</span><strong>${num(totals.disabledUsers)}</strong><small>konton</small></div></div></article>
  </section>
  <section class="panel"><div class="panel-head"><div><span class="eyebrow">DETALJER</span><h2>Företagsstatistik</h2><p>Operativ metadata utan fakturainnehåll eller ekonomiska belopp.</p></div></div><div class="table-wrap"><table><thead><tr><th>Företag</th><th>Användare</th><th>Kunder</th><th>Fakturor</th><th>Sessioner</th><th>Senaste aktivitet</th></tr></thead><tbody>${companies.map(c=>`<tr class="click-row" data-company-id="${esc(c.id)}"><td><div class="company-cell"><span class="company-avatar">${initials(c.displayName)}</span><strong>${esc(c.displayName)}</strong></div></td><td>${c.memberCount}</td><td>${c.customerRecordCount}</td><td>${c.invoiceRecordCount}</td><td>${c.activeSessionCount}</td><td>${dateTime(c.lastActivityAt)}</td></tr>`).join('')}</tbody></table></div></section>`,'Statistik','Mätbara nyckeltal och trender för hela LT Studio-plattformen.');
}
function securityView(){
  const sec=overview?.security||{},risk=Math.min(100,Number(sec.critical||0)*35+Number(sec.warning||0)*10),health=readinessScore();
  shell(`<section class="security-hero"><div><span class="eyebrow">SÄKERHETSPORTAL · NÄSTA ETAPP</span><h2>En samlad säkerhetsyta för hela LT Studio.</h2><p>Den fulla säkerhetsportalen byggs separat. Den här förhandsvyn använder redan aktuella säkerhetshändelser och tekniska hälsokontroller.</p></div><div class="hero-gauges compact">${ringGauge(health,'Drift','Tekniska kontroller')}${ringGauge(100-risk,'Risknivå','Baserat på 24 h',toneForPercent(100-risk))}</div></section>
  <section class="status-grid"><article class="metric"><span>Kritiska händelser</span><strong class="critical">${num(sec.critical)}</strong><small>senaste 24 timmar</small></article><article class="metric"><span>Varningar</span><strong class="warning">${num(sec.warning)}</strong><small>senaste 24 timmar</small></article><article class="metric"><span>Information</span><strong>${num(sec.info)}</strong><small>senaste 24 timmar</small></article><article class="metric"><span>Senaste händelse</span><strong class="small-value">${esc(dateTime(sec.latestEventAt))}</strong><small>säkerhetslogg</small></article></section>
  <section class="dashboard-grid equal"><article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">SÄKERHET</span><h2>Aktuella händelser</h2><p>Redigerad vy utan känsliga tekniska detaljer.</p></div></div><div class="event-list">${securityEvents()}</div></article><article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">DRIFT</span><h2>Skydd & hälsa</h2><p>Kontroller som säkerhetsportalen kommer övervaka.</p></div></div><div class="health-list">${readinessChecks()}</div></article></section>`,'Säkerhetsportal','Förhandsvy inför den separata säkerhetsetappen.');
}
function memberRows(detail){
  return (detail.members||[]).map(m=>`<tr><td><div class="company-cell"><span class="company-avatar user">${initials(m.displayName)}</span><div><strong>${esc(m.displayName)}</strong><small>${esc(m.username)}</small></div></div></td><td><select data-role-user="${esc(m.userId)}">${['admin','accountant','approver','readonly'].map(r=>`<option value="${r}" ${m.role===r?'selected':''}>${roleLabel(r)}</option>`).join('')}</select></td><td>${m.disabled?'<span class="status-pill"><span class="dot critical"></span>Inaktiv</span>':'<span class="status-pill"><span class="dot ok"></span>Aktiv</span>'}</td><td><div class="row-actions"><button class="button secondary small" data-action="reset-password" data-user-id="${esc(m.userId)}" data-user-name="${esc(m.displayName)}">Byt lösenord</button><button class="button danger small" data-action="remove-user" data-user-id="${esc(m.userId)}" data-user-name="${esc(m.displayName)}">Ta bort åtkomst</button></div></td></tr>`).join('')||'<tr><td colspan="4" class="empty">Inga användare i företaget.</td></tr>';
}
function companyDetailView(detail){
  selectedCompany=detail;
  const c=detail.company,s=detail.stats||{},memberCount=Number(s.memberCount||0);
  const userActivity=memberCount?Math.min(100,Math.round(Number(s.activeSessionCount||0)/memberCount*100)):0;
  shell(`<div class="detail-back"><button class="button secondary" data-action="back-companies">← Alla företag</button></div>
  <section class="detail-hero"><div><span class="eyebrow">KUNDFÖRETAG</span><h2>${esc(c.displayName)}</h2><p>${esc(c.legalName)} · ${esc(c.orgNumber)}</p></div><div class="detail-hero-meta"><span><small>Skapad</small><strong>${dateTime(c.createdAt)}</strong></span><span><small>Senaste aktivitet</small><strong>${dateTime(s.lastActivityAt)}</strong></span></div></section>
  <section class="status-grid"><article class="metric"><span>Användare</span><strong>${num(s.memberCount)}</strong><small>konton med åtkomst</small></article><article class="metric"><span>Aktiva sessioner</span><strong>${num(s.activeSessionCount)}</strong><small>${userActivity}% av användarna</small></article><article class="metric"><span>Kundposter</span><strong>${num(s.customerRecordCount)}</strong><small>i kundregistret</small></article><article class="metric"><span>Fakturor</span><strong>${num(s.invoiceRecordCount)}</strong><small>registrerade poster</small></article></section>
  <section class="dashboard-grid equal">
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">ANVÄNDNING</span><h2>Aktivitet</h2><p>Snabb indikator för kundmiljön.</p></div></div><div class="instrument-pad">${ringGauge(userActivity,'Inloggade',`${s.activeSessionCount||0} aktiva sessioner av ${memberCount} användare.`)}</div></article>
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">MILJÖDATA</span><h2>Volym</h2><p>Operativ metadata för kundmiljön.</p></div></div><div class="stat-stack"><div><span>Kundposter</span><strong>${num(s.customerRecordCount)}</strong></div><div><span>Fakturaposter</span><strong>${num(s.invoiceRecordCount)}</strong></div><div><span>Senaste aktivitet</span><strong class="date-stat">${dateTime(s.lastActivityAt)}</strong></div></div></article>
  </section>
  <section class="panel"><div class="panel-head"><div><span class="eyebrow">ÅTKOMST</span><h2>Användare & behörigheter</h2><p>Endast LT Studio kan skapa, ändra eller ta bort användare.</p></div><span class="panel-stat">${memberCount} användare</span></div><div class="table-wrap"><table><thead><tr><th>Användare</th><th>Roll</th><th>Status</th><th>Åtgärder</th></tr></thead><tbody>${memberRows(detail)}</tbody></table></div></section>
  <section class="panel add-user-panel"><div class="panel-head"><div><span class="eyebrow">NY ANVÄNDARE</span><h2>Lägg till användare</h2><p>Minst 8 tecken, stora och små bokstäver samt minst en siffra eller ett specialtecken. MFA skapas samtidigt.</p></div></div>
    <form id="add-user-form" class="form-grid compact-form">
      <label class="field"><span>Namn</span><input name="displayName" required maxlength="120" placeholder="För- och efternamn"></label>
      <label class="field"><span>Användarnamn / e-post</span><input name="username" required maxlength="120" placeholder="namn@foretag.se"></label>
      <label class="field"><span>Tillfälligt lösenord</span><input name="password" type="password" required minlength="8" placeholder="Minst 8 tecken"></label>
      <label class="field"><span>Behörighet</span><select name="role"><option value="readonly">Läsbehörighet · säker standard</option><option value="approver">Attestant</option><option value="accountant">Ekonom</option><option value="admin">Admin</option></select></label>
      <div><button class="button" type="submit">Skapa användare</button></div>
    </form><div id="mfa-result"></div>
  </section>`,'Företagsadmin',`Inställningar, användare och statistik för ${c.displayName}.`);
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
