/* Läsbaserad guide: ingen uppgift markeras som avstämd av denna komponent. */
(function(){
  'use strict';
  const steps=[
    {title:'Stäm av bankhändelser',description:'Kontrollera att alla bankhändelser hör till rätt faktura eller affärshändelse.',path:'./bank.html'},
    {title:'Hantera oplacerade betalningar',description:'Granska betalningar som ännu inte kopplats till en faktura eller annan bokföring.',path:'./unplaced-payments.html'},
    {title:'Kontrollera kundfakturorna',description:'Se över obetalda, krediterade och förfallna kundfakturor.',path:'./invoices.html'},
    {title:'Kontrollera leverantörsfakturorna',description:'Se över attester, bokförda skulder och betalningsstatus.',path:'./payables.html'},
    {title:'Kontrollera bokföringsunderlag',description:'Granska PDF-underlagens koppling till rätt affärshändelser.',path:'./documents.html'},
    {title:'Godkänn väntande buntar',description:'Kontrollera att alla aktuella buntar har granskats innan du avslutar månaden.',path:'./batches.html'},
    {title:'Granska rapporter och moms',description:'Jämför rapporterna mot verifikationer och underlag; kontrollera moms separat.',path:'./reports.html'}
  ];
  function escapeHtml(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function inspectEntries(rows,period){
    const current=(Array.isArray(rows)?rows:[]).filter(function(entry){
      return String(entry&&entry.postingDate||'').slice(0,7)===period;
    });
    const findings=[];
    for(const entry of current){
      const number=String(entry.number||'Okänt nummer');
      if(!String(entry.description||'').trim()){
        findings.push({number:number,kind:'Beskrivning saknas'});
      }
      if(!Array.isArray(entry.lines)||entry.lines.length<2){
        findings.push({number:number,kind:'Kontorader kunde inte kontrolleras'});
        continue;
      }
      let debet=0,kredit=0,valid=true;
      for(const line of entry.lines){
        const debit=Number(line.debitOre),credit=Number(line.creditOre);
        if(!Number.isSafeInteger(debit)||debit<0||!Number.isSafeInteger(credit)||credit<0){
          valid=false;
          break;
        }
        debet+=debit;
        kredit+=credit;
      }
      if(!valid||!Number.isSafeInteger(debet)||!Number.isSafeInteger(kredit)){
        findings.push({number:number,kind:'Beloppsuppgifter kunde inte kontrolleras'});
      }else if(debet!==kredit){
        findings.push({number:number,kind:'Debet och kredit stämmer inte'});
      }
    }
    return {loadedCount:current.length,findings:findings};
  }
  function journalReview(state,period){
    if(!Array.isArray(state.journalEntries)){
      return '<div class="month-close-findings" role="status"><h3>Snabbkontroll av verifikationer</h3><p>Verifikationsuppgifter saknas. Ingen automatisk kontroll har kunnat göras.</p></div>';
    }
    const review=inspectEntries(state.journalEntries,period);
    const total=review.findings.length;
    const headline=total
      ? total===1?'1 möjlig avvikelse i de inlästa uppgifterna behöver granskas.':total+' möjliga avvikelser i de inlästa uppgifterna behöver granskas.'
      : review.loadedCount
        ? 'Inga avvikelser hittades bland de inlästa verifikationerna.'
        : 'Inga verifikationer finns i den inlästa listan för perioden.';
    const examples=review.findings.slice(0,3).map(function(finding){
      return '<li><strong>'+escapeHtml(finding.number)+'</strong>: '+escapeHtml(finding.kind)+'</li>';
    }).join('');
    return '<div class="month-close-findings" role="status"><h3>Snabbkontroll av verifikationer</h3>'+
      '<p>'+escapeHtml(headline)+'</p>'+
      (total?'<ul>'+examples+'</ul>':'')+
      '<p class="month-close-findings-disclaimer">Kontrollen gäller bara inlästa poster och ersätter inte fullständig avstämning. Saknade kontorader kan bero på ofullständig inläsning.</p>'+
      '<a href="#journal-entries">Granska verifikationerna ovan</a></div>';
  }


  function evaluateCoverage(state,period){
    const c=state&&state.coverage;
    if(!c||c.status!=='checked'||c.period!==period||!state.companyId||String(c.companyId)!==String(state.companyId)){
      return {status:'unavailable',reason:'Databasen kunde inte bekräfta hur många poster som skulle läsas in.'};
    }
    // Counts are only a point-in-time comparison. Never present old snapshots as current.
    const checkedAt=Date.parse(String(c.checkedAt||''));
    const age=Date.now()-checkedAt;
    if(!Number.isFinite(checkedAt)||age< -30000||age>5*60*1000){
      return {status:'unavailable',reason:'Kontrollen är äldre än fem minuter eller saknar en giltig tidpunkt. Läs in uppgifterna igen.'};
    }
    const keys=['totalEntries','totalLines','periodEntries','loadedEntries','loadedLines','loadedPeriodEntries'];
    if(keys.some(key=>!Number.isSafeInteger(c[key])||c[key]<0)){
      return {status:'unavailable',reason:'Databasen skickade ofullständiga antalsuppgifter.'};
    }
    const integrity=c.integrity;
    if(!integrity||integrity.checkedEntries!==c.loadedEntries||integrity.checkedLines!==c.loadedLines){
      return {status:'unavailable',reason:'Kontoradernas koppling till verifikationerna kunde inte kontrolleras.'};
    }
    const integrityKeys=['duplicateEntryIds','duplicateLineIds','orphanLines','wrongCompanyLines'];
    if(integrityKeys.some(key=>!Number.isSafeInteger(integrity[key])||integrity[key]<0)){
      return {status:'unavailable',reason:'Integritetskontrollen gav ogiltiga värden.'};
    }
    const integrityProblems=integrityKeys.filter(key=>integrity[key]>0);
    const differences=[
      ['verifikationer för företaget',c.loadedEntries,c.totalEntries],
      ['kontorader för företaget',c.loadedLines,c.totalLines],
      ['verifikationer för månaden',c.loadedPeriodEntries,c.periodEntries]
    ].filter(([,loaded,expected])=>loaded!==expected);
    return {status:differences.length||integrityProblems.length?'mismatch':'matched',differences,integrityProblems,counts:c};
  }
  function reloadAction(){
    return '<button class="button ghost small month-close-refresh" type="button" data-action="refresh-month-coverage">Uppdatera kontrollen</button>';
  }
  function coveragePanel(state,period){
    const coverage=evaluateCoverage(state,period);
    if(coverage.status==='unavailable'){
      return '<div class="month-close-coverage month-close-coverage-unknown" role="status">'+
        '<h3>Inläsningen behöver kontrolleras</h3><p>'+escapeHtml(coverage.reason)+'</p>'+
        '<p>Du kan granska de synliga posterna, men systemet vet inte om alla verifikationer och kontorader kom med.</p>'+reloadAction()+'</div>';
    }
    const c=coverage.counts;
    const lines=[
      'Verifikationer för företaget: '+c.loadedEntries+' av '+c.totalEntries,
      'Kontorader för företaget: '+c.loadedLines+' av '+c.totalLines,
      'Verifikationer för '+period+': '+c.loadedPeriodEntries+' av '+c.periodEntries
    ].map(value=>'<li>'+escapeHtml(value)+'</li>').join('');
    const integrityLabels={duplicateEntryIds:'Samma verifikation förekommer flera gånger',duplicateLineIds:'Samma kontorad förekommer flera gånger',orphanLines:'Kontorader saknar inläst verifikation',wrongCompanyLines:'Kontorader har fel företagskoppling'};
    const integrityWarnings=(coverage.integrityProblems||[]).map(key=>'<li>'+escapeHtml(integrityLabels[key])+': '+c.integrity[key]+'</li>').join('');
    const notice=coverage.status==='matched'
      ? 'Antalen stämmer med de företagsspecifika databassvaren vid kontrolltillfället.'
      : 'Antalen stämmer inte. En del poster kan saknas i den inlästa listan. Läs in sidan igen och granska avvikelsen.';
    return '<div class="month-close-coverage '+(coverage.status==='matched'?'month-close-coverage-matched':'month-close-coverage-mismatch')+'" role="status">'+
      '<h3>Kontroll av inlästa poster</h3><p>'+escapeHtml(notice)+'</p><ul>'+lines+integrityWarnings+'</ul>'+
      '<p class="month-close-findings-disclaimer">Detta jämför antal enligt Supabase med antal som lästs in. Kontroll gjord: '+escapeHtml(c.checkedAt)+'. Det verifierar inte varje post, bank, moms eller hela månadens avstämning. Pågående ändringar kan kräva ny inläsning.</p>'+reloadAction()+'</div>';
  }

  function render(options){
    const state=options||{};
    const period=/^\d{4}-(0[1-9]|1[0-2])$/.test(String(state.period||''))?String(state.period):'Okänd period';
    const count=Number(state.visibleEntries);
    const shown=Number.isFinite(count)&&count>=0?Math.trunc(count):0;
    const verified=Boolean(state.periodExists);
    const locked=verified&&state.periodStatus==='locked';
    const label=locked?'Låst':verified&&state.periodStatus==='open'?'Öppen':'Status behöver kontrolleras';
    const message=locked
      ? 'Perioden är låst. Ett lås bevisar inte att bank, underlag och moms har stämts av.'
      : 'Guiden hjälper dig att kontrollera månaden före låsning. Den gör ingen automatisk avstämning.';
    const q=state.demo?'?demo=1':'';
    const items=steps.map(function(step){
      return '<li><div><strong>'+escapeHtml(step.title)+'</strong><p>'+escapeHtml(step.description)+'</p></div>'+
        '<div class="month-close-actions"><span>Kontrollera manuellt</span>'+
        '<a href="'+escapeHtml(step.path+q)+'">Öppna <span aria-hidden="true">→</span></a></div></li>';
    }).join('');
    return '<section class="month-close-guide panel" aria-labelledby="month-close-title">'+
      '<div class="month-close-heading"><div><span class="eyebrow">Månadsavstämning</span>'+
      '<h2 id="month-close-title">Förbered '+escapeHtml(period)+'</h2></div>'+
      '<span class="status-pill'+(locked?' locked':'')+'">'+escapeHtml(label)+'</span></div>'+
      '<p>'+escapeHtml(message)+'</p>'+
      '<p class="month-close-count">'+shown+' verifikationer för perioden visas i den inlästa listan. Det är inte ett bevis på att alla poster är med.</p>'+
      coveragePanel(state,period)+
      journalReview(state,period)+
      '<ol class="month-close-list">'+items+'</ol>'+
      '<p class="month-close-notice">Ingen punkt markeras automatiskt som klar. Öppna varje arbetsyta och gör den riktiga kontrollen före eventuellt periodlås.</p>'+
      '</section>';
  }
  globalThis.LTMonthCloseGuide=Object.freeze({render:render,inspectEntries:inspectEntries,evaluateCoverage:evaluateCoverage,renderCoverage:coveragePanel});
})();
