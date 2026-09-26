const app=document.getElementById('company-settings-app');
const pageParams=new URLSearchParams(location.search);
const isDemo=pageParams.get('demo')==='1';
const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!isDemo;
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
  if(data.canEdit===false){
    for(const control of app.querySelectorAll('#company-settings-form input:not(.company-settings-readonly),#company-settings-form button[type="submit"]'))control.disabled=true;
    const status=app.querySelector('.company-settings-status');if(status)status.textContent='Endast företagsadmin kan ändra dessa uppgifter.';
  }
  globalThis.RollandsNavigation?.mount?.();
}
function expectedVatNumber(orgNumber=''){
  const digits=String(orgNumber||'').replace(/\D/g,'');
  return digits.length===10?'SE'+digits+'01':'';
}
async function loadSupabaseSettings(){
  const ctx=await window.LTSupabaseUat.context();
  if(!ctx.authenticated||!ctx.company){location.href='./index.html';return null}
  const rows=await window.LTSupabase.from('company_invoice_settings',ctx.accessToken).select('*','company_id=eq.'+encodeURIComponent(ctx.company.id));
  const row=rows?.[0]||{};
  return {
    company:{legalName:ctx.company.legalName||ctx.company.name||'',orgNumber:ctx.company.orgNumber||''},
    settings:{
      address:row.address||'',
      email:row.email||'',
      phone:row.phone||'',
      website:row.website||'',
      vatNumber:row.vat_number||'',
      bankgiro:row.bankgiro||'',
      taxStatus:row.tax_status||''
    },
    configured:Boolean(row.address&&row.vat_number&&row.bankgiro&&row.tax_status),
    expectedVatNumber:expectedVatNumber(ctx.company.orgNumber),
    canEdit:ctx.membership?.role==='admin',
    context:ctx
  };
}
async function saveSupabaseSettings(payload){
  const current=await loadSupabaseSettings();if(!current)return null;
  const ctx=current.context;
  if(ctx.membership?.role!=='admin')throw new Error('Endast företagsadmin kan ändra företagsinställningarna.');
  await window.LTSupabase.from('company_invoice_settings',ctx.accessToken).upsert([{
    company_id:ctx.company.id,
    address:String(payload.address||'').trim(),
    email:String(payload.email||'').trim(),
    phone:String(payload.phone||'').trim(),
    website:String(payload.website||'').trim(),
    vat_number:String(payload.vatNumber||'').trim(),
    bankgiro:String(payload.bankgiro||'').trim(),
    tax_status:String(payload.taxStatus||'').trim(),
    updated_by:ctx.authUser.id,
    updated_at:new Date().toISOString()
  }]);
  return loadSupabaseSettings();
}
async function load(){
  if(isDemo){
    app.innerHTML='<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Företagsinställningar</h1><p>Demo</p></div></header><main class="content"><div class="demo-banner"><b>Demo.</b> Riktiga företagsinställningar kan endast ändras i den privata portalen.</div></main></section></div>';
    globalThis.RollandsNavigation?.mount?.();return;
  }
  if(isSupabase){
    const data=await loadSupabaseSettings();if(data)render(data);return;
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
    if(isSupabase){
      const refreshed=await saveSupabaseSettings(payload);
      if(refreshed)render(refreshed,'Företagsinställningarna är sparade i Supabase och används nu av faktureringen.');
      return;
    }
    await api('/company-settings',{method:'PUT',body:payload});
    const refreshed=await api('/company-settings');
    render(refreshed,'Företagsinställningarna är sparade och används nu automatiskt av faktureringen.');
  }catch(error){
    const current=isSupabase
      ? await loadSupabaseSettings().catch(()=>({company:{},settings:{},canEdit:false}))
      : await api('/company-settings').catch(()=>({company:{},settings:{}}));
    render(current||{company:{},settings:{}},error.message,true);
  }
});
load().catch(error=>{app.innerHTML=`<main class="content"><h1>Företagsinställningar</h1><p class="notice warning" role="alert">${esc(error.message)}</p><a class="button ghost" href="./dashboard.html">Till översikten</a></main>`;});
