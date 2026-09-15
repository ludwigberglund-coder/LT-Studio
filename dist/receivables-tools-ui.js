function receivablesToolsPage() {
  const payments = state.invoices.flatMap(i => (i.payments || []).filter(p => p.batch && !p.reversed && !p.reclassified).map(p => ({i, p})));
  const fields = kind => `<label class="field">${kind === 'reclassify' ? 'Inbetalningens buntnummer' : 'Kredit: fakturanummer, OCR eller buntnummer'}<input name="${kind === 'reclassify' ? 'sourceBatch' : 'creditInvoice'}" required autocomplete="off" placeholder="${kind === 'reclassify' ? 'Exempel: 1026' : 'Exempel: 310017 eller 1025'}"></label><label class="field">Målfaktura: fakturanummer, OCR eller buntnummer<input name="targetInvoice" required autocomplete="off"></label>${kind === 'offset' ? '<label class="field">Belopp i hela kronor (valfritt)<input name="amount" type="number" step="1" min="1" placeholder="Tomt = största möjliga kvittning"></label>' : ''}<label class="field">Bokföringsdag<input name="date" type="date" required max="${F.localToday()}" value="${F.localToday()}"></label><p class="form-error" role="alert"></p><button type="submit" class="button">Granska ${kind === 'reclassify' ? 'omföring' : 'kvittning'}</button>`;
  const history = (state.journal || []).filter(j => /Omföring|Kvittning/.test(j.source || ''));
  return workspaceChrome(`${heading('Reskontraverktyg', 'Omför inbetalningar och kvitta kreditfakturor eller tillgodobelopp.', '<button class="button ghost" data-action="nav" data-page="receivables">Till kundreskontran</button>')}<div class="work-grid"><section class="panel"><h2>Omföring av inbetalning</h2><p>Flytta hela inbetalningen till en annan faktura från samma kund. En ny bunt visar omföringen. En överbetalning blir ett tillgodo på målfakturan.</p><form data-form="receivables-plan" data-kind="reclassify">${fields('reclassify')}</form></section><section class="panel"><h2>Kvittning</h2><p>Ange kreditfakturan eller fakturan med tillgodo och den faktura som ska regleras. Båda måste tillhöra samma kund.</p><form data-form="receivables-plan" data-kind="offset">${fields('offset')}</form></section></div><section class="panel"><h2>Inbetalningar med buntnummer</h2><p class="hint">Välj en betalning för att fylla i buntnumret. Bokförda bankinbetalningar utan fakturakoppling kan också sökas med buntnummer i formuläret.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Bunt</th><th>Kund / faktura</th><th>Betalningsdag</th><th>Belopp</th><th></th></tr></thead><tbody>${payments.map(({i,p}) => `<tr><td>${escapeHtml(p.batch)}</td><td>${escapeHtml(i.customerNumber)} · ${escapeHtml(i.customer)}<br>${escapeHtml(i.number)}</td><td>${escapeHtml(p.originalPaymentDate || p.date || '—')}</td><td>${money(p.amount)}</td><td><button class="row-action" data-action="use-payment-batch" data-batch="${escapeHtml(p.batch)}">Välj för omföring</button></td></tr>`).join('') || '<tr><td colspan="5">Inga inbetalningar med buntnummer.</td></tr>'}</tbody></table></div></section><section class="panel"><h2>Genomförda omföringar och kvittningar</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>Bunt</th><th>Bokföringsdag</th><th>Verifikation</th><th>Avser</th></tr></thead><tbody>${history.map(j => `<tr><td><button class="row-action" data-action="batch-detail" data-id="${escapeHtml(j.id)}">${escapeHtml(j.batchNumber || '—')}</button></td><td>${escapeHtml(j.date)}</td><td>${escapeHtml(j.number)}</td><td>${escapeHtml(j.description)}</td></tr>`).join('') || '<tr><td colspan="4">Inga genomförda åtgärder ännu.</td></tr>'}</tbody></table></div></section>`);
}
function receivablesConfirmation() {
  const p = activeModal.plan;
  return modalShell('Kontrollera & bokför', `<p><b>${escapeHtml(p.description)}</b></p><div class="review-detail"><div class="detail-row"><span>Bokföringsdag</span><b>${escapeHtml(p.date)}</b></div><div class="detail-row"><span>Belopp</span><b>${money(p.amount)}</b></div><div class="detail-row"><span>Målfakturans rest före / efter</span><b>${money(F.remaining(p.target))} / ${money(F.remaining(p.target) - p.amount)}</b></div></div><h3>Kontering i den nya bunten</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Konto / avser</th><th>Debet</th><th>Kredit</th></tr></thead><tbody>${p.rows.map(r => `<tr><td>${escapeHtml(r.account)}<br>${escapeHtml(r.description)}</td><td>${money(r.debit)}</td><td>${money(r.credit)}</td></tr>`).join('')}</tbody></table></div><p class="hint">Originalbunten finns kvar. Den nya bunten får ett eget fyrsiffrigt nummer och länkas till underlagen.</p><form data-form="receivables-commit"><p class="form-error" role="alert"></p><div class="modal-foot"><button type="button" class="button ghost" data-action="close-modal">Avbryt</button><button type="submit" class="button">Bokför & skapa bunt</button></div></form>`);
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action="use-payment-batch"]');
  if (!button) return;
  const input = document.querySelector('[name="sourceBatch"]');
  input.value = button.dataset.batch;
  input.focus();
  input.scrollIntoView({block: 'center', behavior: 'smooth'});
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (form.dataset.form === 'receivables-plan') {
    event.preventDefault();
    try {
      const payload = Object.fromEntries(new FormData(form));
      const plan = ReceivablesTools.plan(state, form.dataset.kind, payload);
      activeModal = {type: 'receivables-confirm', kind: form.dataset.kind, payload: {...payload, idempotencyKey: crypto.randomUUID()}, plan};
      render();
    } catch (error) { form.querySelector('.form-error').textContent = error.message; }
  }
  if (form.dataset.form === 'receivables-commit') {
    event.preventDefault();
    if (form.dataset.saving === 'true') return;
    form.dataset.saving = 'true';
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const data = await api('/api/receivables/' + activeModal.kind, {method: 'POST', body: activeModal.payload});
      activeModal = {type: 'batchDetail', id: data.reclassification.entry.id};
      syncStore(data);
      toast('Bunt ' + data.reclassification.entry.batchNumber + ' skapad. Reskontra och fakturor är uppdaterade.');
    } catch (error) {
      form.querySelector('.form-error').textContent = error.message;
      button.disabled = false; form.dataset.saving = 'false';
    }
  }
});
