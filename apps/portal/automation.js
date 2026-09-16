const app=document.getElementById('automation-app');
const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
let session=null;
let proposals=[];
let filter='open';
let message='';

const demoProposals=[
  {id:'demo-p1',type:'bank-payment-match',sourceId:'bank-2026-0916-01',status:'ready-for-approval',confidence:1,deterministic:true,ambiguous:false,reason:'OCR 310001 och exakt restbelopp 4 200,00 kr matchar en enda kundfaktura.',decisionReason:'Deterministiska regler gav en entydig träff. En behörig person ska fortfarande godkänna åtgärden i denna fas.',evidence:[{kind:'payment-reference',label:'OCR',value:'310001',sourceId:'bank-2026-0916-01'},{kind:'amount',label:'Belopp',value:'4200,00 SEK',sourceId:'bank-2026-0916-01'}],suggestion:{action:'match-customer-payment',invoiceNumber:'310001',amountOre:420000},engine:{kind:'rules',name:'exact-payment-match',version:'1'},createdBy:'system',createdAt:'2026-09-16T05:20:00.000Z'},
  {id:'demo-p2',type:'supplier-invoice-coding',sourceId:'supplier-invoice-8871',status:'manual-review',confidence:.72,deterministic:false,ambiguous:true,reason:'Leverantören har tidigare bokats på flera kostnadskonton och fakturatexten är inte entydig.',decisionReason:'Underlaget ger flera möjliga tolkningar.',evidence:[{kind:'supplier-history',label:'Tidigare konton',value:'4010, 5460, 6110',sourceId:'supplier-invoice-8871'},{kind:'invoice-text',label:'Fakturatext',value:'Varor och service september',sourceId:'supplier-invoice-8871'}],suggestion:{account:'4010',vatAccount:'2641',requiresReview:true},engine:{kind:'ai-assisted',name:'supplier-coding-proposal',version:'future-demo'},createdBy:'system',createdAt:'2026-09-16T05:25:00.000Z'},
  {id:'demo-p3',type:'booking-account-suggestion',sourceId:'receipt-555',status:'approved',confidence:.94,deterministic:false,ambiguous:false,reason:'Liknande kvitton från samma leverantör har bokats som förbrukningsmaterial.',decisionReason:'Förslaget har hög säkerhet men kräver mänskligt godkännande.',evidence:[{kind:'history',label:'Historik',value:'8 av 9 liknande underlag → 5460',sourceId:'receipt-555'}],suggestion:{debitAccount:'5460',vatAccount:'2641',creditAccount:'1930'},engine:{kind:'rules',name:'booking-suggestion',version:'1'},createdBy:'system',createdAt:'2026-09-16T05:30:00.000Z',approvedBy:'demo-user',approvedAt:'2026-09-16T05:34:00.000Z'}
];

function esc(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function initials(name){return String(name||'Användare').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function percent(value){return `${(Number(value||0)*100).toFixed(0)} %`}
function when(value){if(!value)return '—';try{return new Date(value).toLocaleString('sv-SE')}catch{return String(value)}}
function typeLabel(type){return ({'bank-payment-match':'Matchning av kundinbetalning','booking-account-suggestion':'Konteringsförslag','supplier-invoice-coding':'Kontering av leverantörsfaktura','supplier-payment-preparation':'Förberedd leverantörsbetalning'})[type]||type}
function statusLabel(status){return ({'manual-review':'Manuell granskning','ready-for-approval':'Redo för godkännande','approved':'Godkänt – ej exekverat','rejected':'Avvisat','superseded':'Ersatt'})[status]||status}
function isOpen(proposal){return ['manual-review','ready-for-approval'].includes(proposal.status)}

async function api(path,options={}){
  const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
  if(options.method&&options.method!=='GET'&&csrfToken)headers['X-CSRF-Token']=csrfToken;
  const response=await fetch(`/api/v1${path}`,{credentials:'same-origin',...options,headers,body:options.body?JSON.stringify(options.body):undefined});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||'Begäran misslyckades.');error.code=data.code;error.status=response.status;throw error}
  return data;
}

