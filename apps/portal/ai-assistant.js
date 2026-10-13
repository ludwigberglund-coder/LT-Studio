'use strict';
(function(){
  const app=document.getElementById('ai-assistant-app');
  const catalog=window.LTStudioAiProcessGuides;
  if(!app||!catalog)return;
  const params=new URLSearchParams(location.search);
  const demo=params.get('demo')==='1';
  const liveHost=location.hostname==='ludwigberglund-coder.github.io';
  const allowedRoutes=Object.freeze({
    readonly:new Set(['invoices.html','index.html','payables.html','supplier-ledger.html','documents.html','reports.html','bokslut.html']),
    approver:new Set(['payables.html','supplier-ledger.html','documents.html','payments.html','automation.html','batches.html','accounting.html','reports.html','bokslut.html'])
  });
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));
  let session=null;
  let selectedScope=catalog.scope(params.get('from'));
  if(selectedScope==='all')selectedScope=catalog.contextForPage(params.get('from'));
  let query='';
  // The existing automation queue is read-only here. Actual AI posting is not released.
  const financeReviewRoles=new Set(['admin','accountant','approver']);
  function mayReadExistingProposals(){return financeReviewRoles.has(role());}
  async function loadExistingProposalSummary(){
    if(demo||!liveHost||!mayReadExistingProposals()||!session?.company?.id||!session.accessToken)return;
    const status=document.getElementById('ai-bookkeeper-queue-status');
    if(!status)return;
    try{
      const filter='company_id=eq.'+encodeURIComponent(session.company.id)+'&order=created_at.desc&limit=500';
      const rows=await window.LTSupabase.from('automation_proposals',session.accessToken)
        .select('id,company_id,status',filter);
      if(!Array.isArray(rows)||rows.some(row=>String(row.company_id)!==String(session.company.id)))throw new Error('INACCESSIBLE_QUEUE');
      const open=rows.filter(row=>row.status==='ready-for-approval'||row.status==='manual-review').length;
      const review=rows.filter(row=>row.status==='manual-review').length;
      status.textContent='Befintlig automationskö: '+open+' öppna förslag, varav '+review+' kräver extra granskning.'+
        (rows.length===500?' Visar högst 500 senaste poster.':'')+' Dessa förslag är inte verifierade som AI-genererade eller bokförda.';
    }catch{
      status.textContent='Kunde inte läsa automationskön just nu. Öppna den via knappen för att kontrollera förslagen.';
    }
  }
  function bookkeeperMarkup(canReview){
    const q=demo?'?demo=1':'';
    return '<section class="ai-bookkeeper-workspace" aria-labelledby="ai-bookkeeper-title">'+
      '<div class="ai-bookkeeper-head"><div><span class="eyebrow">Din framtida automatiska bokföring</span>'+
      '<h2 id="ai-bookkeeper-title">Från underlag till färdig bokföring</h2>'+
      '<p>Här samlas bokföringsarbetet. Du ska kunna lämna underlagen till AI, som tolkar, kontrollerar och – när säkerheten är verifierad – bokför åt företaget.</p></div>'+
      '<span class="ai-bookkeeper-phase">Säker pilot · ingen automatbokföring</span></div>'+
      '<div class="ai-bookkeeper-steps" aria-label="Arbetsflöde för löpande bokföring">'+
      '<div><strong>1. Underlag</strong><span>PDF, fakturor och bankhändelser hanteras i befintliga flöden.</span></div>'+
      '<div><strong>2. AI-kontering</strong><span>Verkliga AI-förslag är ännu inte aktiverade. En syntetisk motor utvecklas.</span></div>'+
      '<div><strong>3. Bokföring</strong><span>Först granskning. Senare kan godkända standardfall automatbokföras med uttryckligt tillstånd.</span></div>'+
      '</div>'+
      '<div class="ai-bookkeeper-actions"><a href="./documents.html'+q+'">Öppna underlag <span aria-hidden="true">→</span></a>'+
      (canReview?'<a href="./automation.html'+q+'">Granska befintliga förslag <span aria-hidden="true">→</span></a>':'')+
      '</div>'+
      '<p class="ai-bookkeeper-queue" id="ai-bookkeeper-queue-status" role="status" aria-live="polite">'+
      (demo?'Demoläge med fiktiva uppgifter. Inga verkliga förslag hämtas.':canReview?'Kontrollerar företagets befintliga automationskö…':'Förslagskö kräver bokförings- eller granskningsbehörighet.')+'</p>'+
      '<p class="ai-bookkeeper-caution">AI har ännu inte åtkomst till dina riktiga underlag och kan inte bokföra automatiskt. Bankbetalningar, lönekörningar och deklarationer ingår inte i planerad automatbokföring.</p>'+
      '</section>';
  }

  function role(){
    return demo?'admin':String(session?.membership?.role||'');
  }
  function guidePermitted(guide){
    const current=role();
    if(current==='admin'||current==='accountant')return true;
    const allowed=allowedRoutes[current];
    return Boolean(allowed&&allowed.has(guide.route));
  }
  function visibleProcesses(){
    return catalog.processes.filter(process=>process.id==='all'||
      catalog.guides.some(guide=>guide.process===process.id&&guidePermitted(guide)));
  }
  function visibleGuides(){
    return catalog.search(query,selectedScope).filter(guidePermitted);
  }
  function hrefForGuide(guide){
    // route is defined in the frozen catalog, never assembled from typed text or query params.
    return './'+guide.route+(demo?'?demo=1':'');
  }
  function guideMarkup(guide){
    const process=catalog.processes.find(item=>item.id===guide.process);
    return '<article class="ai-assistant-card"><span class="ai-assistant-category">'+esc(process?.label||'Ekonomi')+'</span>'+
      '<h3>'+esc(guide.title)+'</h3><p class="ai-assistant-question">'+esc(guide.question)+'</p>'+
      '<p>'+esc(guide.lead)+'</p><ol>'+guide.steps.map(step=>'<li>'+esc(step)+'</li>').join('')+'</ol>'+
      '<a class="ai-assistant-action" href="'+esc(hrefForGuide(guide))+'">'+esc(guide.action)+' <span aria-hidden="true">→</span></a>'+
      '</article>';
  }
  function renderResults(){
    const list=document.getElementById('ai-assistant-results');
    const status=document.getElementById('ai-assistant-results-status');
    if(!list||!status)return;
    const guides=visibleGuides();
    status.textContent=guides.length
      ? (query.trim()?'Hittade '+guides.length+' relevanta guider (lokal sökning).':'Välj en guide för att komma vidare.')
      : 'Ingen guide matchade sökningen eller din behörighet. Prova andra ord eller välj ett annat område.';
    list.innerHTML=guides.length?guides.map(guideMarkup).join(''):
      '<div class="ai-assistant-empty"><strong>Inga träffar ännu</strong><p>Prova till exempel ”oidentifierad betalning”, ”kvitto” eller ”bokslut”.</p></div>';
  }
  function sidebar(){
    const suffix=demo?'?demo=1':'';
    return '<aside class="sidebar"><div class="logo"><strong>LT Studio</strong><small>FÖRETAGSPORTAL</small></div>'+
      '<div class="company-pill">'+esc(session?.company?.name||(demo?'Demoföretag':'Företaget'))+'</div>'+
      '<div class="side-group"><span>Arbetsyta</span><a class="side-link" href="./dashboard.html'+suffix+'">Översikt</a>'+
      '<a class="side-link active" aria-current="page" href="./ai-assistant.html'+suffix+'">AI-bokförare</a></div>'+
      '<div class="sidebar-footer">AI-bokföraren är ännu inte aktiverad för riktiga bokningar.</div></aside>';
  }
  function render(){
    const allowed=visibleProcesses();
    if(!allowed.some(item=>item.id===selectedScope))selectedScope='all';
    const canTest=role()==='admin'||role()==='accountant';
    const company=esc(session?.company?.name||(demo?'Demoföretag':'Företaget'));
    const pilotLink=canTest
      ?'<a class="ai-assistant-pilot-link" href="./ai-bookkeeping.html'+(demo?'?demo=1':'')+'">Öppna säkert bokföringsexempel <span aria-hidden="true">→</span></a>'
      :'<span>AI-testet kräver administratörs- eller redovisningsbehörighet.</span>';
    app.innerHTML='<div class="portal">'+sidebar()+'<section class="main">'+
      '<header class="topbar"><div><h1>AI-bokförare</h1><p>'+company+' / Ekonomi / AI-bokförare</p></div><div class="user-chip">'+esc(session?.user?.displayName||(demo?'Demoanvändare':'Inloggad användare'))+'</div></header>'+
      '<main class="content ai-assistant-content">'+
      '<section class="ai-assistant-hero"><div><span class="eyebrow">LT Studio · AI-bokförare</span>'+
      '<h2>Din bokföring, automatiserad</h2><p>Målet är att AI ska ta hand om det löpande arbetet. Du hanterar bara osäkra poster och viktiga beslut. Under uppbyggnaden finns tydliga kontrollsteg.</p></div>'+
      '<div class="ai-assistant-state"><span class="ai-assistant-state-dot" aria-hidden="true"></span><div><strong>Guidad hjälp aktiv</strong><small>AI-kontering och automatbokföring på riktiga underlag är ännu inte aktiverade.</small></div></div></section>'+
      bookkeeperMarkup(mayReadExistingProposals())+
      '<details class="ai-assistant-guides" id="ai-assistant-guides"><summary>AI-hjälp: visa guider för ekonomin</summary>'+
      '<section class="ai-assistant-search-panel" aria-labelledby="ai-assistant-query-label"><label id="ai-assistant-query-label" for="ai-assistant-query">Beskriv vad du behöver göra</label>'+
      '<input id="ai-assistant-query" type="text" role="searchbox" inputmode="search" maxlength="160" autocomplete="off" placeholder="Exempel: Jag har en betalning som inte matchar en faktura" value="'+esc(query)+'">'+
      '<p>Sökningen matchar färdiga guider lokalt i webbläsaren. Den är <strong>inte ett AI-svar</strong>, skickar ingen text till AI och sparar inga sökningar. Skriv inte in känsliga kunduppgifter.</p>'+
      '<div class="ai-assistant-scopes" role="group" aria-label="Välj ekonomiområde">'+
      allowed.map(item=>'<button type="button" data-ai-scope="'+esc(item.id)+'" aria-pressed="'+String(item.id===selectedScope)+'">'+esc(item.label)+'</button>').join('')+
      '</div></section>'+
      '<section aria-label="Guider och nästa steg"><div class="ai-assistant-section-heading"><h2>Så kan du gå vidare</h2><p id="ai-assistant-results-status" role="status" aria-live="polite"></p></div>'+
      '<div id="ai-assistant-results" class="ai-assistant-grid"></div></section></details>'+
      '<section class="ai-assistant-pilot"><div><span class="eyebrow">Teknisk testmiljö</span><h2>Testa AI-kontering med påhittade underlag</h2>'+
      '<p>Den nuvarande AI-piloten använder bara påhittade fakturor. Verklig AI-kontering kräver skyddade underlag, säker behörighet och verifierade kontroller. Framtida automatbokföring kräver separat tillstånd och särskilda säkerhetsregler.</p></div>'+
      '<div class="ai-assistant-pilot-action">'+pilotLink+'</div></section>'+
      '</main></section></div>';
    renderResults();
  }
  document.addEventListener('input',event=>{
    if(event.target?.id!=='ai-assistant-query')return;
    query=String(event.target.value||'').slice(0,160);
    renderResults();
  });
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('[data-ai-scope]');
    if(!button)return;
    const next=catalog.scope(button.dataset.aiScope);
    if(!visibleProcesses().some(item=>item.id===next))return;
    selectedScope=next;
    const buttons=document.querySelectorAll('[data-ai-scope]');
    buttons.forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.aiScope===next)));
    renderResults();
  });
  async function init(){
    if(demo){
      session={company:{name:'Demoföretag'},user:{displayName:'Demoanvändare'},membership:{role:'admin'}};
    }else if(!liveHost){
      app.innerHTML='<main class="boot"><strong>AI-hjälp</strong><span>Öppna LT Studios företagsportal för att använda denna sida.</span></main>';
      return;
    }else{
      if(!window.LTSupabaseUat||!window.LTSupabase){
        throw new Error('SESSION_UNAVAILABLE');
      }
      session=await window.LTSupabaseUat.context();
      if(!session?.authenticated||!session.company||!session.membership){
        location.replace('./index.html');return;
      }
    }
    render();
    void loadExistingProposalSummary();
  }
  init().catch(()=>{
    app.innerHTML='<main class="boot"><strong>Kunde inte öppna AI-hjälpen</strong><span>Logga in på nytt i kundportalen och försök igen.</span><a href="./index.html">Till inloggningen</a></main>';
  });
})();