const root=document.getElementById('operator-app');
const csrfKey='lt-operator-csrf';
let session=null,overview=null,readiness=null,security=null,operatorAudit=null,securityMonitor=null,securityAlerts=null,securityPollTimer=null,errorMessage='',view='overview',selectedCompany=null,modal=null,uiNotice='',companyQuery='',companyStatus='all',companySort='name',companySearchOpen=false,companySearchActiveIndex=-1,securitySeverity='all',securityPeriod='24h',securityCompany='all',securityIncidentStatus='all';


const OPERATOR_ICONOIR=Object.freeze({
  home:'<path d="M9 21H7C4.79086 21 3 19.2091 3 17V10.7076C3 9.30887 3.73061 8.01175 4.92679 7.28679L9.92679 4.25649C11.2011 3.48421 12.7989 3.48421 14.0732 4.25649L19.0732 7.28679C20.2694 8.01175 21 9.30887 21 10.7076V17C21 19.2091 19.2091 21 17 21H15M9 21V17C9 15.3431 10.3431 14 12 14C13.6569 14 15 15.3431 15 17V21M9 21H15"/>',
  group:'<path d="M1 20V19C1 15.134 4.13401 12 8 12C11.866 12 15 15.134 15 19V20M13 14C13 11.2386 15.2386 9 18 9C20.7614 9 23 11.2386 23 14V14.5M8 12C10.2091 12 12 10.2091 12 8C12 5.79086 10.2091 4 8 4C5.79086 4 4 5.79086 4 8C4 10.2091 5.79086 12 8 12ZM18 9C19.6569 9 21 7.65685 21 6C21 4.34315 19.6569 3 18 3C16.3431 3 15 4.34315 15 6C15 7.65685 16.3431 9 18 9Z"/>',
  stats:'<path d="M10 9H6M15.5 11C14.1193 11 13 9.88071 13 8.5C13 7.11929 14.1193 6 15.5 6C16.8807 6 18 7.11929 18 8.5C18 9.88071 16.8807 11 15.5 11ZM6 6H9M18 18L13.5 15L11 17L6 13M3 20.4V3.6C3 3.26863 3.26863 3 3.6 3H20.4C20.7314 3 21 3.26863 21 3.6V20.4C21 20.7314 20.7314 21 20.4 21H3.6C3.26863 21 3 20.7314 3 20.4Z"/>',
  shield:'<path d="M8.5 11.5L11.5 14.5L16.5 9.5M5 18L3.13036 4.91253C3.05646 4.39524 3.39389 3.91247 3.90398 3.79912L11.5661 2.09641C11.8519 2.03291 12.1481 2.03291 12.4339 2.09641L20.096 3.79912C20.6061 3.91247 20.9435 4.39524 20.8696 4.91252L19 18C18.9293 18.495 18.5 21.5 12 21.5C5.5 21.5 5.07071 18.495 5 18Z"/>',
  refresh:'<path d="M21.8883 13.5C21.1645 18.3113 17.013 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C16.1006 2 19.6248 4.46819 21.1679 8M17 8H21.4C21.7314 8 22 7.73137 22 7.4V3"/>',
  logout:'<path d="M12 12H19M19 12L16 15M19 12L16 9M19 6V5C19 3.89543 18.1046 3 17 3H7C5.89543 3 5 3.89543 5 5V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V18"/>',
  openWindow:'<path d="M21 3H15M21 3L12 12M21 3V9M21 13V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H11"/>',
  check:'<path d="M5 13L9 17L19 7"/>',
  plus:'<path d="M6 12H18M12 6V18"/>',
  key:'<path d="M10 12C10 14.2091 8.20914 16 6 16C3.79086 16 2 14.2091 2 12C2 9.79086 3.79086 8 6 8C8.20914 8 10 9.79086 10 12ZM10 12H22V15M18 12V15"/>',
  trash:'<path d="M20 9L18.005 20.3463C17.8369 21.3026 17.0062 22 16.0353 22H7.96474C6.99379 22 6.1631 21.3026 5.99496 20.3463L4 9M21 6H15.375M3 6H8.625M8.625 6V4C8.625 2.89543 9.52043 2 10.625 2H13.375C14.4796 2 15.375 2.89543 15.375 4V6M8.625 6H15.375"/>',
  xmark:'<path d="M6.75827 17.2426L12.0009 12M17.2435 6.75736L12.0009 12M12.0009 12L6.75827 6.75736M12.0009 12L17.2435 17.2426"/>',
  arrowLeft:'<path d="M21 12H3M3 12L11.5 3.5M3 12L11.5 20.5"/>',
  arrowRight:'<path d="M3 12H21M21 12L12.5 3.5M21 12L12.5 20.5"/>',
  checkCircle:'<path d="M7 12.5L10 15.5L17 8.5M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"/>'
});
function operatorIcon(name){return '<span class="op-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" focusable="false">'+(OPERATOR_ICONOIR[name]||OPERATOR_ICONOIR.check)+'</svg></span>'}
function operatorSemanticIcon(element){
  const text=[element.getAttribute?.('aria-label'),element.getAttribute?.('title'),element.textContent].filter(Boolean).join(' ').trim().toLowerCase(),action=String(element.dataset?.action||'');
  if(action==='refresh'||/uppdatera/.test(text))return'refresh';
  if(action==='logout'||/logga ut/.test(text))return'logout';
  if(action==='close-modal'||/stäng|avbryt/.test(text))return'xmark';
  if(action==='remove-user'||action==='confirm-remove-user'||/ta bort/.test(text))return'trash';
  if(action==='reset-password'||/lösenord/.test(text))return'key';
  if(action==='back-companies'||/alla företag/.test(text))return'arrowLeft';
  if(/skapa|lägg till/.test(text))return'plus';
  if(/spara|godkänn|verifiera|skicka test/.test(text))return'check';
  return'';
}
function decorateOperatorUi(){
  const navIcons={overview:'home',companies:'group',statistics:'stats',security:'shield'};
  document.querySelectorAll('[data-view]').forEach(button=>{
    const label=button.querySelector('.nav-label');if(!label||label.querySelector('.op-icon'))return;
    label.prepend(document.createRange().createContextualFragment(operatorIcon(navIcons[button.dataset.view]||'home')));
  });
  document.querySelectorAll('.customer-system-link').forEach(link=>{if(!link.querySelector('.op-icon'))link.prepend(document.createRange().createContextualFragment(operatorIcon('openWindow')))});
  document.querySelectorAll('.button,.icon-button,button[data-action]').forEach(button=>{
    if(button.querySelector(':scope > .op-icon'))return;const name=operatorSemanticIcon(button);if(!name)return;
    for(const node of [...button.childNodes]){
      if(node.nodeType!==Node.TEXT_NODE)continue;
      const cleaned=String(node.textContent||'').replace(/^\s*(?:←|→|↗|↻|×|✓|\+)\s*/u,'');
      if(cleaned!==node.textContent)node.textContent=cleaned;
    }
    button.prepend(document.createRange().createContextualFragment(operatorIcon(name)));button.classList.add('op-with-icon');
  });
}
function operatorTap(element){
  if(!element||element.disabled||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  element.animate([{transform:'translateY(0) scale(1)'},{transform:'translateY(1px) scale(.97)'},{transform:'translateY(0) scale(1)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
}
document.addEventListener('pointerdown',event=>{const target=event.target.closest('.button,.icon-button,.side-nav button,.mobile-nav button,.customer-system-link,.click-row');if(target)operatorTap(target)},{passive:true});
new MutationObserver(()=>decorateOperatorUi()).observe(document.documentElement,{childList:true,subtree:true});

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
function memberRoleBars(detail){
  const roles={admin:0,accountant:0,approver:0,readonly:0};
  for(const member of detail?.members||[])if(Object.hasOwn(roles,member.role))roles[member.role]+=1;
  const total=Object.values(roles).reduce((sum,value)=>sum+value,0),max=Math.max(1,...Object.values(roles));
  return ['admin','accountant','approver','readonly'].map(role=>`<div class="role-row"><div><strong>${roleLabel(role)}</strong><span>${num(roles[role])} · ${percent(roles[role],total)}%</span></div><meter min="0" max="${max}" value="${roles[role]}"></meter></div>`).join('');
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
    <div class="login-brand"><div class="mark"><span class="mark-icon"></span><span>LT STUDIO</span></div><div><span class="login-kicker">ADMIN CONTROL CENTER</span><h1>Allt viktigt.<br>På ett ställe.</h1><p>Administrera kundföretag, användare, behörigheter, statistik och drift från en separat, MFA-skyddad LT Studio-portal.</p></div><small>Separat LT Studio-inloggning · MFA · spårbar administratörslogg</small></div>
    <div class="login-panel"><form class="card login-card" id="login-form"><div class="login-card-mark"><span class="mark-icon"></span></div><h2>LT Studio-inloggning</h2><p>Logga in med ert separata operatörskonto.</p>
      <label class="field"><span>Användarnamn</span><input name="username" autocomplete="username" required></label>
      <label class="field"><span>Lösenord</span><input name="password" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>MFA-kod</span><input name="totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
      <button class="button full-button" type="submit">Logga in</button>
      ${errorMessage?`<div class="error">${esc(errorMessage)}</div>`:''}
    </form></div>
  </section>`;
}
function readinessState(){if(!readiness)return{label:'Laddar',kind:'warning'};return readiness.ok?{label:'OK',kind:'ok'}:{label:'Varning',kind:'critical'}}
function securityState(){
  const critical=Number(securityMonitor?.counts?.critical||overview?.security?.critical||0),warning=Number(securityMonitor?.counts?.warning||overview?.security?.warning||0);
  if(critical)return{label:`${critical} kritiska`,kind:'critical'};
  if(warning)return{label:`${warning} varningar`,kind:'warning'};
  return{label:'Inga aktiva flaggor',kind:'ok'};
}
function securityBadgeMarkup(){
  const critical=Number(securityMonitor?.counts?.critical||0),warning=Number(securityMonitor?.counts?.warning||0);
  if(critical)return `<span class="nav-badge critical" data-security-badge aria-hidden="true">${critical}</span>`;
  if(warning)return `<span class="nav-badge warning" data-security-badge aria-hidden="true">${warning}</span>`;
  return '<span class="nav-badge ok" data-security-badge aria-hidden="true">aktiv</span>';
}
function securityAlertStrip(){
  const counts=securityMonitor?.counts||{};
  const critical=Number(counts.critical||0),warning=Number(counts.warning||0);
  if(!critical&&!warning)return '';
  const tone=critical?'critical':'warning',count=critical||warning;
  const label=critical?`${count} kritisk${count===1?'':'a'} säkerhetsflagga${count===1?'':'r'}`:`${count} säkerhetsvarning${count===1?'':'ar'}`;
  return `<button class="security-live-alert ${tone}" type="button" data-view="security"><span class="security-pulse" aria-hidden="true"></span><strong>${esc(label)}</strong><span>Öppna Säkerhetsportalen för detaljer</span>${operatorIcon('arrowRight')}</button>`;
}
function updateSecurityChrome(){
  document.querySelectorAll('[data-security-badge]').forEach(node=>{
    const holder=document.createElement('div');holder.innerHTML=securityBadgeMarkup();const next=holder.firstElementChild;if(next)node.replaceWith(next);
  });
  const live=document.getElementById('security-live-alert');if(live)live.innerHTML=securityAlertStrip();
}
function securityFindings(){
  const findings=securityMonitor?.findings||[];
  if(!findings.length)return `<div class="security-clear live-clear"><span class="clear-check" aria-hidden="true">${operatorIcon('checkCircle')}</span><div><strong>Inga aktiva säkerhetsflaggor</strong><p>Senaste skanningen hittade inga regler som kräver åtgärd.</p></div></div>`;
  return `<div class="finding-list">${findings.map(item=>`<article class="security-finding ${esc(item.severity)}"><div class="finding-top"><span class="status-pill"><span class="dot ${esc(item.severity)}"></span>${esc(({critical:'Kritisk',warning:'Varning',info:'Information'})[item.severity]||item.severity)}</span><span class="finding-category">${esc(item.category)}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.message)}</p></article>`).join('')}</div>`;
}
function modalMarkup(){
  if(!modal)return '';
  if(modal.kind==='password')return `<div class="modal-backdrop" data-modal-backdrop><section class="modal-card portal-modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><span class="eyebrow">SÄKER ÅTGÄRD</span><h2 id="modal-title">Byt lösenord</h2><p>${esc(modal.userName)}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Stäng">×</button></div><form id="reset-password-form"><label class="field"><span>Nytt tillfälligt lösenord</span><input name="password" type="password" required minlength="8" autocomplete="new-password" autofocus></label><p class="form-help">Minst 8 tecken, stor och liten bokstav samt minst en siffra eller ett specialtecken. Lösenordet gäller hela personens konto i alla företag där kontot har åtkomst, och alla tidigare sessioner avslutas efter bytet.</p><div class="modal-actions"><button class="button secondary" type="button" data-action="close-modal">Avbryt</button><button class="button" type="submit">Spara nytt lösenord</button></div></form></section></div>`;
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
  const items=[['overview','Översikt'],['companies','Kunder & företag'],['statistics','Statistik'],['security','Säkerhetsportal']];
  return items.map(([id,label])=>`<button class="${view===id?'active':''}" data-view="${id}"><span class="nav-label">${label}</span>${id==='security'?securityBadgeMarkup():''}</button>`).join('');
}
function shell(body,title,subtitle){
  const operator=session?.operator||{};
  root.innerHTML=`<div class="operator-shell"><aside class="sidebar"><div><div class="mark"><span class="mark-icon"></span><span>LT STUDIO</span></div><div class="side-copy">ADMIN CONTROL CENTER</div></div><nav class="side-nav">${nav()}</nav><a class="customer-system-link" href="/portal/" target="_blank" rel="noopener"><span><strong>Öppna kundsystemet</strong><small>UAT på samma webbplats</small></span></a><div class="side-spacer"></div><div class="side-status"><span class="live-dot"></span><div><strong>Operatorportal aktiv</strong><small>Separat säkerhetsgräns</small></div></div><div class="side-footer">Endast LT Studio-operatörer.<br>Alla administrativa ändringar loggas.</div></aside>
  <section class="main"><header class="topbar"><div><span class="page-kicker">LT STUDIO / ADMIN</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions"><div class="operator-user"><span class="avatar">${initials(operator.displayName)}</span><div><strong>${esc(operator.displayName||operator.username||'Operatör')}</strong><small>LT Studio-operatör</small></div></div><button class="icon-button" data-action="refresh" title="Uppdatera" aria-label="Uppdatera"></button><button class="button secondary" data-action="logout">Logga ut</button></div></header><nav class="mobile-nav">${nav()}</nav>
  <div id="security-live-alert">${securityAlertStrip()}</div>${errorMessage?`<div class="notice">${esc(errorMessage)}</div>`:''}${successNotice()}${body}<footer class="portal-footer"><span>LT Studio Admin</span><span>Senast uppdaterad ${dateTime(overview?.generatedAt)}</span></footer></section></div>${modalMarkup()}`;
}
function filteredCompanies(){
  const query=companyQuery.trim().toLocaleLowerCase('sv');
  const rows=(overview?.companies||[]).filter(company=>{
    const matchesText=!query||[company.displayName,company.legalName,company.orgNumber].some(value=>String(value||'').toLocaleLowerCase('sv').includes(query));
    const matchesStatus=companyStatus==='all'||(companyStatus==='active'&&company.accessConfigured)||(companyStatus==='unconfigured'&&!company.accessConfigured);
    return matchesText&&matchesStatus;
  });
  return rows.sort((a,b)=>{
    if(companySort==='users')return Number(b.memberCount||0)-Number(a.memberCount||0);
    if(companySort==='invoices')return Number(b.invoiceRecordCount||0)-Number(a.invoiceRecordCount||0);
    if(companySort==='activity')return String(b.lastActivityAt||'').localeCompare(String(a.lastActivityAt||''));
    return String(a.displayName||'').localeCompare(String(b.displayName||''),'sv');
  });
}
function companySearchSuggestions(){
  if(!companyQuery.trim())return[];
  return filteredCompanies().slice(0,8);
}
function companySearchResults(){
  const rows=companySearchSuggestions();
  if(!rows.length)return '<div class="company-search-empty">Inga företag matchar sökningen.</div>';
  return rows.map((company,index)=>`<button type="button" class="company-search-option ${index===companySearchActiveIndex?'active':''}" role="option" aria-selected="${index===companySearchActiveIndex?'true':'false'}" data-company-search-id="${esc(company.id)}"><span class="company-avatar">${initials(company.displayName)}</span><span class="company-search-copy"><strong>${esc(company.displayName)}</strong><small>${esc(company.legalName||company.displayName)} · ${esc(company.orgNumber||'Org.nr saknas')}</small></span><span class="company-search-meta">${num(company.memberCount)} anv.</span></button>`).join('');
}
function updateCompanySearchDropdown(){
  const field=document.querySelector('[data-company-search]'),results=document.getElementById('operator-company-search-results');
  if(!field||!results)return;
  const open=Boolean(companySearchOpen&&companyQuery.trim());
  field.setAttribute('aria-expanded',open?'true':'false');
  results.hidden=!open;
  if(open)results.innerHTML=companySearchResults();
}
function closeCompanySearch(){
  companySearchOpen=false;companySearchActiveIndex=-1;
  const field=document.querySelector('[data-company-search]'),results=document.getElementById('operator-company-search-results');
  field?.setAttribute('aria-expanded','false');if(results)results.hidden=true;
}
function updateCompanyTable(){
  const tbody=document.getElementById('company-table-body'),count=document.getElementById('company-result-count');
  const rows=filteredCompanies();
  if(tbody)tbody.innerHTML=companyRows(rows);
  if(count)count.textContent=`${rows.length} av ${overview?.companyCount||0} företag`;
  updateCompanySearchDropdown();
}
function companyRows(source){
  const rows=source||overview?.companies||[];
  if(!rows.length)return '<tr><td colspan="7" class="empty">Inga företag matchar filtret.</td></tr>';
  return rows.map(company=>{
    const access=company.accessConfigured?'<span class="status-pill"><span class="dot ok"></span>Aktiv</span>':'<span class="status-pill"><span class="dot warning"></span>Saknar användare</span>';
    return `<tr class="click-row" data-company-id="${esc(company.id)}" tabindex="0" role="button"><td><div class="company-cell"><span class="company-avatar">${initials(company.displayName)}</span><div><strong>${esc(company.displayName)}</strong><small>${esc(company.legalName)}</small></div></div></td><td>${esc(company.orgNumber||'—')}</td><td>${company.memberCount}</td><td>${access}</td><td>${company.activeSessionCount}</td><td>${company.invoiceRecordCount}</td><td>${dateTime(company.lastActivityAt)}</td></tr>`;
  }).join('');
}
function ageLabel(minutes){
  if(minutes===null||minutes===undefined||!Number.isFinite(Number(minutes)))return 'Ej tillgängligt';
  const value=Math.max(0,Number(minutes));
  if(value<60)return `${Math.floor(value)} min`;
  if(value<1440)return `${Math.floor(value/60)} h`;
  return `${Math.floor(value/1440)} d`;
}
const SECURITY_READINESS=Object.freeze([
  {key:'databaseRead',label:'Databas · läsning',action:'Kontrollera databasens åtkomst och integritet innan kunddata används.'},
  {key:'databaseWrite',label:'Databas · skrivning',action:'Kontrollera skrivlås, diskutrymme och databasens filrättigheter.'},
  {key:'diskSpace',label:'Ledigt diskutrymme',detail:'freeMiB',action:'Frigör eller utöka lagringsutrymmet innan kapaciteten blir kritisk.'},
  {key:'platformAdmin',label:'LT Studio global admin',action:'Säkerställ minst ett aktivt globaladmin-konto med fungerande MFA.'},
  {key:'backup',label:'Lokal backup',age:'backupAgeMinutes',action:'Kör och verifiera en ny lokal backup med giltig kontrollsumma.'},
  {key:'offsiteBackup',label:'Extern backup',age:'offsiteBackupAgeMinutes',action:'Verifiera senaste offsite-backup och dess evidens.'},
  {key:'r2StagingAudit',label:'R2 · privata objekt',age:'r2StagingAuditAgeMinutes',action:'Kör R2-auditen och kontrollera att alla privata objekt kan verifieras.'},
  {key:'restoreDrill',label:'Restore-test',age:'restoreDrillAgeMinutes',action:'Genomför och dokumentera ett nytt återställningstest.'},
  {key:'r2RestoreDrill',label:'R2 · restore-test',age:'r2RestoreDrillAgeMinutes',action:'Genomför ett nytt restore-test mot privat objektlagring.'},
  {key:'stagingEvidenceConsistent',label:'Staging · evidenskedja',action:'Kontrollera att staging-bevisen kommer från samma verifierade datamängd.'},
  {key:'auditAnchor',label:'Audit · externt ankare',age:'auditAnchorAgeMinutes',action:'Skapa och verifiera ett nytt externt audit-ankare.'},
  {key:'alertDelivery',label:'Externa säkerhetslarm',age:'alertDeliveryTestAgeMinutes',action:'Konfigurera den externa webhook-kanalen och skicka ett nytt testlarm från LT Studio-admin.'},
  {key:'monitoring',label:'Extern monitoring',age:'monitoringAgeMinutes',action:'Verifiera extern monitoring och att senaste larmtestet fungerar.'}
]);
function readinessEntries(){
  const checks=readiness?.checks&&typeof readiness.checks==='object'?readiness.checks:{};
  return SECURITY_READINESS.map(item=>{
    const value=checks[item.key],known=typeof value==='boolean',ok=value===true;
    let evidence='—';
    if(item.age)evidence=ageLabel(readiness?.[item.age]);
    if(item.detail==='freeMiB'&&readiness?.freeMiB!==null&&readiness?.freeMiB!==undefined)evidence=`${num(readiness.freeMiB)} MiB ledigt`;
    if(item.key==='monitoring'&&readiness?.alertTestAgeMinutes!==null&&readiness?.alertTestAgeMinutes!==undefined)evidence+=` · larmtest ${ageLabel(readiness.alertTestAgeMinutes)}`;
    return {...item,known,ok,state:known?(ok?'OK':'Problem'):'Saknas',kind:known?(ok?'ok':'critical'):'warning',evidence};
  });
}
function readinessChecks(){
  return readinessEntries().map(item=>`<div class="health-row"><div class="health-name"><span class="health-dot ${item.kind}"></span><strong>${esc(item.label)}</strong></div><span class="health-line"></span><span class="status-pill"><span class="dot ${item.kind}"></span>${item.state}</span></div>`).join('');
}
function securityReadinessTable(){
  return readinessEntries().map(item=>`<tr><td><div class="security-check-name"><span class="health-dot ${item.kind}"></span><strong>${esc(item.label)}</strong></div></td><td><span class="status-pill"><span class="dot ${item.kind}"></span>${item.state}</span></td><td>${esc(item.evidence)}</td><td class="security-action-copy">${esc(item.ok?'Ingen åtgärd krävs just nu.':item.action)}</td></tr>`).join('');
}
function unresolvedSecurityActions(){
  const items=readinessEntries().filter(item=>!item.ok);
  if(!items.length)return '<div class="security-clear"><span class="health-dot ok"></span><div><strong>Inga kända driftblockerare</strong><p>Alla rapporterade tekniska kontroller är godkända just nu.</p></div></div>';
  return items.map(item=>`<div class="security-action"><span class="health-dot ${item.kind}"></span><div><strong>${esc(item.label)}</strong><p>${esc(item.action)}</p></div></div>`).join('');
}
function securityEventLabel(kind){
  const key=String(kind||'');
  const known={
    LOGIN_FAILURE_THRESHOLD:'Många felaktiga kundinloggningar',
    ACCOUNT_LOGIN_FAILURE_THRESHOLD:'Upprepade felaktiga inloggningar för ett kundkonto',
    OPERATOR_LOGIN_FAILURE_THRESHOLD:'Många felaktiga LT Studio-admininloggningar',
    OPERATOR_ACCOUNT_LOGIN_FAILURE_THRESHOLD:'Upprepade felaktiga admininloggningar för ett LT Studio-konto'
  };
  if(known[key])return known[key];
  const fallback=key.replaceAll('_',' ').toLocaleLowerCase('sv')||'säkerhetshändelse';
  return fallback.charAt(0).toLocaleUpperCase('sv')+fallback.slice(1);
}
function securityCompanyOptions(){
  const companies=overview?.companies||[];
  return ['<option value="all" '+(securityCompany==='all'?'selected':'')+'>Alla företag</option>','<option value="platform" '+(securityCompany==='platform'?'selected':'')+'>Plattformsnivå</option>',...companies.map(company=>`<option value="${esc(company.id)}" ${securityCompany===company.id?'selected':''}>${esc(company.displayName)}</option>`)].join('');
}
function incidentStatusLabel(status){
  return ({new:'Ny',reviewed:'Granskad',investigating:'Utreds',resolved:'Åtgärdad'})[String(status||'new')]||'Ny';
}
function incidentStatusOptions(selected){
  return ['new','reviewed','investigating','resolved'].map(status=>`<option value="${status}" ${selected===status?'selected':''}>${incidentStatusLabel(status)}</option>`).join('');
}
function incidentMeta(event){
  const status=event.incidentStatus||'new';
  if(status==='new')return 'Inte granskad ännu';
  const who=event.incidentUpdatedBy?` av ${event.incidentUpdatedBy}`:'';
  const when=event.incidentUpdatedAt?` · ${dateTime(event.incidentUpdatedAt)}`:'';
  return `${incidentStatusLabel(status)}${who}${when}`;
}
function filteredSecurityEvents(){
  const events=security?.events||[];
  const hours=securityPeriod==='24h'?24:securityPeriod==='7d'?24*7:securityPeriod==='30d'?24*30:null;
  const cutoff=hours===null?null:Date.now()-hours*60*60*1000;
  return events.filter(event=>{
    if(securitySeverity!=='all'&&event.severity!==securitySeverity)return false;
    if(securityIncidentStatus!=='all'&&(event.incidentStatus||'new')!==securityIncidentStatus)return false;
    if(securityCompany==='platform'&&event.companyId)return false;
    if(!['all','platform'].includes(securityCompany)&&event.companyId!==securityCompany)return false;
    if(cutoff===null)return true;
    const time=new Date(event.createdAt).getTime();
    return Number.isFinite(time)&&time>=cutoff;
  });
}
function securityEvents(){
  const events=filteredSecurityEvents();
  if(!events.length)return '<div class="empty">Inga säkerhetshändelser matchar filtret.</div>';
  return events.map(event=>{
    const incidentStatus=event.incidentStatus||'new';
    return `<div class="event security-event" data-security-event-row="${esc(event.id)}"><span class="status-pill"><span class="dot ${esc(event.severity)}"></span>${esc(({critical:'Kritisk',warning:'Varning',info:'Information'})[event.severity]||event.severity)}</span><div class="event-copy"><strong>${esc(securityEventLabel(event.kind))}</strong><small>${esc(event.companyName||'Plattformsnivå')} · ${esc(incidentMeta(event))}</small></div><label class="incident-state-control"><span>Incidentstatus</span><select data-incident-status data-security-event-id="${esc(event.id)}">${incidentStatusOptions(incidentStatus)}</select></label><time>${dateTime(event.createdAt)}</time></div>`;
  }).join('');
}
function operatorAuditLabel(action){
  return ({
    OPERATOR_SESSION_LOGIN:'Operatör loggade in',
    OPERATOR_SESSION_LOGOUT:'Operatör loggade ut',
    CUSTOMER_USER_CREATED:'Användare skapades',
    CUSTOMER_EXISTING_USER_ADDED:'Befintlig användare fick åtkomst',
    CUSTOMER_USER_ROLE_CHANGED:'Behörighet ändrades',
    CUSTOMER_USER_PASSWORD_RESET:'Lösenord byttes',
    CUSTOMER_USER_REMOVED:'Åtkomst togs bort',
    SECURITY_INCIDENT_STATUS_CHANGED:'Incidentstatus ändrades',
    SECURITY_ALERT_DELIVERY_SUCCEEDED:'Säkerhetslarm levererades',
    SECURITY_ALERT_DELIVERY_FAILED:'Säkerhetslarm kunde inte levereras'
  })[String(action||'')]||'Administrativ åtgärd';
}
function operatorAuditDetail(event){
  if(event.action==='CUSTOMER_USER_ROLE_CHANGED'&&event.beforeRole&&event.afterRole)return `${roleLabel(event.beforeRole)} → ${roleLabel(event.afterRole)}`;
  if(event.action==='SECURITY_INCIDENT_STATUS_CHANGED'&&event.beforeStatus&&event.afterStatus)return `${incidentStatusLabel(event.beforeStatus)} → ${incidentStatusLabel(event.afterStatus)}`;
  if(String(event.action||'').startsWith('SECURITY_ALERT_')){
    const kind=event.alertTest?'Testlarm':(event.alertSeverity==='critical'?'Kritiskt larm':'Säkerhetslarm');
    const result=event.alertResult==='delivered'?'Levererat':'Misslyckades';
    return `${kind} · ${result}`;
  }
  if(event.role)return roleLabel(event.role);
  return event.targetUserName||'—';
}
function operatorAuditRows(){
  const events=operatorAudit?.events||[];
  if(!events.length)return '<div class="empty">Inga operatörsåtgärder i loggen.</div>';
  return events.map(event=>`<div class="audit-row"><span class="audit-icon" aria-hidden="true">◎</span><div><strong>${esc(operatorAuditLabel(event.action))}</strong><p>${esc(event.operatorName)} · ${esc(event.companyName||'Plattformsnivå')}</p></div><span class="audit-detail">${esc(operatorAuditDetail(event))}</span><time>${dateTime(event.createdAt)}</time></div>`).join('');
}
function overviewView(){
  const totals=overview?.totals||{},companies=overview?.companies||[],ready=readinessState(),sec=securityState();
  const configuredPct=percent(totals.configuredCompanies,overview?.companyCount||0),activePct=percent(totals.activeCompanies30d,overview?.companyCount||0),health=readinessScore(),mfaPct=percent(totals.mfaProtectedUsers,totals.activeUsers);
  shell(`<section class="hero-dashboard">
    <div class="hero-copy"><span class="eyebrow">PLATTFORMSLÄGE</span><h2>Kontroll över hela kundbasen.</h2><p>En samlad bild av användning, kundaktivitet, drift och säkerhet — utan att öppna kundernas ekonomiska detaljdata.</p><div class="hero-badges"><span><i class="dot ${ready.kind}"></i> Drift: ${ready.label}</span><span><i class="dot ${sec.kind}"></i> Säkerhet 24 h: ${sec.label}</span></div></div>
    <div class="hero-gauges">${ringGauge(health,'Drift','Godkända tekniska hälsokontroller.')}${ringGauge(configuredPct,'Aktivering','Företag med minst en aktiv användare.')}${ringGauge(mfaPct,'MFA',`${totals.mfaProtectedUsers||0} av ${totals.activeUsers||0} aktiva användare har MFA.`)}</div>
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
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">KUNDBAS</span><h2>Aktiveringsgrad</h2><p>Företag med minst en aktiv användare.</p></div></div><div class="instrument-pad">${ringGauge(configuredPct,'Aktiva',`${totals.configuredCompanies||0} av ${overview?.companyCount||0} företag har minst en aktiv användare.`)}</div></article>
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
  <section class="panel"><div class="panel-head company-panel-head"><div><span class="eyebrow">FÖRETAG</span><h2>Alla kunder & företag</h2><p>Öppna ett företag för användare, behörigheter och statistik.</p></div><span class="panel-stat" id="company-result-count">${filteredCompanies().length} av ${overview?.companyCount||0} företag</span></div>
  <div class="company-toolbar"><div class="company-search-shell"><label class="search-field"><span class="sr-only">Sök företag</span><input type="search" role="combobox" aria-autocomplete="list" aria-controls="operator-company-search-results" aria-expanded="${companySearchOpen&&companyQuery.trim()?'true':'false'}" autocomplete="off" data-company-search value="${esc(companyQuery)}" placeholder="Sök namn eller organisationsnummer…"></label><div id="operator-company-search-results" class="company-search-results" role="listbox" ${companySearchOpen&&companyQuery.trim()?'':'hidden'}>${companySearchOpen&&companyQuery.trim()?companySearchResults():''}</div></div><label><span class="sr-only">Filtrera status</span><select data-company-filter><option value="all" ${companyStatus==='all'?'selected':''}>Alla statusar</option><option value="active" ${companyStatus==='active'?'selected':''}>Aktiverade</option><option value="unconfigured" ${companyStatus==='unconfigured'?'selected':''}>Saknar användare</option></select></label><label><span class="sr-only">Sortera företag</span><select data-company-sort><option value="name" ${companySort==='name'?'selected':''}>Sortera: namn</option><option value="users" ${companySort==='users'?'selected':''}>Flest användare</option><option value="invoices" ${companySort==='invoices'?'selected':''}>Flest fakturor</option><option value="activity" ${companySort==='activity'?'selected':''}>Senast aktiva</option></select></label></div>
  <div class="table-wrap"><table><thead><tr><th>Företag</th><th>Org.nr</th><th>Användare</th><th>Status</th><th>Sessioner</th><th>Fakturor</th><th>Senaste aktivitet</th></tr></thead><tbody id="company-table-body">${companyRows(filteredCompanies())}</tbody></table></div></section>`,'Kunder & företag','Central administration för varje kundmiljö.');
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
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">KONTOKVALITET</span><h2>Aktivering & konto-status</h2><p>Översikt över hur färdig kundbasen är.</p></div></div><div class="stat-stack"><div><span>Företag med aktiv användare</span><strong>${percent(totals.configuredCompanies,overview?.companyCount)}%</strong><meter min="0" max="100" value="${percent(totals.configuredCompanies,overview?.companyCount)}"></meter></div><div><span>Aktiva företag senaste 30 dagar</span><strong>${percent(totals.activeCompanies30d,overview?.companyCount)}%</strong><meter min="0" max="100" value="${percent(totals.activeCompanies30d,overview?.companyCount)}"></meter></div><div><span>Inaktiverade användarkonton</span><strong>${num(totals.disabledUsers)}</strong><small>konton</small></div></div></article>
  </section>
  <section class="panel"><div class="panel-head"><div><span class="eyebrow">DETALJER</span><h2>Företagsstatistik</h2><p>Operativ metadata utan fakturainnehåll eller ekonomiska belopp.</p></div></div><div class="table-wrap"><table><thead><tr><th>Företag</th><th>Användare</th><th>Kunder</th><th>Fakturor</th><th>Sessioner</th><th>Senaste aktivitet</th></tr></thead><tbody>${companies.map(c=>`<tr class="click-row" data-company-id="${esc(c.id)}" tabindex="0" role="button"><td><div class="company-cell"><span class="company-avatar">${initials(c.displayName)}</span><strong>${esc(c.displayName)}</strong></div></td><td>${c.memberCount}</td><td>${c.customerRecordCount}</td><td>${c.invoiceRecordCount}</td><td>${c.activeSessionCount}</td><td>${dateTime(c.lastActivityAt)}</td></tr>`).join('')}</tbody></table></div></section>`,'Statistik','Mätbara nyckeltal och trender för hela LT Studio-plattformen.');
}
function securityView(){
  const totals=overview?.totals||{},mfaPct=percent(totals.mfaProtectedUsers,totals.activeUsers),entries=readinessEntries(),known=entries.filter(item=>item.known),okCount=known.filter(item=>item.ok).length,events=filteredSecurityEvents(),monitor=securityMonitor||{},counts=monitor.counts||{};
  const critical=events.filter(event=>event.severity==='critical').length,warning=events.filter(event=>event.severity==='warning').length,latest=events[0]?.createdAt||null;
  const monitorTone=monitor.status==='critical'?'critical':monitor.status==='attention'?'warning':'ok';
  const alerts=securityAlerts||{},alertTone=!alerts.configured?'warning':alerts.lastTestSucceeded?'ok':'critical';
  const alertLabel=!alerts.configured?'Inte konfigurerad':alerts.lastTestSucceeded?'Verifierad':'Test krävs';
  const alertDeliveryLabel=alerts.lastDeliveryStatus==='delivered'?'Levererad':alerts.lastDeliveryStatus==='failed'?'Misslyckad':'Ingen leverans ännu';
  shell(`<section class="security-hero security-hero-live active-security-hero"><div><span class="eyebrow">AKTIV SÄKERHETSÖVERVAKNING</span><h2>Systemet söker löpande efter risker och fel.</h2><p>Säkerhetsmotorn kör på servern även när den här sidan inte är öppen. Portalen hämtar nya flaggor automatiskt ungefär var ${num(monitor.scanIntervalSeconds||30)} sekund.</p><div class="monitor-live"><span class="live-dot ${monitorTone}"></span><strong>Aktiv övervakning</strong><span>Senast skannad ${dateTime(monitor.checkedAt)}</span></div></div><div class="security-snapshot"><div><span>Aktiva flaggor</span><strong class="${monitorTone}">${num(counts.total)}</strong><small>${num(counts.critical)} kritiska · ${num(counts.warning)} varningar</small></div><div><span>MFA-täckning</span><strong>${mfaPct}%</strong><small>${totals.mfaProtectedUsers||0} av ${totals.activeUsers||0} aktiva användare</small></div></div></section>
  <section class="status-grid"><article class="metric"><span>Readiness</span><strong class="${readiness?.ok?'ok':'critical'}">${readiness?.ok?'OK':'Åtgärd krävs'}</strong><small>samlad teknisk gate</small></article><article class="metric"><span>Kritiska händelser</span><strong class="critical">${num(critical)}</strong><small>i valt tidsfilter</small></article><article class="metric"><span>Varningar</span><strong class="warning">${num(warning)}</strong><small>i valt tidsfilter</small></article><article class="metric"><span>Senaste händelse</span><strong class="small-value">${esc(dateTime(latest))}</strong><small>bland senast hämtade händelser</small></article></section>
  <section class="panel findings-panel"><div class="panel-head"><div><span class="eyebrow">AKTIVA FLAGGOR</span><h2>Det här behöver er uppmärksamhet</h2><p>Fynd från readiness, autentisering, MFA och nya säkerhetshändelser. Inga hemligheter eller råa tekniska detaljer visas.</p></div><span class="panel-stat ${monitorTone}">${monitor.active===false?'Skanning fel':'Live'}</span></div>${securityFindings()}</section>
  <section class="panel"><div class="panel-head"><div><span class="eyebrow">EXTERNA LARM</span><h2>Webhook för säkerhetslarm</h2><p>Kanalen skickar endast dataminimerade säkerhetsfält. Webhook-adress och token visas aldrig i portalen eller audit-loggen.</p></div><span class="panel-stat ${alertTone}">${esc(alertLabel)}</span></div><div class="security-action"><span class="health-dot ${alertTone}"></span><div><strong>${alerts.configured?'HTTPS-webhook är konfigurerad':'Webhook saknas i runtime-konfigurationen'}</strong><p>Senaste test: ${esc(dateTime(alerts.lastTestAt))} · Senaste leverans: ${esc(alertDeliveryLabel)}.</p></div><button class="button" type="button" data-action="test-security-alert" ${alerts.configured?'':'disabled'}>Skicka testlarm</button></div></section>
  <section class="panel security-readiness-panel"><div class="panel-head"><div><span class="eyebrow">SKYDD & DRIFT</span><h2>Hälsokontroller och verifieringsbevis</h2><p>Databas, backup, R2, restore, monitoring, audit-ankare och global admin. Bevisålder visas där backend har verifierbar evidens.</p></div><span class="panel-stat ${readiness?.ok?'ok':'critical'}">${okCount} av ${known.length||entries.length} OK</span></div><div class="table-wrap"><table class="security-check-table"><thead><tr><th>Kontroll</th><th>Status</th><th>Senaste bevis</th><th>Rekommenderad åtgärd</th></tr></thead><tbody>${securityReadinessTable()}</tbody></table></div></section>
  <section class="dashboard-grid equal security-lower-grid">
    <article class="panel dashboard-panel"><div class="panel-head security-events-head"><div><span class="eyebrow">INCIDENTER</span><h2>Säkerhetshändelser</h2><p>Redigerad logg utan IP-adresser, fingeravtryck eller hemliga tekniska detaljer. Filtren gäller de senast hämtade händelserna.</p></div></div><div class="security-toolbar"><label><span>Allvarlighetsgrad</span><select data-security-severity><option value="all" ${securitySeverity==='all'?'selected':''}>Alla</option><option value="critical" ${securitySeverity==='critical'?'selected':''}>Kritisk</option><option value="warning" ${securitySeverity==='warning'?'selected':''}>Varning</option><option value="info" ${securitySeverity==='info'?'selected':''}>Information</option></select></label><label><span>Tidsperiod</span><select data-security-period><option value="24h" ${securityPeriod==='24h'?'selected':''}>24 timmar</option><option value="7d" ${securityPeriod==='7d'?'selected':''}>7 dagar</option><option value="30d" ${securityPeriod==='30d'?'selected':''}>30 dagar</option><option value="all" ${securityPeriod==='all'?'selected':''}>Alla hämtade</option></select></label><label><span>Företag</span><select data-security-company>${securityCompanyOptions()}</select></label><label><span>Incidentstatus</span><select data-security-incident-filter><option value="all" ${securityIncidentStatus==='all'?'selected':''}>Alla statusar</option><option value="new" ${securityIncidentStatus==='new'?'selected':''}>Ny</option><option value="reviewed" ${securityIncidentStatus==='reviewed'?'selected':''}>Granskad</option><option value="investigating" ${securityIncidentStatus==='investigating'?'selected':''}>Utreds</option><option value="resolved" ${securityIncidentStatus==='resolved'?'selected':''}>Åtgärdad</option></select></label><span class="security-filter-count">${num(events.length)} händelser</span></div><div class="event-list" id="security-event-list">${securityEvents()}</div></article>
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">ÅTGÄRDSLISTA</span><h2>Det som behöver uppmärksamhet</h2><p>Konkreta rekommendationer från kontroller som inte rapporterar OK.</p></div></div><div class="security-actions">${unresolvedSecurityActions()}</div><div class="security-privacy-note"><strong>Dataminimerad vy</strong><p>Säkerhetsportalen visar inte lösenord, MFA-hemligheter, IP-adresser, kundernas dokument eller ekonomiska detaljdata.</p></div></article>
  </section>
  <section class="panel operator-audit-panel"><div class="panel-head"><div><span class="eyebrow">OPERATÖRER</span><h2>Administratörslogg</h2><p>Read-only historik över vad LT Studio-operatörer har gjort. Endast nödvändig företags-, användar- och rollmetadata visas.</p></div><span class="panel-stat ${operatorAudit?.unavailable?'warning':''}">${operatorAudit?.unavailable?'Tillfälligt otillgänglig':num(operatorAudit?.events?.length||0)+' loggposter'}</span></div><div class="audit-list">${operatorAudit?.unavailable?'<div class="empty">Administratörsloggen kunde inte läsas just nu. Övriga adminfunktioner påverkas inte.</div>':operatorAuditRows()}</div></section>`,'Säkerhetsportal','Aktiv risk- och felövervakning för hela LT Studio-plattformen.');
}
function globalAdminRows(detail){
  const admins=detail.platformAdmins||[];
  if(!admins.length)return '<tr><td colspan="4" class="empty">Inga LT Studio-globaladmins är registrerade.</td></tr>';
  return admins.map(admin=>{
    const status=admin.disabled?'<span class="status-pill"><span class="dot critical"></span>Inaktiv</span>':'<span class="status-pill"><span class="dot ok"></span>Aktiv</span>';
    const mfa=admin.mfaConfigured?'<span class="status-pill"><span class="dot ok"></span>MFA konfigurerad</span>':'<span class="status-pill"><span class="dot critical"></span>MFA saknas</span>';
    return `<tr><td><div class="company-cell"><span class="company-avatar user">${initials(admin.displayName)}</span><div><strong>${esc(admin.displayName)}</strong><small>${esc(admin.username)}</small></div></div></td><td>${status}</td><td>${mfa}</td><td><span class="status-pill"><span class="dot ok"></span>Alla företag</span></td></tr>`;
  }).join('');
}
function memberRows(detail){
  return (detail.members||[]).map(m=>{
    const status=m.disabled?'<span class="status-pill"><span class="dot critical"></span>Inaktiv</span>':'<span class="status-pill"><span class="dot ok"></span>Aktiv</span>';
    const roleControl=m.platformAdmin
      ?`<div><span class="status-pill"><span class="dot ok"></span>LT Studio global admin</span><small>Lokalt medlemskap: ${esc(roleLabel(m.role))}</small></div>`
      :`<select data-role-user="${esc(m.userId)}">${['admin','accountant','approver','readonly'].map(r=>`<option value="${r}" ${m.role===r?'selected':''}>${roleLabel(r)}</option>`).join('')}</select>`;
    const actions=m.platformAdmin
      ?'<span class="status-pill"><span class="dot warning"></span>Global åtkomst styrs separat</span>'
      :`<div class="row-actions"><button class="button secondary small" data-action="reset-password" data-user-id="${esc(m.userId)}" data-user-name="${esc(m.displayName)}">Byt lösenord</button><button class="button danger small" data-action="remove-user" data-user-id="${esc(m.userId)}" data-user-name="${esc(m.displayName)}">Ta bort åtkomst</button></div>`;
    return `<tr><td><div class="company-cell"><span class="company-avatar user">${initials(m.displayName)}</span><div><strong>${esc(m.displayName)}</strong><small>${esc(m.username)}</small></div></div></td><td>${roleControl}</td><td>${status}</td><td>${actions}</td></tr>`;
  }).join('')||'<tr><td colspan="4" class="empty">Inga användare i företaget.</td></tr>';
}
function companyDetailView(detail){
  selectedCompany=detail;
  const c=detail.company,s=detail.stats||{},memberCount=Number(s.memberCount||0);
  const userActivity=memberCount?Math.min(100,Math.round(Number(s.activeSessionCount||0)/memberCount*100)):0;
  shell(`<div class="detail-back"><button class="button secondary" data-action="back-companies">← Alla företag</button></div>
  <section class="detail-hero"><div><span class="eyebrow">KUNDFÖRETAG</span><h2>${esc(c.displayName)}</h2><p>${esc(c.legalName)} · ${esc(c.orgNumber)}</p></div><div class="detail-hero-meta"><span><small>Skapad</small><strong>${dateTime(c.createdAt)}</strong></span><span><small>Senaste aktivitet</small><strong>${dateTime(s.lastActivityAt)}</strong></span></div></section>
  <section class="status-grid"><article class="metric"><span>Användare</span><strong>${num(s.memberCount)}</strong><small>konton med åtkomst</small></article><article class="metric"><span>Aktiva sessioner</span><strong>${num(s.activeSessionCount)}</strong><small>aktiva kundsessioner</small></article><article class="metric"><span>Kundposter</span><strong>${num(s.customerRecordCount)}</strong><small>i kundregistret</small></article><article class="metric"><span>Fakturor</span><strong>${num(s.invoiceRecordCount)}</strong><small>registrerade poster</small></article></section>
  <section class="dashboard-grid detail-analytics">
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">ANVÄNDNING</span><h2>Aktivitet</h2><p>Snabb indikator för kundmiljön.</p></div></div><div class="instrument-pad">${ringGauge(userActivity,'Sessionstäthet',`${s.activeSessionCount||0} aktiva sessioner för ${memberCount} användare.`,'neutral')}</div></article>
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">MILJÖDATA</span><h2>Volym</h2><p>Operativ metadata för kundmiljön.</p></div></div><div class="stat-stack"><div><span>Kundposter</span><strong>${num(s.customerRecordCount)}</strong></div><div><span>Fakturaposter</span><strong>${num(s.invoiceRecordCount)}</strong></div><div><span>Senaste aktivitet</span><strong class="date-stat">${dateTime(s.lastActivityAt)}</strong></div></div></article>
    <article class="panel dashboard-panel"><div class="panel-head"><div><span class="eyebrow">ROLLER</span><h2>Behörigheter</h2><p>Rollfördelning i just detta företag.</p></div></div><div class="role-bars roomy">${memberRoleBars(detail)}</div></article>
  </section>
  <section class="panel global-access-panel"><div class="panel-head"><div><span class="eyebrow">LT STUDIO</span><h2>Övergripande global åtkomst</h2><p>Dessa LT Studio-konton har åtkomst till alla kundföretag oberoende av lokalt medlemskap. Den globala behörigheten hanteras separat från kundroller.</p></div><span class="panel-stat">${num(s.activePlatformAdminCount)} aktiva</span></div><div class="table-wrap"><table><thead><tr><th>LT Studio-konto</th><th>Status</th><th>MFA</th><th>Omfattning</th></tr></thead><tbody>${globalAdminRows(detail)}</tbody></table></div></section>
  <section class="panel user-access-panel"><div class="panel-head"><div><span class="eyebrow">ÅTKOMST</span><h2>Användare & behörigheter</h2><p>Endast LT Studio kan skapa, ändra eller ta bort användare.</p></div><span class="panel-stat">${memberCount} användare</span></div><div class="table-wrap"><table><thead><tr><th>Användare</th><th>Roll</th><th>Status</th><th>Åtgärder</th></tr></thead><tbody>${memberRows(detail)}</tbody></table></div></section>
  <section class="panel add-user-panel"><div class="panel-head"><div><span class="eyebrow">ANVÄNDARÅTKOMST</span><h2>Lägg till användare</h2><p>Om användarnamnet redan finns kopplas det befintliga kontot till företaget. Då ändras inte personens lösenord eller MFA.</p></div></div>
    <form id="add-user-form" class="form-grid compact-form">
      <label class="field"><span>Namn · nytt konto</span><input name="displayName" maxlength="120" placeholder="För- och efternamn"></label>
      <label class="field"><span>Användarnamn / e-post</span><input name="username" required maxlength="120" placeholder="namn@foretag.se"></label>
      <label class="field"><span>Tillfälligt lösenord · nytt konto</span><input name="password" type="password" minlength="8" placeholder="Minst 8 tecken"></label>
      <label class="field"><span>Behörighet</span><select name="role"><option value="readonly">Läsbehörighet · säker standard</option><option value="approver">Attestant</option><option value="accountant">Ekonom</option><option value="admin">Admin</option></select></label>
      <div><button class="button" type="submit">Skapa eller koppla användare</button></div>
    </form><div id="mfa-result"></div>
  </section>`,'Företagsadmin',`Inställningar, användare och statistik för ${c.displayName}.`);
}
function render(){if(selectedCompany)return companyDetailView(selectedCompany);if(view==='companies')return companiesView();if(view==='statistics')return statisticsView();if(view==='security')return securityView();return overviewView()}
async function loadOperatorAudit(){
  operatorAudit=await api('/operator-audit?limit=100').catch(err=>({events:[],unavailable:true,error:err.message,code:err.code||'',status:err.status||0}));
  return operatorAudit;
}
async function loadData(){
  const [o,r,s,m,a]=await Promise.all([
    api('/overview'),
    api('/readiness').catch(err=>err.data&&typeof err.data==='object'?err.data:{ok:false,error:err.message,checks:{}}),
    api('/security-events?limit=100'),
    api('/security-monitor').catch(()=>({active:false,status:'critical',counts:{critical:1,warning:0,info:0,total:1},findings:[{code:'SECURITY_MONITOR_UNAVAILABLE',severity:'critical',category:'Övervakning',title:'Säkerhetsövervakningen är inte tillgänglig',message:'Portalen kunde inte läsa den aktiva säkerhetsmotorn.'}]})),
    api('/security-alerts').catch(()=>({configured:false,channel:'webhook',lastTestAt:null,lastTestSucceeded:false,lastDeliveryAt:null,lastDeliveryStatus:null}))
  ]);
  overview=o;readiness=r;security=s;securityMonitor=m;securityAlerts=a;
  await loadOperatorAudit();
}
function stopSecurityPolling(){if(securityPollTimer){clearTimeout(securityPollTimer);securityPollTimer=null}}
async function pollSecurity(){
  if(!session?.authenticated)return;
  try{
    securityMonitor=await api('/security-monitor');
    if(view==='security'&&!selectedCompany&&!modal){
      const [o,r,s,a]=await Promise.all([
        api('/overview'),
        api('/readiness').catch(err=>err.data&&typeof err.data==='object'?err.data:{ok:false,error:err.message,checks:{}}),
        api('/security-events?limit=100'),
        api('/security-alerts').catch(()=>securityAlerts)
      ]);
      overview=o;readiness=r;security=s;securityAlerts=a;
      await loadOperatorAudit();
      render();
    }else updateSecurityChrome();
  }catch{}
  finally{
    if(session?.authenticated){
      const delay=Math.max(5000,Math.min(60000,Number(securityMonitor?.scanIntervalSeconds||30)*1000));
      securityPollTimer=setTimeout(pollSecurity,delay);
    }
  }
}
function startSecurityPolling(){stopSecurityPolling();if(session?.authenticated)securityPollTimer=setTimeout(pollSecurity,1000)}
async function openCompany(id){errorMessage='';try{selectedCompany=await api('/companies/'+encodeURIComponent(id));render()}catch(error){errorMessage=error.message;selectedCompany=null;render()}}
async function reloadSelectedCompanyOverview(){
  if(!selectedCompany)return;
  const companyId=selectedCompany.company.id;
  const [detail,nextOverview]=await Promise.all([
    api('/companies/'+encodeURIComponent(companyId)),
    api('/overview')
  ]);
  selectedCompany=detail;
  overview=nextOverview;
}
async function refresh(){errorMessage='';try{await loadData();if(selectedCompany)selectedCompany=await api('/companies/'+encodeURIComponent(selectedCompany.company.id))}catch(error){errorMessage=error.message}render()}
async function mutate(path,options){return api(path,{...options,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf(),...(options?.headers||{})}})}
document.addEventListener('input',event=>{
  if(!event.target.matches?.('[data-company-search]'))return;
  companyQuery=event.target.value;companySearchOpen=Boolean(companyQuery.trim());companySearchActiveIndex=-1;updateCompanyTable();
});
document.addEventListener('focusin',event=>{
  if(event.target.matches?.('[data-company-search]')&&companyQuery.trim()){companySearchOpen=true;updateCompanySearchDropdown()}
});
document.addEventListener('keydown',async event=>{
  if(!event.target.matches?.('[data-company-search]'))return;
  const rows=companySearchSuggestions();
  if(event.key==='Escape'){closeCompanySearch();return}
  if(!rows.length)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    event.preventDefault();companySearchOpen=true;
    const step=event.key==='ArrowDown'?1:-1;
    companySearchActiveIndex=(companySearchActiveIndex+step+rows.length)%rows.length;
    updateCompanySearchDropdown();return;
  }
  if(event.key==='Enter'&&companySearchOpen){
    event.preventDefault();
    const company=rows[Math.max(0,companySearchActiveIndex)];
    if(company){closeCompanySearch();await openCompany(company.id)}
  }
});
document.addEventListener('submit',async event=>{
  if(event.target.id==='login-form'){
    event.preventDefault();errorMessage='';const button=event.target.querySelector('button[type="submit"]');button.disabled=true;const data=Object.fromEntries(new FormData(event.target).entries());
    try{const signed=await api('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});session={authenticated:true,operator:signed.operator};sessionStorage.setItem(csrfKey,signed.csrfToken||'');await loadData();render();startSecurityPolling()}catch(error){errorMessage=error.message;loginView()}return;
  }
  if(event.target.id==='add-user-form'){
    event.preventDefault();const data=Object.fromEntries(new FormData(event.target).entries());const button=event.target.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{const created=await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users',{method:'POST',body:JSON.stringify(data)});await reloadSelectedCompanyOverview();uiNotice=created.linkedExisting?'Befintligt konto kopplades till företaget. Lösenord och MFA ändrades inte.':'Användaren skapades.';render();const box=document.getElementById('mfa-result');if(box&&created.mfaSecret)box.innerHTML=`<div class="success-box"><strong>MFA-hemlighet – visas bara nu</strong><p><code>${esc(created.mfaSecret)}</code></p><p>Ge koden direkt till användaren och spara den inte i GitHub eller delade dokument.</p></div>`}catch(error){errorMessage=error.message;render()}return;
  }
  if(event.target.id==='reset-password-form'){
    event.preventDefault();if(!modal||modal.kind!=='password')return;const data=Object.fromEntries(new FormData(event.target).entries());const button=event.target.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users/'+encodeURIComponent(modal.userId)+'/password',{method:'PUT',body:JSON.stringify({password:data.password})});await reloadSelectedCompanyOverview();modal=null;uiNotice='Lösenordet ändrades och användarens tidigare sessioner avslutades.';errorMessage='';render()}catch(error){errorMessage=error.message;modal=null;render()}return;
  }
});
document.addEventListener('change',async event=>{
  if(event.target.matches?.('[data-incident-status]')){
    const select=event.target,eventId=select.dataset.securityEventId,nextStatus=select.value;
    select.disabled=true;errorMessage='';
    try{
      const result=await mutate('/security-events/'+encodeURIComponent(eventId)+'/status',{method:'PUT',body:JSON.stringify({status:nextStatus})});
      const row=(security?.events||[]).find(item=>item.id===eventId);
      if(row){row.incidentStatus=result.incident?.status||nextStatus;row.incidentUpdatedAt=result.incident?.updatedAt||null;row.incidentUpdatedBy=result.incident?.updatedBy||session?.operator?.displayName||null}
      await loadOperatorAudit();
      uiNotice=result.changed?'Incidentstatusen uppdaterades och audit-loggades.':'Incidentstatusen var redan vald.';
      render();
    }catch(error){errorMessage=error.message;render()}
    return;
  }
  if(event.target.matches?.('[data-security-severity]')){securitySeverity=event.target.value;render();return}
  if(event.target.matches?.('[data-security-period]')){securityPeriod=event.target.value;render();return}
  if(event.target.matches?.('[data-security-company]')){securityCompany=event.target.value;render();return}
  if(event.target.matches?.('[data-security-incident-filter]')){securityIncidentStatus=event.target.value;render();return}
  if(event.target.matches?.('[data-company-filter]')){companyStatus=event.target.value;updateCompanyTable();return}
  if(event.target.matches?.('[data-company-sort]')){companySort=event.target.value;updateCompanyTable();return}
  const userId=event.target.dataset.roleUser;if(!userId||!selectedCompany)return;
  event.target.disabled=true;
  try{await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users/'+encodeURIComponent(userId)+'/role',{method:'PUT',body:JSON.stringify({role:event.target.value})});await reloadSelectedCompanyOverview();uiNotice='Behörigheten uppdaterades och användarens tidigare sessioner avslutades.';errorMessage='';render()}catch(error){errorMessage=error.message;render()}
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
  const companySuggestion=event.target.closest('[data-company-search-id]');if(companySuggestion){closeCompanySearch();await openCompany(companySuggestion.dataset.companySearchId);return}
  if(companySearchOpen&&!event.target.closest('.company-search-shell'))closeCompanySearch();
  const companyRow=event.target.closest('[data-company-id]');if(companyRow){closeCompanySearch();await openCompany(companyRow.dataset.companyId);return}
  const viewButton=event.target.closest('[data-view]');if(viewButton){selectedCompany=null;view=viewButton.dataset.view;if(view==='security')await loadOperatorAudit();render();return}
  const button=event.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action;
  if(action==='refresh'){await refresh();return}
  if(action==='test-security-alert'){
    button.disabled=true;errorMessage='';
    try{
      const result=await mutate('/security-alerts/test',{method:'POST',body:'{}'});
      securityAlerts=result.status||securityAlerts;
      readiness=await api('/readiness').catch(err=>err.data&&typeof err.data==='object'?err.data:readiness);
      await loadOperatorAudit();
      uiNotice='Testlarmet levererades och audit-loggades.';
      render();
    }catch(error){
      securityAlerts=await api('/security-alerts').catch(()=>securityAlerts);
      await loadOperatorAudit();
      errorMessage=error.message;
      render();
    }
    return;
  }
  if(action==='back-companies'){selectedCompany=null;view='companies';render();return}
  if(action==='reset-password'){modal={kind:'password',userId:button.dataset.userId,userName:button.dataset.userName||'Användaren'};render();focusModal();return}
  if(action==='remove-user'){modal={kind:'remove',userId:button.dataset.userId,userName:button.dataset.userName||'Användaren'};render();focusModal();return}
  if(action==='close-modal'){modal=null;render();return}
  if(action==='dismiss-notice'){uiNotice='';render();return}
  if(action==='confirm-remove-user'){
    if(!modal||modal.kind!=='remove')return;button.disabled=true;
    try{await mutate('/companies/'+encodeURIComponent(selectedCompany.company.id)+'/users/'+encodeURIComponent(modal.userId),{method:'DELETE',body:'{}'});await reloadSelectedCompanyOverview();modal=null;uiNotice='Användarens åtkomst till företaget togs bort och aktiva sessioner avslutades.';errorMessage='';render()}catch(error){errorMessage=error.message;modal=null;render()}return;
  }
  if(action==='logout'){
    try{await mutate('/auth/logout',{method:'POST',body:'{}'})}catch{}
    stopSecurityPolling();sessionStorage.removeItem(csrfKey);session=null;overview=null;readiness=null;security=null;operatorAudit=null;securityMonitor=null;securityAlerts=null;selectedCompany=null;errorMessage='';loginView();
  }
});
async function boot(){try{const current=await api('/session');if(!current.authenticated){loginView();return}session=current;await loadData();render();startSecurityPolling()}catch(error){errorMessage=error.message;loginView()}}
boot();
