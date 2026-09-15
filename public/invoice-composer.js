let invoiceDraft=null;
function invoiceSettingsForm() {
  return `<form data-form="invoice-settings"><p class="hint">Sparas för nästa faktura. Ange företagets riktiga kontakt och betalningskonto.</p><div class="form-grid">${[['invoiceContact','Vår kontakt'],['registeredOffice','Säte'],['paymentAccount','Bankkonto / bankgiro för betalning'],['vatNumber','Momsregistreringsnummer']].map(([key,label])=>`<label class="field">${label}<input name="${key}" value="${escapeHtml(state.business[key] || '')}" maxlength="120" required></label>`).join('')}</div><p class="form-error" role="alert"></p><button class="button ghost" type="submit">Spara fakturainställningar</button></form>`;
}
function invoiceComposer() {
  if(!invoiceDraft) invoiceDraft={customer:'',customerNumber:'',address:'',reference:'',ourContact:state.business.invoiceContact || '',paymentTerms:30,date:F.localToday(),postingDate:F.localToday(),dueDate:InvoiceModel.dueDate(F.localToday(),30),invoiceType:'invoice',idempotencyKey:crypto.randomUUID(),lines:[{description:'',amount:'',account:'3010',vatRate:25}]};
  const d=invoiceDraft;
  const input=(name,label,type='text',extra='')=>`<label class="field">${label}<input name="${name}" type="${type}" value="${escapeHtml(d[name] ?? '')}" ${extra}></label>`;
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal invoice-composer" role="dialog" aria-modal="true" aria-labelledby="invoice-composer-title" data-stop><div class="modal-header"><div><h2 id="invoice-composer-title">Ny kundfaktura</h2><p class="hint">Fakturanummer och OCR tilldelas när du skapar fakturan. Alla belopp anges i hela kronor.</p></div><button data-action="close-modal" aria-label="Stäng">×</button></div><div class="modal-body"><details ${!state.business.paymentAccount || !state.business.invoiceContact || !state.business.registeredOffice?'open':''}><summary>Fakturainställningar · kontakt och betalningsuppgifter</summary>${invoiceSettingsForm()}</details><form data-form="invoice" id="invoice-compose-form"><input type="hidden" name="idempotencyKey" value="${d.idempotencyKey}"><div class="form-grid invoice-fields"><label class="field">Fakturatyp<select name="invoiceType"><option value="invoice" ${d.invoiceType==='invoice'?'selected':''}>Faktura</option><option value="credit" ${d.invoiceType==='credit'?'selected':''}>Kreditfaktura</option></select></label>${input('customerNumber','Kundnummer (automatiskt om tomt)','text','maxlength="40"')}${input('customer','Kund / bolag','text','required maxlength="160" list="invoice-customers"')}<datalist id="invoice-customers">${[...new Set(state.invoices.map(i=>i.customer))].map(c=>`<option value="${escapeHtml(c)}">`).join('')}</datalist><label class="field">Adress<textarea name="address" rows="3" maxlength="500" required placeholder="Gatuadress&#10;Postnummer och ort">${escapeHtml(d.address)}</textarea></label>${input('reference','Er referens','text','maxlength="200"')}${input('ourContact','Vår kontakt','text','required maxlength="120"')}${input('date','Faktura-/avishedatum','date','required')}${input('postingDate','Bokföringsdag','date','required')}${input('paymentTerms','Betalningsvillkor (dagar)','number','min="0" max="365" step="1" required')}${input('dueDate','Förfallodatum','date','required')}<label class="field">Fakturanummer<input value="Genereras vid skapande" readonly></label></div><h3>Fakturarader</h3><p class="hint">Ange belopp exklusive moms. Välj fakturatyp Kreditfaktura för kreditbelopp.</p><div class="table-wrap"><table class="data-table invoice-lines"><thead><tr><th>Fakturatext</th><th>Belopp exkl. moms</th><th>Moms</th><th>Konto</th><th></th></tr></thead><tbody>${d.lines.map((r,i)=>`<tr data-invoice-line><td><textarea data-field="description" aria-label="Fakturatext rad ${i+1}" maxlength="1000" required rows="2">${escapeHtml(r.description)}</textarea></td><td><input data-field="amount" aria-label="Belopp rad ${i+1}" type="number" step="1" min="1" max="100000000" value="${escapeHtml(r.amount)}" required></td><td><select data-field="vatRate" aria-label="Moms rad ${i+1}">${[25,12,6,0].map(v=>`<option value="${v}" ${Number(r.vatRate)===v?'selected':''}>${v} %</option>`).join('')}</select></td><td><input data-field="account" aria-label="Konto rad ${i+1}" list="invoice-accounts" pattern="3[0-9]{3}" maxlength="4" value="${escapeHtml(r.account)}" required></td><td><button type="button" class="row-action" data-action="remove-invoice-line" data-index="${i}" aria-label="Ta bort rad ${i+1}" ${d.lines.length===1?'disabled':''}>×</button></td></tr>`).join('')}</tbody></table></div><datalist id="invoice-accounts">${Object.entries(InvoiceModel.accounts).map(([n,l])=>`<option value="${n}">${l}</option>`).join('')}</datalist><button type="button" class="button ghost" data-action="add-invoice-line">+ Lägg till fakturarad</button><section class="posting-preview" aria-live="polite"><h3>Kontering vid utställande</h3><div id="invoice-posting">${invoicePosting(d)}</div></section><p class="hint">${escapeHtml(InvoiceModel.interestText)}</p><p class="form-error" role="alert"></p><div class="modal-foot"><button type="button" class="button ghost" data-action="close-modal">Avbryt</button><button type="submit" class="button">Skapa faktura, PDF & bokför</button></div></form></div></section></div>`;
}
function captureInvoiceDraft() {
  const form=document.getElementById('invoice-compose-form');
  if(!form) return invoiceDraft;
  invoiceDraft={...Object.fromEntries(new FormData(form)),lines:[...form.querySelectorAll('[data-invoice-line]')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(el=>[el.dataset.field,el.value])))};
  return invoiceDraft;
}
function invoicePosting(d) {
  try {
    const calc=InvoiceModel.calculate(d.lines,d.invoiceType==='credit');
    return `<div class="detail-totals"><div><span>Exklusive moms</span><b>${money(calc.net)}</b></div><div><span>Moms</span><b>${money(calc.vat)}</b></div><div><span>${d.invoiceType==='credit'?'Tillgodo':'Att betala'}</span><b>${money(calc.total)}</b></div></div><table class="data-table"><thead><tr><th>Konto</th><th>Debet</th><th>Kredit</th></tr></thead><tbody>${calc.rows.map(r=>`<tr><td>${escapeHtml(r.account)}</td><td>${money(r.debit)}</td><td>${money(r.credit)}</td></tr>`).join('')}</tbody></table><p class="hint">Debet och kredit balanserar. Intern kontering visas här; kundens PDF visar fakturatext, moms och belopp.</p>`;
  } catch(error) { return `<p class="hint">${escapeHtml(error.message)}</p>`; }
}
document.addEventListener('click',event=>{
  const b=event.target.closest('[data-action]'); if(!b)return;
  if(b.dataset.action==='new-invoice') invoiceDraft=null;
  if(['add-invoice-line','remove-invoice-line'].includes(b.dataset.action)){
    captureInvoiceDraft();
    if(b.dataset.action==='add-invoice-line' && invoiceDraft.lines.length<100) invoiceDraft.lines.push({description:'',amount:'',account:'3010',vatRate:25});
    if(b.dataset.action==='remove-invoice-line' && invoiceDraft.lines.length>1) invoiceDraft.lines.splice(Number(b.dataset.index),1);
    render();
  }
});
document.addEventListener('input',event=>{
  if(!event.target.closest('#invoice-compose-form')) return;
  const form=document.getElementById('invoice-compose-form');
  if(['date','paymentTerms'].includes(event.target.name)) form.elements.dueDate.value=InvoiceModel.dueDate(form.elements.date.value,form.elements.paymentTerms.value);
  document.getElementById('invoice-posting').innerHTML=invoicePosting(captureInvoiceDraft());
});
document.addEventListener('change',event=>{
  if(event.target.name!=='customer' || !event.target.closest('#invoice-compose-form'))return;
  const match=state.invoices.find(i=>i.customer===event.target.value);if(!match)return;
  const form=document.getElementById('invoice-compose-form');
  form.elements.customerNumber.value=match.customerNumber || '';
  if(match.address)form.elements.address.value=match.address;
  captureInvoiceDraft();
});
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(form.dataset.form!=='invoice-settings')return;
  event.preventDefault();captureInvoiceDraft();const button=form.querySelector('button');button.disabled=true;
  try{
    const data=await api('/api/invoice-settings',{method:'POST',body:Object.fromEntries(new FormData(form))});
    if(invoiceDraft)invoiceDraft.ourContact=data.store.business.invoiceContact;
    syncStore(data);toast('Fakturainställningarna är sparade.');
  }catch(error){form.querySelector('.form-error').textContent=error.message;button.disabled=false;}
});
