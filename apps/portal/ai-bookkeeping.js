'use strict';
(function(){
  const app=document.getElementById('ai-bookkeeping-app');
  const demo=new URLSearchParams(location.search).get('demo')==='1';
  const liveHost=location.hostname==='ludwigberglund-coder.github.io';
  const options=Object.freeze([
    {id:'office-paper',label:'Kontorsmaterial',supplier:'Syntetiskt Kontor AB',description:'A4-kontorspapper, tio paket',account:'6110',accountName:'Kontorsmateriel'},
    {id:'software-service',label:'IT-tjänst',supplier:'Syntetisk IT AB',description:'IT-drifttjänst under september',account:'6540',accountName:'IT-tjänster'},
    {id:'cleaning-supplies',label:'Förbrukningsmaterial',supplier:'Syntetisk Städ AB',description:'Förbrukningsmaterial för städning',account:'5460',accountName:'Förbrukningsmaterial'}
  ]);
  // Matches the hard-disabled server release. A future release requires a reviewed
  // server + frontend change, not a client-side preference or environment flag.
  const AI_PILOT_RELEASED = false;
  let context=null,selected=options[0].id,busy=false,result=null,status='',statusKind='info';
  const esc=(text)=>String(text??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[char]));
  const kronor=(ore)=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:'SEK'}).format(Number(ore)/100);
  const scenario=()=>options.find(x=>x.id===selected)||options[0];
  const sampleRows=(account)=>[
    {account,debitOre:100000,creditOre:0,label:options.find(x=>x.account===account)?.accountName||'Kostnad'},
    {account:'2641',debitOre:25000,creditOre:0,label:'Ingående moms'},
    {account:'2440',debitOre:0,creditOre:125000,label:'Leverantörsskuld'}
  ];
  const accountNames=Object.freeze({'6110':'Kontorsmateriel','6540':'IT-tjänster','5460':'Förbrukningsmaterial','2641':'Ingående moms','2440':'Leverantörsskulder'});
  function validateResponse(response,companyId) {
    if(!response||response.status!=='manual-review'||response.posted!==false||
      String(response.companyId)!==String(companyId)||
      !Array.isArray(response.suggestion?.rows)||response.suggestion.rows.length!==3||
      response.suggestion.requiresHumanApproval!==true)throw new Error('INVALID_AI_PREVIEW');
    const rows=response.suggestion.rows.map(row=>{
      const account=String(row.account||'');
      const debitOre=Number(row.debitOre),creditOre=Number(row.creditOre);
      if(!Object.hasOwn(accountNames,account)||!Number.isSafeInteger(debitOre)||
        !Number.isSafeInteger(creditOre)||debitOre<0||creditOre<0||
        debitOre>10_000_000||creditOre>10_000_000)throw new Error('INVALID_AI_PREVIEW');
      return {account,debitOre,creditOre,label:accountNames[account]};
    });
    if(!['6110','5460','6540'].includes(rows[0].account)||
       rows[1].account!=='2641'||rows[2].account!=='2440'||
       rows[0].debitOre!==100000||rows[0].creditOre!==0||
       rows[1].debitOre!==25000||rows[1].creditOre!==0||
       rows[2].debitOre!==0||rows[2].creditOre!==125000||
       rows.reduce((sum,row)=>sum+row.debitOre-row.creditOre,0)!==0){
      throw new Error('INVALID_AI_PREVIEW');
    }
    return {kind:'ai',rows,reason:String(response.reason||'').slice(0,240)};
  }
  function rowsMarkup(rows) {
    return '<div class="ai-bookkeeping-lines" role="table" aria-label="Föreslagen kontering">'+
      '<div class="ai-bookkeeping-line ai-bookkeeping-head" role="row"><span>Konto</span><span>Debet</span><span>Kredit</span></div>'+
      rows.map(row=>'<div class="ai-bookkeeping-line" role="row"><span><strong>'+esc(row.account)+'</strong><small>'+esc(row.label)+'</small></span><span>'+ (row.debitOre?kronor(row.debitOre):'—')+'</span><span>'+ (row.creditOre?kronor(row.creditOre):'—')+'</span></div>').join('')+
      '</div>';
  }
  function resultMarkup(){
    if(!result)return '<div class="ai-bookkeeping-placeholder"><strong>Inget förslag ännu</strong><p>Välj ett påhittat exempel och klicka på ”Visa bokföringsexempel”. Du kan även prova AI-knappen när pilotfunktionen har aktiverats.</p></div>';
    const ai=result.kind==='ai';
    return '<article class="ai-bookkeeping-result" aria-label="'+(ai?'AI-förslag':'Bokföringsexempel')+'">'+
      '<div class="ai-bookkeeping-result-top"><div><span class="ai-bookkeeping-label">'+(ai?'AI-FÖRSLAG':'FAST RÄKNEEXEMPEL – INTE AI')+'</span><h3>'+ (ai?'AI föreslår följande':'Så här kan fakturan bokföras') +'</h3></div><span class="ai-bookkeeping-pill">Inte bokfört</span></div>'+
      '<p>'+esc(ai?result.reason:'Detta är ett i förväg bestämt utbildningsexempel och har inte analyserats av någon AI-modell.')+'</p>'+
      rowsMarkup(result.rows)+
      '<p class="ai-bookkeeping-footnote"><strong>Mänsklig granskning krävs.</strong> Förslaget är bara en förhandsvisning. Det sparas inte som verifikation eller i automationskön.</p>'+
      '<a class="ai-bookkeeping-textlink" href="./automation.html'+(demo?'?demo=1':'')+'">Öppna automationskön →</a></article>';
  }
  function sidebar(){
    const suffix=demo?'?demo=1':'';
    return '<aside class="sidebar"><div class="logo"><strong>LT Studio</strong><small>FÖRETAGSPORTAL</small></div>'+
      '<div class="company-pill">'+esc(context?.company?.name||(demo?'Demoföretag':'Företaget'))+'<br><small>'+(demo?'Exempelläge':'Personlig session')+'</small></div>'+
      '<div class="side-group"><span>Ekonomi</span><a class="side-link" href="./dashboard.html'+suffix+'">Översikt</a>'+
      '<a class="side-link" href="./payables.html'+suffix+'">Leverantörsfakturor</a><a class="side-link active" aria-current="page" href="./ai-bookkeeping.html'+suffix+'">AI-bokföring</a>'+
      '<a class="side-link" href="./automation.html'+suffix+'">Automationskö</a><a class="side-link" href="./accounting.html'+suffix+'">Bokföring</a></div>'+
      '<div class="sidebar-footer">Förslag behöver granskas av en behörig person innan bokföring.</div></aside>';
  }
  function render(){
    const current=scenario();
    // The Edge gateway is intentionally not deployed and has hard-coded release locks.
    // Keep the action disabled until a separately reviewed release changes that contract.
    const canCall=Boolean(AI_PILOT_RELEASED&&!demo&&liveHost&&context?.authenticated&&context?.company&&['admin','accountant'].includes(context?.membership?.role));
    app.innerHTML='<div class="portal">'+sidebar()+
      '<section class="main"><header class="topbar"><div><h1>AI-bokföring</h1><p>'+esc(context?.company?.name||(demo?'Demoföretag':'Företaget'))+' / Ekonomi / AI-bokföring</p></div>'+
      '<div class="user-chip"><span>'+esc(context?.user?.displayName||(demo?'Demoanvändare':'Inloggad användare'))+'</span></div></header>'+
      '<main class="content ai-bookkeeping-content"><div class="ai-bookkeeping-intro"><span class="eyebrow">Bokföring på enkelt språk</span>'+
      '<h2>Få hjälp att förstå hur en faktura ska bokföras</h2><p>Testa med påhittade inköp innan AI-bokföringen öppnas för riktiga kundunderlag. AI:n får aldrig bokföra eller betala något på egen hand.</p></div>'+
      '<section class="ai-bookkeeping-notice"><strong>Begränsat testläge</strong><span>Inga riktiga fakturor får laddas upp här. AI-anslutningen öppnas först efter säkerhetskontroller och godkänd aktivering. Förhandsvisningarna nedan är exempel tills dess.</span></section>'+
      '<div class="ai-bookkeeping-grid"><section class="ai-bookkeeping-panel"><h3>1. Välj ett exempel</h3><label for="ai-scenario">Påhittad leverantörsfaktura</label>'+
      '<select id="ai-scenario" '+(busy?'disabled':'')+'>'+options.map(opt=>'<option value="'+esc(opt.id)+'"'+(opt.id===selected?' selected':'')+'>'+esc(opt.label)+'</option>').join('')+'</select>'+
      '<div class="ai-bookkeeping-facts"><div><small>Leverantör</small><strong>'+esc(current.supplier)+'</strong></div><div><small>Inköp</small><strong>'+esc(current.description)+'</strong></div>'+
      '<div><small>Exklusive moms</small><strong>1 000 kr</strong></div><div><small>Moms (25 %)</small><strong>250 kr</strong></div>'+
      '<div class="ai-bookkeeping-total"><small>Att betala</small><strong>1 250 kr</strong></div></div>'+
      '<div class="ai-bookkeeping-actions"><button class="button" type="button" data-ai-action="example" '+(busy?'disabled':'')+'>Visa bokföringsexempel</button>'+
      '<button class="button ghost" type="button" data-ai-action="analyze" '+(!canCall||busy?'disabled':'')+'>'+(busy?'Analyserar…':'Prova med AI (pilot)')+'</button></div>'+
      '<small class="ai-bookkeeping-hint">'+(canCall?'AI-knappen kontaktar bara den säkrade pilotfunktionen. Om den inte är aktiverad visas ett tydligt meddelande.':'AI-anslutningen är ännu inte aktiverad. Använd det fasta bokföringsexemplet; inga kunduppgifter skickas till någon AI-modell.')+'</small>'+
      '<div id="ai-bookkeeping-status" class="ai-bookkeeping-status '+esc(statusKind)+'" role="status" aria-live="polite">'+esc(status)+'</div></section>'+
      '<section class="ai-bookkeeping-panel ai-bookkeeping-result-panel"><h3>2. Granska förslaget</h3>'+resultMarkup()+'</section></div>'+
      '<div class="ai-bookkeeping-next"><h3>Vad händer när AI-bokföringen är färdig?</h3><p>Då ska kunden välja en befintlig faktura eller ett kvitto i LT Studio, få ett kontrollerat förslag och godkänna det i samma automationskö som används i dag. Vi aktiverar inte hantering av riktiga underlag förrän dataskydd, bokföringsregler och företagsisolering har verifierats.</p></div>'+
      '</main></section></div>';
  }
  function showExample() {
    result={kind:'example',rows:sampleRows(scenario().account),reason:''};
    status='Exemplet visas. Det är en fast demonstrationskontering, inte ett AI-svar.';
    statusKind='info';render();
  }
  async function runAiPilot(){
    if(busy)return;
    // Never trust disabled HTML buttons alone: the delegated event handler
    // must also reject calls while the server release is locked.
    if(!AI_PILOT_RELEASED){status='AI-testet är ännu inte aktiverat. Visa bokföringsexemplet så länge.';statusKind='warning';render();return;}
    if(demo||!liveHost){status='AI kräver den inloggade LT Studio-portalen.';statusKind='warning';render();return;}
    busy=true;result=null;status='Kontrollerar session och skickar endast det påhittade exemplet…';statusKind='info';render();
    try{
      const ctx=await window.LTSupabaseUat.context();
      if(!ctx?.authenticated||!ctx.company||!['admin','accountant'].includes(ctx.membership?.role)){
        throw new Error('AI_TEST_ACCESS_DENIED');
      }
      context=ctx;
      const payload={companyId:String(ctx.company.id),scenario:selected,
        requestId:'ai-pilot-'+crypto.randomUUID()};
      const response=await window.LTSupabase.functions.invoke('ai-bookkeeping-pilot',payload,ctx.accessToken);
      result=validateResponse(response,ctx.company.id);
      status='AI-förslaget är klart. Det är inte bokfört eller sparat.';
      statusKind='success';
    }catch(error){
      result=null;
      const code=String(error?.code||error?.data?.code||'');
      status=code==='AI_TEST_ACCESS_DENIED'||error?.status===401||error?.status===403
        ?'Din session eller behörighet tillåter inte AI-testet. Kontrollera din inloggning.'
        :code==='AI_PILOT_NOT_RELEASED'||code==='AI_PILOT_DISABLED'||error?.status===404
          ?'AI-testet är ännu inte aktiverat. Visa bokföringsexemplet så länge.'
          :code==='BUDGET_NOT_RESERVED'||error?.status===429
            ?'Dagens AI-testgräns är nådd. Ingen kostnad uppstår; använd bokföringsexemplet.'
            :'AI-testet kunde inte genomföras. Ingen bokföring ändrades.';
      statusKind='warning';
    }finally{busy=false;render();}
  }
  document.addEventListener('change',event=>{
    const target=event.target;
    if(target?.id!=='ai-scenario'||busy)return;
    if(options.some(item=>item.id===target.value)){
      selected=target.value;result=null;status='';render();
    }
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-ai-action]');
    if(!button||button.disabled||busy)return;
    if(button.dataset.aiAction==='example')showExample();
    if(button.dataset.aiAction==='analyze')void runAiPilot();
  });
  async function init(){
    if(demo){
      context={user:{displayName:'Demoanvändare'},company:{name:'Demoföretag'}};
    }else if(!liveHost){
      app.innerHTML='<main class="boot"><strong>AI-bokföring</strong><span>Öppna LT Studios kundportal för att använda den här sidan.</span></main>';
      return;
    }else{
      context=await window.LTSupabaseUat.context();
      if(!context?.authenticated||!context.company){
        location.href='./index.html';return;
      }
    }
    render();
  }
  init().catch(()=>{
    app.innerHTML='<main class="boot"><strong>Kunde inte öppna AI-bokföring</strong><span>Logga in igen i kundportalen och försök på nytt.</span><a href="./index.html">Till inloggningen</a></main>';
  });
})();
