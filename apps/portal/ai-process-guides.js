'use strict';
(function(root,factory){
  const catalog=factory();
  if(typeof module==='object'&&module.exports)module.exports=catalog;
  else root.LTStudioAiProcessGuides=catalog;
})(typeof globalThis==='object'?globalThis:this,function(){
  // This is intentionally local, deterministic guidance. No customer data, prompts or
  // payment details are sent to a third-party model until the protected AI gateway is released.
  const processes=Object.freeze([
    {id:'all',label:'Alla områden'},
    {id:'invoices',label:'Kundfakturor'},
    {id:'purchases',label:'Inköp & underlag'},
    {id:'bank',label:'Bank & betalningar'},
    {id:'accounting',label:'Bokföring'},
    {id:'automation',label:'Förslag & godkännande'},
    {id:'reports',label:'Rapporter & moms'},
    {id:'closing',label:'Bokslut'},
    {id:'payroll',label:'Lön'},
    {id:'inventory',label:'Lager'}
  ]);
  const guides=Object.freeze([
    {id:'customer-invoice',process:'invoices',title:'Skapa och skicka en kundfaktura',
      question:'Hur fakturerar jag en kund?',keywords:'fakturera skapa sälja kund faktura utskick pris moms',
      lead:'Utgå från fakturaflödet i LT Studio. Kontrollera alltid uppgifterna innan en faktura skickas.',
      steps:['Öppna Kundfakturor och välj rätt kund.', 'Fyll i vad som sålts, datum, belopp och tillämplig moms.', 'Kontrollera förhandsvisningen och skicka först när allt stämmer.'],
      action:'Öppna kundfakturor',route:'invoices.html'},
    {id:'receivables',process:'invoices',title:'Se vilka kunder som inte betalat',
      question:'Vilka fakturor behöver följas upp?',keywords:'obetald förfallen kund påminnelse kundreskontra dröjsmål faktura',
      lead:'Här ser du kundfakturor och betalningsstatus. Automatiska bedömningar ersätter inte kontroll av underlag.',
      steps:['Öppna Kundreskontra och filtrera på obetalda eller förfallna fakturor.', 'Öppna aktuell faktura och kontrollera förfallodag och inbetalningar.', 'Följ upp med rätt åtgärd; kontrollera avtal och förutsättningar före avgift eller ränta.'],
      action:'Öppna kundreskontra',route:'index.html'},
    {id:'supplier-invoices',process:'purchases',title:'Ta hand om en leverantörsfaktura',
      question:'Hur hanterar jag en inköpsfaktura?',keywords:'leverantörsfaktura inköp leverantör attest konto moms betala',
      lead:'Börja med själva leverantörsfakturan och kontrollera att den avser företaget.',
      steps:['Öppna Leverantörsfakturor och hitta fakturan.', 'Jämför belopp, leverantör, datum och momsinformation mot originalet.', 'Låt behörig person granska förslaget innan betalning eller bokföring.'],
      action:'Öppna leverantörsfakturor',route:'payables.html'},
    {id:'receipts',process:'purchases',title:'Lämna in kvitton och dokument',
      question:'Var lägger jag underlag?',keywords:'kvitto kvitton bilaga inkorg pdf dokument uppladdning original',
      lead:'Använd dokumentinkorgen för underlag. LT Studio accepterar i dag enbart godkända passiva PDF-filer.',
      steps:['Öppna Dokument och ladda upp en tillåten PDF.', 'Kontrollera att underlaget är läsbart och hör till rätt företag.', 'Koppla underlaget till rätt affärshändelse i befintligt flöde.'],
      action:'Öppna dokument',route:'documents.html'},
    {id:'bank-reconciliation',process:'bank',title:'Stäm av banken',
      question:'Hur kontrollerar jag bankhändelser?',keywords:'bankkonto bankavstämning kontoutdrag avstämning saldo banktransaktion',
      lead:'Jämför bankhändelser med registrerade fakturor och bokföring. Gissa aldrig en matchning.',
      steps:['Öppna Bank & avstämning och välj rätt period.', 'Kontrollera betalningar mot kontoutdrag och fakturor.', 'Hantera differenser separat och lämna osäkra poster för granskning.'],
      action:'Öppna bankavstämning',route:'bank.html'},
    {id:'unplaced-payments',process:'bank',title:'Hitta en betalning utan koppling',
      question:'Vad gör jag med en oplacerad betalning?',keywords:'oplacerad okänd unmatched omatchad inbetalning utbetalning betalning',
      lead:'Pengar som inte kan matchas säkert ska inte gissas in på en faktura.',
      steps:['Öppna Oplacerade betalningar.', 'Kontrollera datum, belopp och betalningsreferens.', 'Koppla bara till faktura eller annan händelse när underlaget visar att det är rätt.'],
      action:'Öppna oplacerade betalningar',route:'unplaced-payments.html'},
    {id:'payment-overview',process:'bank',title:'Hitta och granska betalningar',
      question:'Var ser jag företagets betalningar?',keywords:'betalningshistorik överföring transaktion inbetalt utbetalt betalningar',
      lead:'Betalningsöversikten visar registrerade betalningar utan att assistenten flyttar pengar.',
      steps:['Öppna Betalningar och välj aktuell period.', 'Kontrollera betalningens status och kopplade underlag.', 'Använd rätt befintligt flöde för avvikande eller oplacerade betalningar.'],
      action:'Öppna betalningar',route:'payments.html'},
    {id:'bookkeeping',process:'accounting',title:'Förstå och kontrollera bokföringen',
      question:'Behöver jag kunna debet och kredit?',keywords:'bokföra bokföring debet kredit verifikation huvudbok konton period månad',
      lead:'Systemets bokföringsflöde och automatiska kontroller är utgångspunkten. Ett AI-förslag blir aldrig en bokförd verifikation av sig självt.',
      steps:['Öppna Bokföring och börja med förslagen eller periodkontrollen.', 'Se vad som behöver kontrolleras; visa kontodetaljer endast vid behov.', 'Godkänn först efter kontroll av underlag, belopp och rätt period.'],
      action:'Öppna bokföring',route:'accounting.html'},
    {id:'review-proposals',process:'automation',title:'Granska automatiska förslag',
      question:'Var godkänner jag förslag?',keywords:'automationskö attest automatisering godkänna granska förslag ai',
      lead:'Ett förslag är inte en bokning. Kontrollera både det som systemet vet och det som fortfarande är osäkert.',
      steps:['Öppna Automationskö och hitta rätt förslag.', 'Jämför förslaget med originalunderlaget och kontrollera period och belopp.', 'Godkänn, ändra eller avvisa genom befintligt behörighetskontrollerat flöde.'],
      action:'Öppna automationskön',route:'automation.html'},
    {id:'batches',process:'automation',title:'Godkänna en bokföringsbunt',
      question:'Hur godkänns bokföring i en bunt?',keywords:'bunt attester signera godkännande bokföra batch',
      lead:'Buntar kan kräva särskild attest. Assistenten kan inte kringgå attest eller periodlås.',
      steps:['Öppna Buntar och granska vilka poster som väntar.', 'Kontrollera underlagen och eventuella avvikelser.', 'Låt rätt behörig person godkänna enligt företagets arbetsflöde.'],
      action:'Öppna buntar',route:'batches.html'},
    {id:'reports',process:'reports',title:'Se hur företaget går',
      question:'Hur ser jag företagets resultat?',keywords:'resultat rapport resultaträkning balansräkning analys vinst kostnad omsättning',
      lead:'Rapporter visar bokförda uppgifter. De är inte en prognos eller ett färdigt bokslut.',
      steps:['Öppna Rapporter och välj önskad period.', 'Jämför totalsummor och se vilka delar som behöver förklaring.', 'Kontrollera att samtliga relevanta affärshändelser har bokförts innan du drar slutsatser.'],
      action:'Öppna rapporter',route:'reports.html'},
    {id:'vat',process:'reports',title:'Kontrollera momsen',
      question:'Hur vet jag om momsen stämmer?',keywords:'moms momssats momsrapport momsavstämning skatteverket ingående utgående',
      lead:'Moms kan inte alltid avgöras utifrån en procentsats. Avvikande transaktioner behöver särskild kontroll.',
      steps:['Öppna Rapporter och välj aktuell period.', 'Jämför utgående och ingående moms mot underlag och huvudbok.', 'Hantera avvikelser innan någon deklaration godkänns eller lämnas in.'],
      action:'Öppna rapporter',route:'reports.html'},
    {id:'close-year',process:'closing',title:'Förbered företagets bokslut',
      question:'Kan systemet hjälpa mig med bokslutet?',keywords:'bokslut årsbokslut årsredovisning bokföringsår stäng räkenskapsår årsskifte',
      lead:'Bokslutsfliken innehåller en säker regelbaserad förkontroll. Den ersätter inte en färdig granskad årsredovisning.',
      steps:['Öppna Bokslut och starta automatisk förkontroll.', 'Ta hand om de frågor och saknade underlag som systemet hittar.', 'Låt rätt behörig person slutgranska och godkänna innan året avslutas.'],
      action:'Öppna bokslut',route:'bokslut.html'},
    {id:'payroll',process:'payroll',title:'Förbered lönerna',
      question:'Hur kommer jag igång med löner?',keywords:'lön löner lönejournal arbetsgivare arbetsgivaravgift anställd',
      lead:'Löner måste kontrolleras mot anställningsuppgifter och gällande regler; en assistent får inte betala ut dem på egen hand.',
      steps:['Öppna Lön & lönejournal med rätt behörighet.', 'Kontrollera person, period och registrerade löneunderlag.', 'Granska beräkningar och låt behörig person godkänna arbetsflödet.'],
      action:'Öppna lönefliken',route:'payroll.html'},
    {id:'inventory',process:'inventory',title:'Förstå lager och svinn',
      question:'Hur kontrollerar jag lagret?',keywords:'lager inventering svinn varor lagervärde inventera',
      lead:'Lagervärden behöver inventeringsunderlag och korrekta beräkningar; gissade värden är inte tillåtna.',
      steps:['Öppna Lager & svinn och se registrerade förändringar.', 'Kontrollera mängder och stöd i faktiskt inventeringsunderlag.', 'Låt osäkra differenser bli granskningsuppgifter i stället för automatisk bokföring.'],
      action:'Öppna lager',route:'inventory.html'}
  ].map(item=>Object.freeze({...item,steps:Object.freeze(item.steps)})));
  const pages=Object.freeze({
    'dashboard.html':'all','ai-assistant.html':'all','ai-bookkeeping.html':'accounting',
    'invoices.html':'invoices','index.html':'invoices','receivables.html':'invoices','customers.html':'invoices',
    'payables.html':'purchases','supplier-ledger.html':'purchases','suppliers.html':'purchases','documents.html':'purchases',
    'bank.html':'bank','payments.html':'bank','unplaced-payments.html':'bank',
    'accounting.html':'accounting','accounts.html':'accounting',
    'automation.html':'automation','batches.html':'automation',
    'reports.html':'reports','bokslut.html':'closing','book-close-trial-balance.html':'closing',
    'payroll.html':'payroll','inventory.html':'inventory'
  });
  const stopWords=new Set(['jag','och','med','det','min','mitt','mina','hur','vad','var','kan','ska','skall','vill','ett','en','har','som','den','att','för','om','man','till','gör','göra','visa','behöver']);
  function normalized(value){
    return String(value??'').toLocaleLowerCase('sv-SE').replace(/\s+/g,' ').trim().slice(0,160);
  }
  function scope(value){
    return processes.some(item=>item.id===value)?value:'all';
  }
  function contextForPage(value){
    const filename=String(value??'').split('?')[0].split('/').pop();
    return Object.hasOwn(pages,filename)?pages[filename]:'all';
  }
  function search(query,selectedScope='all'){
    const current=scope(selectedScope),input=normalized(query);
    const tokens=[...new Set(input.split(/[^a-z0-9åäö]+/i).filter(word=>word.length>=3&&!stopWords.has(word)))].slice(0,12);
    const matched=guides.map((guide,index)=>{
      if(current!=='all'&&guide.process!==current)return null;
      if(!tokens.length)return{guide,index,score:0};
      const title=normalized(guide.title+' '+guide.question);
      const words=normalized(guide.keywords+' '+guide.lead+' '+guide.steps.join(' '));
      let score=0;
      for(const token of tokens){
        if(title.includes(token))score+=4;
        if(words.includes(token))score+=2;
      }
      if(input.length>=4&&title.includes(input))score+=8;
      return score?{guide,index,score}:null;
    }).filter(Boolean).sort((a,b)=>b.score-a.score||a.index-b.index);
    return matched.slice(0,input?10:current==='all'?9:12).map(item=>item.guide);
  }
  return Object.freeze({processes,guides,scope,contextForPage,search});
});