function sidebar(){return `<aside class="sidebar"><div class="logo"><strong>Rollands</strong><small>FÖRETAGSPORTAL</small></div><div class="company-pill">${esc(isDemo?'Rollands Frukt o Grönt AB':'Skyddad företagsmiljö')}<br>${isDemo?'Demoföretag':'Personlig session'}</div><div class="side-group"><span>Försäljning</span><a class="side-link side-link-link" href="./index.html${isDemo?'?demo=1':''}">Kundreskontra</a></div><div class="side-group"><span>Ekonomi</span><button class="side-link disabled">Bank & avstämning</button><button class="side-link disabled">Bokföring</button><button class="side-link active">Automationskö</button><button class="side-link disabled">Rapporter</button></div><div class="sidebar-footer">${isDemo?'Öppen demo. Alla förslag är exempeldata.':'Förslagslager separat från bokföring och betalning.'}</div></aside>`}

function summary(){const open=proposals.filter(isOpen).length,ready=proposals.filter(p=>p.status==='ready-for-approval').length,review=proposals.filter(p=>p.status==='manual-review').length,done=proposals.filter(p=>['approved','rejected'].includes(p.status)).length;return `<section class="automation-summary"><article class="automation-card"><span>Öppna förslag</span><strong>${open}</strong></article><article class="automation-card"><span>Redo att godkänna</span><strong>${ready}</strong></article><article class="automation-card"><span>Kräver granskning</span><strong>${review}</strong></article><article class="automation-card"><span>Behandlade</span><strong>${done}</strong></article></section>`}
function visibleProposals(){if(filter==='all')return proposals;if(filter==='open')return proposals.filter(isOpen);return proposals.filter(p=>p.status===filter)}
function evidenceRows(proposal){return (proposal.evidence||[]).map(row=>`<div class="evidence-row"><b>${esc(row.label||row.kind)}</b>${esc(row.value)}${row.sourceId?`<br><small>Källa: ${esc(row.sourceId)}</small>`:''}</div>`).join('')||'<p class="empty">Inget underlag registrerat.</p>'}
function proposalCard(proposal){const actionable=isOpen(proposal);const approvedText=proposal.status==='approved'?`Godkänt ${esc(when(proposal.approvedAt))}`:proposal.status==='rejected'?`Avvisat: ${esc(proposal.rejectionReason||'Ingen motivering')}`:'';return `<article class="proposal" data-proposal="${esc(proposal.id)}"><header class="proposal-head"><div><span class="eyebrow">${esc(typeLabel(proposal.type))}</span><h3>${esc(proposal.sourceId)}</h3><p>${esc(proposal.reason)}</p></div><span class="proposal-status ${esc(proposal.status)}">${esc(statusLabel(proposal.status))}</span></header><div class="proposal-body"><section class="proposal-section"><h4>Bedömning</h4><dl class="proposal-grid"><dt>Säkerhet</dt><dd>${esc(percent(proposal.confidence))}</dd><dt>Deterministisk</dt><dd>${proposal.deterministic?'Ja':'Nej'}</dd><dt>Tvetydigt underlag</dt><dd>${proposal.ambiguous?'Ja':'Nej'}</dd><dt>Skapat</dt><dd>${esc(when(proposal.createdAt))}</dd><dt>Motor</dt><dd>${esc(`${proposal.engine?.name||'okänd'} ${proposal.engine?.version||''}`)}</dd></dl><div class="confidence" aria-label="Säkerhet ${esc(percent(proposal.confidence))}"><span style="width:${Math.max(0,Math.min(100,Number(proposal.confidence||0)*100))}%"></span></div><div class="notice">${esc(proposal.decisionReason)}</div>${approvedText?`<div class="notice">${approvedText}</div>`:''}<h4>Underlag</h4><div class="evidence-list">${evidenceRows(proposal)}</div></section><section class="proposal-section"><h4>Föreslagen åtgärd</h4><pre class="suggestion-box">${esc(JSON.stringify(proposal.suggestion||{},null,2))}</pre><div class="automation-note"><b>Kontrollpunkt:</b> Ett godkännande här bokför inte, matchar inte banktransaktionen och frisläpper inte någon betalning. Det markerar bara beslutsunderlaget som granskat.</div></section></div>${actionable?`<footer class="proposal-actions"><input class="reason-input" data-reason="${esc(proposal.id)}" maxlength="2000" placeholder="Motivering krävs vid avvisning"><button class="button danger" data-action="reject" data-id="${esc(proposal.id)}">Avvisa</button><button class="button" data-action="approve" data-id="${esc(proposal.id)}">Godkänn förslag</button></footer>`:''}</article>`}
function filters(){const items=[['open','Öppna'],['ready-for-approval','Redo'],['manual-review','Manuell granskning'],['approved','Godkända'],['rejected','Avvisade'],['all','Alla']];return `<div class="automation-filter">${items.map(([id,label])=>`<button data-filter="${id}" class="${filter===id?'active':''}">${label}</button>`).join('')}</div>`}

