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
      '<ol class="month-close-list">'+items+'</ol>'+
      '<p class="month-close-notice">Ingen punkt markeras automatiskt som klar. Öppna varje arbetsyta och gör den riktiga kontrollen före eventuellt periodlås.</p>'+
      '</section>';
  }
  globalThis.LTMonthCloseGuide=Object.freeze({render:render});
})();
