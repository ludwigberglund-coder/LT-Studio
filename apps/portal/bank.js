const app=document.getElementById('bank-app');
const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
let session=null;
let payments=[];
let message='';

const demoPayments=[
  {id:'bank-demo-1',externalId:'BG-20260916-1001',bookingDate:'2026-09-16',valueDate:'2026-09-16',amountOre:420000,currency:'SEK',reference:'310001',message:'Faktura 310001',payerName:'Västra Hamnen Logistik AB',payerAccount:'SE12••••1234',status:'unmatched'},
  {id:'bank-demo-2',externalId:'BG-20260916-1002',bookingDate:'2026-09-16',valueDate:'2026-09-16',amountOre:392500,currency:'SEK',reference:'310002',message:'Betalning kundfaktura',payerName:'Nordic Office Göteborg AB',payerAccount:'SE34••••8821',status:'proposal-created'},
  {id:'bank-demo-3',externalId:'BG-20260916-1003',bookingDate:'2026-09-16',valueDate:'2026-09-16',amountOre:235000,currency:'SEK',reference:'Betalning september',message:'Tack',payerName:'Okänd betalare',payerAccount:'SE55••••9911',status:'unmatched'}
];

function esc(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function ore(value){return new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',minimumFractionDigits:2}).format(Number(value||0)/100)}
function initials(name){return String(name||'Användare').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function statusLabel(status){return ({unmatched:'Ej matchad','proposal-created':'Förslag skapat',reviewed:'Granskad',posted:'Bokförd',ignored:'Ignorerad'})[status]||status}

async function api(path,options={}){
  const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
  if(options.method&&options.method!=='GET'&&csrfToken)headers['X-CSRF-Token']=csrfToken;
  const response=await fetch(`/api/v1${path}`,{credentials:'same-origin',...options,headers,body:options.body?JSON.stringify(options.body):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||'Begäran misslyckades.');error.code=data.code;throw error}
  return data;
}
function sidebar(){return `<aside class="sidebar"><div class="logo"><strong>Rollands</strong><small>FÖRETAGSPORTAL</small></div><div class="company-pill">${esc(isDemo?'Rollands Frukt o Grönt AB':'Skyddad företagsmiljö')}<br>${isDemo?'Demoföretag':'Personlig session'}</div><div class="side-group"><span>Försäljning</span><a class="side-link side-link-link" href="./index.html${isDemo?'?demo=1':''}">Kundreskontra</a></div><div class="side-group"><span>Ekonomi</span><button class="side-link active">Bank & avstämning</button><a class="side-link side-link-link" href="./automation.html${isDemo?'?demo=1':''}">Automationskö</a><button class="side-link disabled">Bokföring</button><button class="side-link disabled">Rapporter</button></div><div class="sidebar-footer">${isDemo?'Öppen demo med exempelbetalningar.':'Bankdata isoleras per företag och kräver personlig session.'}</div></aside>`}
function summary(){const unmatched=payments.filter(p=>p.status==='unmatched').length,proposals=payments.filter(p=>p.status==='proposal-created').length,total=payments.reduce((s,p)=>s+p.amountOre,0);return `<section class="bank-summary"><article><span>Dagens inbetalningar</span><strong>${payments.length}</strong></article><article><span>Ej matchade</span><strong>${unmatched}</strong></article><article><span>Förslag skapade</span><strong>${proposals}</strong></article><article><span>Importerat belopp</span><strong>${ore(total)}</strong></article></section>`}
function rows(){return payments.map(p=>`<tr><td>${esc(p.bookingDate)}</td><td><b>${esc(p.payerName||'Okänd')}</b><br><small>${esc(p.payerAccount||'—')}</small></td><td>${esc(p.reference||'—')}<br><small>${esc(p.message||'')}</small></td><td class="money">${esc(ore(p.amountOre))}</td><td><span class="bank-status ${esc(p.status)}">${esc(statusLabel(p.status))}</span></td><td>${p.status==='unmatched'?`<button class="button small" data-match="${esc(p.id)}">Analysera matchning</button>`:`<a class="button ghost small" href="./automation.html${isDemo?'?demo=1':''}">Öppna förslag</a>`}</td></tr>`).join('')}
function render(){const userName=session?.user?.displayName||(isDemo?'Demoanvändare':'Inloggad användare');app.innerHTML=`<div class="portal">${sidebar()}<section class="main"><header class="topbar"><div><h1>Bank & avstämning</h1><p>Rollands / Ekonomi / Bank</p></div><div class="user-chip"><div><b>${esc(userName)}</b><br><small>${isDemo?'Demo':'Inloggad'}</small></div><div class="avatar">${esc(initials(userName))}</div></div></header><main class="content bank-content">${isDemo?'<div class="demo-banner"><b>GitHub Pages-demo.</b> Bankhändelserna är exempeldata. Ingen riktig bank är ansluten.</div>':''}<div class="page-heading"><div><span class="eyebrow">Automatisk avstämning</span><h2>Inkommande betalningar</h2><p>Varje bankhändelse importeras en gång. Matchningsmotorn jämför OCR, fakturanummer, restbelopp och betalarnamn och skickar förslaget till Automationskön.</p></div></div>${message?`<div class="notice">${esc(message)}</div>`:''}${summary()}<section class="panel"><div class="toolbar"><span class="hint">Ingen rad bokförs automatiskt i denna fas.</span><a class="button ghost small" href="./automation.html${isDemo?'?demo=1':''}">Öppna Automationskö</a></div><div class="table-scroll"><table class="res-table bank-table"><thead><tr><th>Datum</th><th>Betalare</th><th>Referens</th><th>Belopp</th><th>Status</th><th>Åtgärd</th></tr></thead><tbody>${rows()||'<tr><td colspan="6" class="empty">Inga inbetalningar.</td></tr>'}</tbody></table></div></section></main></section></div>`}

async function load(){
  if(isDemo){session={user:{displayName:'Demoanvändare'}};payments=structuredClone(demoPayments);render();return}
  const state=await api('/session');
  if(!state.authenticated){app.innerHTML='<main class="boot"><strong>Inloggning krävs</strong><span>Logga in i företagsportalen först.</span><p><a class="button" href="./index.html">Gå till inloggning</a></p></main>';return}
  session={user:state.user,companyId:state.companyId};
  payments=(await api('/bank/payments')).payments||[];render();
}
async function matchPayment(id){
  if(isDemo){const payment=payments.find(p=>p.id===id);if(payment){if(payment.id==='bank-demo-3')message='Ingen säker träff hittades. Betalningen behöver manuell hantering.';else{payment.status='proposal-created';message='Ett demoförslag skapades och kan granskas i Automationskön.'}}render();return}
  if(!csrfToken)throw new Error('Säkerhetstoken saknas. Logga in igen i samma flik.');
  const data=await api(`/bank/payments/${encodeURIComponent(id)}/match`,{method:'POST',body:{}});
  message=data.proposal?'Matchningsförslag skapat. Granska det i Automationskön.':(data.analysis?.reason||'Ingen säker träff hittades.');
  await load();
}
document.addEventListener('click',async event=>{const button=event.target.closest('[data-match]');if(!button)return;button.disabled=true;try{await matchPayment(button.dataset.match)}catch(error){message=error.message;render()}});
load().catch(error=>{app.innerHTML=`<main class="boot"><strong>Kunde inte ladda bankavstämningen</strong><span>${esc(error.message)}</span></main>`});
