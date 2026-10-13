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
  let query='';
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
      '<a class="side-link active" aria-current="page" href="./ai-assistant.html'+suffix+'">AI-hjälp</a></div>'+
      '<div class="sidebar-footer">Guiden gör inga ändringar i ekonomin.</div></aside>';
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
      '<header class="topbar"><div><h1>AI-hjälp</h1><p>'+company+' / Ekonomi / AI-hjälp</p></div><div class="user-chip">'+esc(session?.user?.displayName||(demo?'Demoanvändare':'Inloggad användare'))+'</div></header>'+
      '<main class="content ai-assistant-content">'+
      '<section class="ai-assistant-hero"><div><span class="eyebrow">Din hjälp i hela ekonomisystemet</span>'+
      '<h2>Vad vill du få hjälp med?</h2><p>Hitta nästa steg för fakturor, bank, bokföring, moms, bokslut och mer – på enkel svenska.</p></div>'+
      '<div class="ai-assistant-state"><span class="ai-assistant-state-dot" aria-hidden="true"></span><div><strong>Guidad hjälp aktiv</strong><small>AI-analys av företagets uppgifter är ännu inte aktiverad.</small></div></div></section>'+
      '<section class="ai-assistant-search-panel" aria-labelledby="ai-assistant-query-label"><label id="ai-assistant-query-label" for="ai-assistant-query">Beskriv vad du behöver göra</label>'+
      '<input id="ai-assistant-query" type="search" maxlength="160" autocomplete="off" placeholder="Exempel: Jag har en betalning som inte matchar en faktura" value="'+esc(query)+'">'+
      '<p>Sökningen matchar färdiga guider lokalt i webbläsaren. Den är <strong>inte ett AI-svar</strong>, skickar ingen text till AI och sparar inga sökningar. Skriv inte in känsliga kunduppgifter.</p>'+
      '<div class="ai-assistant-scopes" role="group" aria-label="Välj ekonomiområde">'+
      allowed.map(item=>'<button type="button" data-ai-scope="'+esc(item.id)+'" aria-pressed="'+String(item.id===selectedScope)+'">'+esc(item.label)+'</button>').join('')+
      '</div></section>'+
      '<section aria-label="Guider och nästa steg"><div class="ai-assistant-section-heading"><h2>Så kan du gå vidare</h2><p id="ai-assistant-results-status" role="status" aria-live="polite"></p></div>'+
      '<div id="ai-assistant-results" class="ai-assistant-grid"></div></section>'+
      '<section class="ai-assistant-pilot"><div><span class="eyebrow">Nästa steg: riktig AI</span><h2>AI-förslag kommer byggas in i varje arbetsflöde</h2>'+
      '<p>Det befintliga AI-testet använder endast påhittade fakturor. För verkliga ekonomidata krävs först verifierad serverbehörighet, företagsisolering, budgetskydd och granskning. AI ska alltid lämna förslag – aldrig bokföra eller betala utan godkännande.</p></div>'+
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
  }
  init().catch(()=>{
    app.innerHTML='<main class="boot"><strong>Kunde inte öppna AI-hjälpen</strong><span>Logga in på nytt i kundportalen och försök igen.</span><a href="./index.html">Till inloggningen</a></main>';
  });
})();