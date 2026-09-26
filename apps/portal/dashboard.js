const app=document.getElementById('dashboard-app');
const pageParams=new URLSearchParams(location.search);
const isDemo=pageParams.get('demo')==='1';
const isSupabase=location.hostname==='ludwigberglund-coder.github.io'&&!isDemo;
const Demo=globalThis.RollandsDemoScenario;
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
let session=null;

function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function ore(v){return new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK',minimumFractionDigits:2}).format(Number(v||0)/100)}
function today(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function url(path){return path+(isDemo?(path.includes('?')?'&':'?')+'demo=1':'')}
function sidebar(){return '<aside class="sidebar"></aside>'}
function greeting(){
  const hour=Number(new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',hour:'2-digit',hour12:false}).format(new Date()).replace(/[^0-9]/g,'').slice(0,2));
  if(hour<11)return'God morgon';
  if(hour<17)return'God eftermiddag';
  return'God kväll';
}
async function api(path){
  const r=await fetch('/api/v1'+path,{credentials:'same-origin',headers:{Accept:'application/json',...(csrfToken?{'X-CSRF-Token':csrfToken}:{})},cache:'no-store'});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||'Begäran misslyckades.');
  return data;
}
function emptyMetrics(){
  return{
    receivables:{overdueOre:0,overdueCount:0},
    payables:{approvalCount:0,paymentCount:0},
    bank:{reviewCount:0},
    automation:{reviewCount:0},
    inventory:{pendingCount:0},
    accounting:{pendingUnlocks:0},
    loadErrors:[]
  }
}
function demoMetrics(){
  const s=Demo.state(),result=emptyMetrics();
  const open=(s.customerInvoices||[]).filter(i=>Number(i.remainingOre)>0);
  const overdue=open.filter(i=>i.dueDate<today());
  const payables=s.supplierInvoices||[];
  result.receivables.overdueOre=overdue.reduce((n,i)=>n+Number(i.remainingOre||0),0);
  result.receivables.overdueCount=overdue.length;
  result.payables.approvalCount=payables.filter(i=>i.status==='coded').length;
  result.payables.paymentCount=payables.filter(i=>['approved','payment-prepared','released'].includes(i.status)).length;
  result.bank.reviewCount=(s.bankPayments||[]).filter(p=>p.status==='unmatched').length;
  result.automation.reviewCount=(s.automationProposals||[]).filter(p=>!['approved','rejected','posted'].includes(p.status)).length;
  result.inventory.pendingCount=(s.inventoryAdjustments||[]).filter(x=>x.status==='pending').length;
  result.accounting.pendingUnlocks=(s.accountingUnlockRequests||[]).filter(x=>x.status==='pending').length;
  return result;
}
async function loadSupabaseMetricsFallback(ctx){
  const result=emptyMetrics();
  const filter='company_id=eq.'+encodeURIComponent(ctx.company.id);
  async function attempt(label,fn){try{await fn()}catch{result.loadErrors.push(label)}}
  await Promise.all([
    attempt('kundreskontra',async()=>{
      const rows=await window.LTSupabase.from('invoices',ctx.accessToken).select('due_date,remaining_ore,status',filter);
      const overdue=(rows||[]).filter(row=>Number(row.remaining_ore)>0&&String(row.due_date||'')<today());
      result.receivables.overdueCount=overdue.length;
      result.receivables.overdueOre=overdue.reduce((sum,row)=>sum+Math.max(0,Number(row.remaining_ore||0)),0);
    }),
    attempt('leverantörsfakturor',async()=>{
      const rows=await window.LTSupabase.from('supplier_invoices',ctx.accessToken).select('status',filter);
      result.payables.approvalCount=(rows||[]).filter(row=>row.status==='coded').length;
      result.payables.paymentCount=(rows||[]).filter(row=>['approved','payment-prepared','released'].includes(row.status)).length;
    }),
    attempt('bank',async()=>{
      const rows=await window.LTSupabase.from('bank_payments',ctx.accessToken).select('status',filter);
      result.bank.reviewCount=(rows||[]).filter(row=>row.status==='unmatched').length;
    }),
    attempt('automation',async()=>{
      const rows=await window.LTSupabase.from('automation_proposals',ctx.accessToken).select('status',filter);
      result.automation.reviewCount=(rows||[]).filter(row=>!['approved','rejected','posted'].includes(row.status)).length;
    }),
    attempt('lager',async()=>{
      const rows=await window.LTSupabase.from('inventory_adjustments',ctx.accessToken).select('status',filter);
      result.inventory.pendingCount=(rows||[]).filter(row=>row.status==='pending').length;
    }),
    attempt('periodupplåsningar',async()=>{
      const rows=await window.LTSupabase.from('period_unlock_requests',ctx.accessToken).select('status',filter);
      result.accounting.pendingUnlocks=(rows||[]).filter(row=>row.status==='pending').length;
    })
  ]);
  return result;
}
function normalizeDashboardMetrics(data){
  const value=data&&typeof data==='object'?data:{};
  return{
    receivables:{
      overdueOre:Number(value.receivables?.overdueOre||0),
      overdueCount:Number(value.receivables?.overdueCount||0)
    },
    payables:{
      approvalCount:Number(value.payables?.approvalCount||0),
      paymentCount:Number(value.payables?.paymentCount||0)
    },
    bank:{reviewCount:Number(value.bank?.reviewCount||0)},
    automation:{reviewCount:Number(value.automation?.reviewCount||0)},
    inventory:{pendingCount:Number(value.inventory?.pendingCount||0)},
    accounting:{pendingUnlocks:Number(value.accounting?.pendingUnlocks||0)},
    loadErrors:[]
  };
}
async function loadSupabaseMetrics(){
  const ctx=await window.LTSupabaseUat.context();
  if(!ctx?.authenticated||!ctx.company){location.href='./index.html';throw new Error('Ingen aktiv Supabase-session.')}
  session={authenticated:true,user:ctx.user,company:ctx.company};
  try{
    const data=await window.LTSupabase.rpc('portal_dashboard_metrics',{p_company_id:ctx.company.id},ctx.accessToken);
    if(data&&typeof data==='object')return normalizeDashboardMetrics(data);
  }catch{}
  return loadSupabaseMetricsFallback(ctx);
}
async function loadPrivateMetrics(){
  const result=emptyMetrics();
  async function attempt(label,fn){try{await fn()}catch{result.loadErrors.push(label)}}
  await Promise.all([
    attempt('kundreskontra',async()=>{
      const inv=(await api('/receivables')).invoices||[];
      const overdue=inv.filter(i=>Number(i.remainingOre)>0&&i.dueDate<today());
      result.receivables.overdueCount=overdue.length;
      result.receivables.overdueOre=overdue.reduce((sum,i)=>sum+Math.max(0,Number(i.remainingOre||0)),0);
    }),
    attempt('leverantörsfakturor',async()=>{
      const inv=(await api('/payables/invoices')).invoices||[];
      result.payables.approvalCount=inv.filter(i=>i.status==='coded').length;
      result.payables.paymentCount=inv.filter(i=>['approved','payment-prepared'].includes(i.status)).length;
    }),
    attempt('bank',async()=>{
      const rows=(await api('/bank/payments')).payments||[];
      result.bank.reviewCount=rows.filter(p=>p.status==='unmatched').length;
    }),
    attempt('automation',async()=>{
      const rows=(await api('/automation/proposals')).proposals||[];
      result.automation.reviewCount=rows.filter(p=>!['approved','rejected','posted'].includes(p.status)).length;
    }),
    attempt('lager',async()=>{
      result.inventory.pendingCount=((await api('/inventory/adjustments?status=pending')).adjustments||[]).length;
    }),
    attempt('periodupplåsningar',async()=>{
      result.accounting.pendingUnlocks=((await api('/accounting/unlock-requests?status=pending')).requests||[]).length;
    })
  ]);
  return result;
}
async function loadMetrics(){
  if(isDemo)return demoMetrics();
  if(isSupabase)return loadSupabaseMetrics();
  return loadPrivateMetrics();
}
function taskCard({title,text,href,count,priority='normal',tone='plain'},index){
  return `<a class="task-card ${esc(priority)} tone-${esc(tone)}" style="--task-delay:${index*55}ms" href="${url(href)}"><div><span class="task-state">${priority==='high'?'Prioriterat':'Att göra'}</span><h3>${esc(title)}</h3><p>${esc(text)}</p></div><strong>${esc(String(count))}</strong></a>`
}
function importantTasks(m){
  const tasks=[];
  if(Number(m.receivables.overdueCount)>0)tasks.push({title:'Följ upp förfallna kundfakturor',text:`${ore(m.receivables.overdueOre)} är förfallet.`,href:isDemo?'./receivables.html':'./index.html',count:m.receivables.overdueCount,priority:'high',tone:'peach'});
  if(Number(m.bank.reviewCount)>0)tasks.push({title:'Matcha bankhändelser',text:'Inbetalningar väntar på korrekt matchning.',href:'./bank.html',count:m.bank.reviewCount,priority:'high',tone:'sky'});
  if(Number(m.payables.approvalCount)>0)tasks.push({title:'Granska leverantörsfakturor',text:'Fakturor väntar på attest och kontroll.',href:'./payables.html',count:m.payables.approvalCount,priority:'high',tone:'lime'});
  if(Number(m.payables.paymentCount)>0)tasks.push({title:'Hantera leverantörsbetalningar',text:'Godkända fakturor är redo för nästa betalningssteg.',href:'./payments.html',count:m.payables.paymentCount,tone:'lime'});
  if(Number(m.automation.reviewCount)>0)tasks.push({title:'Granska automationsförslag',text:'Förslag väntar på mänsklig kontroll.',href:'./automation.html',count:m.automation.reviewCount,tone:'sky'});
  if(Number(m.accounting.pendingUnlocks)>0)tasks.push({title:'Besluta om periodupplåsning',text:'Begärda upplåsningar väntar på beslut.',href:'./accounting.html',count:m.accounting.pendingUnlocks,priority:'high',tone:'peach'});
  if(Number(m.inventory.pendingCount)>0)tasks.push({title:'Granska lagerjusteringar',text:'Inventerings- eller justeringsposter väntar.',href:'./inventory.html',count:m.inventory.pendingCount,tone:'plain'});
  return tasks.slice(0,6);
}
function render(m){
  const tasks=importantTasks(m);
  const firstName=String(session?.user?.displayName||session?.user?.username||(isDemo?'Demoanvändare':'')).trim().split(/\s+/)[0]||'';
  const hello=`${greeting()}${firstName?', '+esc(firstName):''}.`;
  const status=tasks.length
    ? `<span class="today-count"><i aria-hidden="true"></i>${tasks.length} ${tasks.length===1?'sak':'saker'} behöver din uppmärksamhet</span>`
    : '<span class="today-count calm"><i aria-hidden="true"></i>Inget akut i de viktigaste köerna</span>';
  const warning=m.loadErrors?.length?'<div class="overview-soft-warning">Några köer kunde inte läsas just nu. Övriga poster visas som vanligt.</div>':'';
  const taskMarkup=tasks.length
    ? tasks.map(taskCard).join('')
    : '<div class="overview-empty"><span class="empty-orbit" aria-hidden="true"></span><div><b>Arbetsdagen ser lugn ut.</b><p>Det finns inga kända akuta uppgifter i de viktigaste köerna just nu.</p></div></div>';
  app.innerHTML=`<div class="dash-shell">${sidebar()}<section class="dash-main"><header class="topbar"><div><h1>Översikt</h1><p>${today()} · företagets arbetsdag</p></div><div class="user-chip"><b>${esc(session?.user?.displayName||'Användare')}</b></div></header><main class="content dashboard-content"><section class="welcome-card"><div class="welcome-copy"><span class="eyebrow">Dagens fokus</span><h2>${hello}</h2><p>Här visas bara det viktigaste som behöver göras idag.</p>${status}</div><div class="welcome-motion" aria-hidden="true"><span></span><span></span><span></span><b></b></div></section>${warning}<section class="today-work"><div class="section-head"><div><span class="eyebrow">Prioriterat idag</span><h2>Det viktigaste just nu</h2></div></div><div class="task-grid">${taskMarkup}</div></section></main></section></div>`;
  globalThis.RollandsNavigation?.mount?.();
}
async function load(){
  if(isDemo){
    if(!Demo)throw new Error('Det gemensamma demoscenariot kunde inte laddas.');
    session={user:{displayName:'Demoanvändare'},company:{name:'Rollands Frukt o Grönt AB'}};
    render(await loadMetrics());
    return;
  }
  if(isSupabase){
    const metrics=await loadMetrics();
    render(metrics);
    return;
  }
  const s=await api('/session');
  if(!s.authenticated){location.href='./index.html';return}
  session=s;
  render(await loadMetrics());
}
load().catch(error=>{app.innerHTML=`<main class="boot"><strong>Översikten kunde inte laddas</strong><span>${esc(error.message)}</span></main>`});
