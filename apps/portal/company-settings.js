const app=document.getElementById('company-settings-app');
const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
let csrfToken=sessionStorage.getItem('rollands-csrf')||'';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){
  const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})};
  const response=await fetch('/api/v1'+path,{credentials:'same-origin',cache:'no-store',...options,headers,body:options.body?JSON.stringify(options.body):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||'Begäran misslyckades.');error.code=data.code;throw error}
  return data;
}
function render(data,message='',error=false){
  const company=data.company||{},s=data.settings||{};
  app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Företagsinställningar</h1><p>Systemadministration / Företagsuppgifter</p></div></header><main class="content company-settings-content"><div class="page-heading"><div><span class="eyebrow">Företagsprofil</span><h2>Uppgifter som används i systemet</h2><p>Fyll i uppgifterna en gång. De används automatiskt på kundfakturor, faktura-PDF:er och andra funktioner som behöver företagets identitet och betalningsuppgifter.</p></div></div>${message?`<p class="notice ${error?'warning':''}" role="status">${esc(message)}</p>`:''}<div class="company-settings-grid"><section class="panel company-settings-card"><form id="company-settings-form" class="company-settings-form"><div class="company-settings-section"><h3>Företagsidentitet</h3><div class="company-settings-fields"><label class="field">Juridiskt namn<input class="company-settings-readonly" value="${esc(company.legalName||'')}" readonly></label><label class="field">Organisationsnummer<input class="company-settings-readonly" value="${esc(company.orgNumber||'')}" readonly></label><label class="field full">Företagsadress<input name="address" value="${esc(s.address||'')}" maxlength="500" required placeholder="Gatuadress, postnummer och ort"></label></div></div><div class="company-settings-section"><h3>Kontaktuppgifter</h3><div class="company-settings-fields"><label class="field">E-post<input name="email" type="email" value="${esc(s.email||'')}" maxlength="254" placeholder="ekonomi@foretaget.se"></label><label class="field">Telefon<input name="phone" value="${esc(s.phone||'')}" maxlength="60" placeholder="+46 ..."></label><label class="field full">Webbplats<input name="website" type="url" value="${esc(s.website||'')}" maxlength="240" placeholder="https://..."></label></div></div><div class="company-settings-section"><h3>Fakturering & skatt</h3><div class="company-settings-fields"><label class="field">VAT-nummer<input name="vatNumber" value="${esc(s.vatNumber||data.expectedVatNumber||'')}" required maxlength="14"></label><label class="field">Bankgiro<input name="bankgiro" value="${esc(s.bankgiro||'')}" required maxlength="12" placeholder="1234-5678"></label><label class="field full">Skattestatus<input name="taxStatus" value="${esc(s.taxStatus||'Godkänd för F-skatt')}" required maxlength="120" placeholder="Godkänd för F-skatt"></label></div></div><div class="company-settings-actions"><button class="button" type="submit">Spara företagsinställningar</button><p class="company-settings-status">${data.configured?'Inställningarna är sparade.':'Inställningarna behöver fyllas i innan en kundfaktura kan bokföras.'}</p></div></form></section><aside class="company-settings-help"><section class="panel company-settings-card"><h3>Används automatiskt</h3><ul><li>Företagets adress och kontaktuppgifter</li><li>VAT-nummer</li><li>Bankgiro</li><li>Skattestatus</li><li>Säljaruppgifter på kundfakturor och faktura-PDF</li></ul></section><section class="notice"><b>Viktigt.</b> Organisationsnummer och juridiskt namn styrs av företagskontot och kan inte ändras här. På så sätt kan fakturor inte få en annan juridisk identitet än det inloggade företaget.</section></aside></div></main></section></div>`;
  globalThis.RollandsNavigation?.mount?.();
}
async function load(){
  if(isDemo){
    app.innerHTML='<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Företagsinställningar</h1><p>Demo</p></div></header><main class="content"><div class="demo-banner"><b>Demo.</b> Riktiga företagsinställningar kan endast ändras i den privata portalen.</div></main></section></div>';
    globalThis.RollandsNavigation?.mount?.();return;
  }
  const session=await api('/session');
  if(!session.authenticated){location.href='./index.html';return}
  if(!csrfToken){location.href='./index.html';return}
  const data=await api('/company-settings');
  render(data);
}
document.addEventListener('submit',async event=>{
  if(event.target.id!=='company-settings-form')return;
  event.preventDefault();
  const button=event.target.querySelector('button[type="submit"]');button.disabled=true;
  const form=new FormData(event.target);
  const payload={address:form.get('address'),email:form.get('email'),phone:form.get('phone'),website:form.get('website'),vatNumber:form.get('vatNumber'),bankgiro:form.get('bankgiro'),taxStatus:form.get('taxStatus')};
  try{
    await api('/company-settings',{method:'PUT',body:payload});
    const refreshed=await api('/company-settings');
    render(refreshed,'Företagsinställningarna är sparade och används nu automatiskt av faktureringen.');
  }catch(error){
    const current=await api('/company-settings').catch(()=>({company:{},settings:{}}));
    render(current,error.message,true);
  }
});
load().catch(error=>{app.innerHTML=`<main class="content"><h1>Företagsinställningar</h1><p class="notice warning" role="alert">${esc(error.message)}</p><a class="button ghost" href="./dashboard.html">Till översikten</a></main>`;});
