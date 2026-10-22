'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'apps','portal','invoices.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps','portal','invoice-editor.css'),'utf8');

test('guidat fakturaflöde är giltig JavaScript och visar tre verkliga uppgifter',()=>{
  assert.doesNotThrow(()=>new vm.Script(source));
  for(const text of ['Skapa fakturan steg för steg','Välj kund','Fyll i fakturan','Kontrollera & spara']){
    assert.ok(source.includes(text),'guiden saknar '+text);
  }
  for(const step of ['customer','dates','finish']){
    assert.ok(source.includes('data-invoice-jump="'+step+'"'),'guidelänk saknas: '+step);
  }
  assert.match(source,/function jumpInvoiceGuide\(step\)/);
  assert.match(source,/section\.scrollIntoView\(/);
  assert.match(source,/focus\?\.focus\(\{preventScroll:true\}\)/);
  assert.match(source,/if\(target\.dataset\.invoiceJump\)\{jumpInvoiceGuide\(/);
});

test('guiden ger inte falskt besked om godkänd bokföring',()=>{
  assert.match(source,/data-invoice-guide-state="customer"/);
  assert.match(source,/data-invoice-guide-state="rows"/);
  assert.match(source,/customerState\.textContent=selected\?'Kund vald':'Börja här'/);
  assert.match(source,/rowState\.textContent=hasDescription\?'Fakturarad påbörjad':'Datum och fakturarader'/);
  assert.match(source,/if\(view==='edit'\)updateInvoiceGuide\(\)/);
  assert.match(source,/dirty=true;updateInvoiceGuide\(\)/);
  assert.doesNotMatch(source,/Bokföring godkänd|Fakturan är klar att bokföra/);
});

test('valfria fakturadelar blir hopfällbara utan att några verktyg eller kontroller tas bort',()=>{
  assert.ok(source.includes('Boolean(draft.useFees)'),'valfria avgifter ska öppnas om de används');
  assert.ok(source.includes('Boolean(draft.includeMessage)'),'valfritt meddelande ska öppnas om det används');
  for(const action of ['save-draft','open-draft-pdf','print-draft-pdf']){
    assert.ok(source.includes('data-action="'+action+'"'),'behållen fakturafunktion saknas: '+action);
  }
  assert.match(source,/<details class="invoice-pdf-tools">/);
  assert.match(source,/type="submit" \$\{!isDemo&&!issueReady\?'disabled':''\}>Skapa och bokför faktura/);
  for(const field of ['customerNumber','invoiceDate','dueDate','paymentTermsDays','vatRate','revenueAccount']){
    assert.ok(source.includes(field),'fält saknas: '+field);
  }
  assert.match(source,/Inget skickas till kund eller bank/);
});

test('steg, sammanfattningar och PDF-verktyg fungerar i mobil och mörkt läge',()=>{
  for(const marker of [
    '.invoice-guide-steps{display:grid',
    '.invoice-guide-step:focus-visible',
    '.invoice-pdf-tools>summary:focus-visible',
    'html[data-lt-theme="dark"] .invoice-guide',
    'html[data-lt-theme="dark"] .invoice-pdf-tools>summary',
    '@media(max-width:760px)',
    'min-height:44px'
  ]){
    assert.ok(css.includes(marker),'tillgänglighetsstil saknas: '+marker);
  }
  assert.match(source,/type="button" class="invoice-guide-step"/);
  assert.match(source,/data-invoice-finish tabindex="-1"/);
});
