function reportsPage() {
  const d = F.dashboard(state);
  const entries = state.journal || [];
  const accounting = globalThis.RollandsAccountingReports;
  const trial = accounting ? accounting.trialBalance(state) : [];
  const control = accounting ? accounting.periodControl(state) : {ok:true,entries:entries.length,debit:0,credit:0,sequenceGaps:[],unbalanced:[],duplicateNumbers:[],missingDescription:[]};
  const vatRows = entries.flatMap(j => j.rows.map(r => ({...r,date:j.date,number:j.number}))).filter(r => /^26/.test(r.account));
  const output = vatRows.filter(r => !/^2641/.test(r.account)).reduce((n,r) => n + (r.credit||0) - (r.debit||0), 0);
  const input = vatRows.filter(r => /^2641/.test(r.account)).reduce((n,r) => n + (r.debit||0) - (r.credit||0), 0);
  const recentRows = entries.slice(0,12).map(j => `<tr><td>${j.date}</td><td><b>${escapeHtml(j.number)}</b></td><td>${escapeHtml(j.description)}</td><td class="number-cell">${money(j.rows.reduce((n,r)=>n+(r.debit||0),0))}</td></tr>`).join('');
  const trialRows = trial.slice(0,30).map(row => `<tr><td><b>${escapeHtml(row.code)}</b></td><td>${escapeHtml(row.name||'')}</td><td class="number-cell">${money(row.opening)}</td><td class="number-cell">${money(row.debit)}</td><td class="number-cell">${money(row.credit)}</td><td class="number-cell"><b>${money(row.closing)}</b></td></tr>`).join('');
  const controlIssues = [
    ...control.unbalanced.map(number => `Obalanserad ${number}`),
    ...control.duplicateNumbers.map(number => `Dubblett ${number}`),
    ...control.missingDescription.map(number => `Beskrivning saknas ${number}`)
  ];
  const gapText = control.sequenceGaps.length ? `${control.sequenceGaps.length} luckor i nummerserier, t.ex. ${control.sequenceGaps.slice(0,5).join(', ')}` : 'Inga luckor i identifierade nummerserier';

  return workspaceChrome(`${heading('Rapporter','Huvudbokskontroller, saldobalans och ekonomisk överblick baserad på bokförda verifikationer.','<button class="button" data-action="download">Exportera bokföring</button>')}
    <section class="metrics report-metrics">
      <article class="metric"><span>Resultat hittills</span><div class="number">${money(d.revenue-d.expense)}</div><small>Intäkter ${money(d.revenue)} · Kostnader ${money(d.expense)}</small></article>
      <article class="metric"><span>Kundfordringar</span><div class="number">${money(d.ar.open)}</div><small>${d.ar.count} poster</small></article>
      <article class="metric"><span>Leverantörsskulder</span><div class="number">${money(d.ap.open)}</div><small>${d.ap.count} poster</small></article>
      <article class="metric"><span>Bokföringskontroll</span><div class="number">${control.ok?'OK':controlIssues.length}</div><small>${control.ok?'Debet och kredit balanserar':escapeHtml(controlIssues.slice(0,2).join(' · '))}</small></article>
    </section>
    <section class="report-grid">
      <article class="panel"><div class="panel-head"><div><h2>Åldersanalys kundfordringar</h2><p class="hint">Öppna belopp per förfallointervall.</p></div></div><div class="report-bars">${F.aging(d.customers).map(a=>`<div class="report-bar"><span>${a.label}</span><b>${money(a.value)}</b><i style="width:${d.ar.open?Math.min(100,a.value/d.ar.open*100):0}%"></i></div>`).join('')}</div></article>
      <article class="panel"><div class="panel-head"><div><h2>Momsöversikt</h2><p class="hint">Baserad på bokförda momskonton. Detta är ett kontrollunderlag, inte en färdig momsdeklaration.</p></div></div><div class="report-kpis"><div><span>Utgående moms</span><b>${money(output)}</b></div><div><span>Ingående moms</span><b>${money(input)}</b></div><div><span>Netto moms</span><b>${money(output-input)}</b></div></div></article>
    </section>
    <section class="panel"><div class="panel-head"><div><h2>Saldobalans</h2><p class="hint">Ingående saldo, periodens debet/kredit och utgående nettosaldo per konto. Visar de första 30 använda kontona.</p></div><div class="hint">${escapeHtml(gapText)}</div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Konto</th><th>Namn</th><th class="align-right">Ingående</th><th class="align-right">Debet</th><th class="align-right">Kredit</th><th class="align-right">Saldo</th></tr></thead><tbody>${trialRows||'<tr><td colspan="6" class="empty">Ingen bokföring ännu.</td></tr>'}</tbody></table></div></section>
    <section class="panel"><div class="panel-head"><div><h2>Senaste verifikationer</h2><p class="hint">${control.entries} verifikationer kontrollerade · Debet ${money(control.debit)} · Kredit ${money(control.credit)}.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Datum</th><th>Ver.</th><th>Beskrivning</th><th class="align-right">Debet totalt</th></tr></thead><tbody>${recentRows||'<tr><td colspan="4" class="empty">Inga verifikationer ännu.</td></tr>'}</tbody></table></div></section>
    <section class="integration"><b>Kontrollnivå</b><br>Saldobalansen och periodkontrollen bygger på registrerade verifikationer. Nummerserieluckor visas som varning men kan ha en legitim förklaring. Full boksluts- och myndighetsrapportering kräver fortfarande öppningsbalanser, årsavslut och verifierade regelkopplingar.</section>`);
}