function render(){const userName=session?.user?.displayName||(isDemo?'Demoanvändare':'Inloggad användare');const list=visibleProposals();app.innerHTML=`<div class="portal">${sidebar()}<section class="main"><header class="topbar"><div><h1>Automationskö</h1><p>Rollands / Ekonomi / Automationskö</p></div><div class="user-chip"><div><b>${esc(userName)}</b><br><small>${isDemo?'Demo':'Inloggad'}</small></div><div class="avatar">${esc(initials(userName))}</div></div></header><main class="content automation-content">${isDemo?'<div class="demo-banner"><b>GitHub Pages-demo.</b> Förslagen nedan är exempeldata och påverkar ingen bokföring.</div>':''}<div class="page-heading"><div><span class="eyebrow">Människa i kontroll</span><h2>Förslag som väntar på bedömning</h2><p>Regelmotorer och framtida AI får förbereda beslut, men den här kön är separerad från faktisk bokföring och betalning.</p></div></div><div class="automation-note"><b>Nuvarande fas:</b> inget AI-system är kopplat för automatisk bokföring. Granskningskön och kontrollmodellen byggs först. E-postintegrationen ligger också kvar till en senare etapp.</div>${message?`<div class="notice">${esc(message)}</div>`:''}${summary()}<section class="panel"><div class="toolbar"><span class="hint">Filtrera granskningskön</span>${filters()}</div></section><section class="proposal-list">${list.map(proposalCard).join('')||'<div class="automation-empty">Inga förslag i det här urvalet.</div>'}</section></main></section></div>`}

async function load(){
  if(isDemo){session={user:{displayName:'Demoanvändare'}};proposals=structuredClone(demoProposals);render();return}
  const state=await api('/session');
  if(!state.authenticated){app.innerHTML='<main class="boot"><strong>Inloggning krävs</strong><span>Öppna företagsportalen och logga in först.</span><p><a class="button" href="./index.html">Gå till inloggning</a></p></main>';return}
  session={user:state.user,companyId:state.companyId};
  const data=await api('/automation/proposals');
  proposals=data.proposals||[];
  render();
}

async function approve(id){
  if(isDemo){const proposal=proposals.find(p=>p.id===id);if(proposal){proposal.status='approved';proposal.approvedBy='demo-user';proposal.approvedAt=new Date().toISOString();message='Demoförslaget markerades som godkänt. Ingen bokföring utfördes.'}render();return}
  if(!csrfToken)throw new Error('Säkerhetstoken saknas. Gå tillbaka till portalen och logga in igen i samma flik.');
  const data=await api(`/automation/proposals/${encodeURIComponent(id)}/approve`,{method:'POST',body:{}});
  message=data.message||'Förslaget godkändes utan automatisk exekvering.';
  await load();
}

async function reject(id,reason){
  if(!String(reason||'').trim())throw new Error('Skriv varför förslaget avvisas.');
  if(isDemo){const proposal=proposals.find(p=>p.id===id);if(proposal){proposal.status='rejected';proposal.rejectionReason=String(reason).trim();proposal.rejectedAt=new Date().toISOString();message='Demoförslaget avvisades.'}render();return}
  if(!csrfToken)throw new Error('Säkerhetstoken saknas. Gå tillbaka till portalen och logga in igen i samma flik.');
  await api(`/automation/proposals/${encodeURIComponent(id)}/reject`,{method:'POST',body:{reason:String(reason).trim()}});
  message='Förslaget avvisades och beslutet sparades i revisionsloggen.';
  await load();
}

document.addEventListener('click',async event=>{
  const filterButton=event.target.closest('[data-filter]');
  if(filterButton){filter=filterButton.dataset.filter;render();return}
  const button=event.target.closest('[data-action]');
  if(!button)return;
  button.disabled=true;
  try{
    if(button.dataset.action==='approve')await approve(button.dataset.id);
    if(button.dataset.action==='reject'){const input=document.querySelector(`[data-reason="${CSS.escape(button.dataset.id)}"]`);await reject(button.dataset.id,input?.value||'')}
  }catch(error){message=error.message;render()}
});

load().catch(error=>{app.innerHTML=`<main class="boot"><strong>Kunde inte ladda automationskön</strong><span>${esc(error.message)}</span><p><a class="button" href="./index.html">Till företagsportalen</a></p></main>`});
