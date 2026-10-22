'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'apps','portal','invoices.js'),'utf8');
const css=fs.readFileSync(path.join(root,'apps','portal','invoice-editor.css'),'utf8');

test('fakturaöversikten är giltig JavaScript med samtliga ekonomikolumner och åtgärder kvar',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/function invoiceRows\(\)/);
  assert.match(js,/function listHtml\(\)/);
  for(const field of ['Faktura / OCR','Kund','Typ','Fakturadatum','Förfallodatum','Belopp','Åtgärd']){
    assert.ok(js.includes('scope="col">'+field+'</th>'),'registerkolumn saknas: '+field);
  }
  for(const value of ['invoiceNumber','ocr','customerName','customerNumber','invoiceDate','dueDate','totalOre']){
    assert.ok(js.includes('r.'+value),'fakturauppgift försvann: '+value);
  }
  assert.match(js,/data-preview="\$\{esc\(r\.id\)\}"/);
  assert.match(js,/Visa \/ skriv ut/);
  assert.match(js,/invoice-register-type--credit/);
  assert.match(js,/credit\?'Kreditfaktura':'Faktura'/);
});

test('fakturaregistret visar bara verifierbara antal från samma fakturalista',()=>{
  assert.match(js,/function invoiceListCountText\(\)/);
  assert.match(js,/const visible=filteredInvoices\(\)\.length,total=invoiceRecords\(\)\.length/);
  assert.match(js,/return `\$\{visible\} av \$\{total\} fakturor visas`/);
  assert.match(js,/data-invoice-list-count role="status" aria-live="polite"/);
  assert.match(js,/const count=app\.querySelector\('\[data-invoice-list-count\]'\)/);
  assert.match(js,/if\(count\)count\.textContent=invoiceListCountText\(\)/);
  assert.match(js,/invoiceRecords\(\)\.filter\(record=>invoiceMatches\(record,search\)\)/);
  assert.doesNotMatch(js,/Betald faktura|Alla inbetalningar matchade|Bokföringen är klar/);
});

test('registret är fortfarande sökbart och tomt läge är begripligt',()=>{
  assert.match(js,/id="invoice-register-search" class="invoice-search"/);
  assert.match(js,/role="combobox"/);
  assert.match(js,/aria-controls="invoice-search-results"/);
  assert.match(js,/data-label="Faktura \/ OCR"/);
  assert.match(js,/Inga fakturor matchar sökningen/);
  assert.match(js,/Inga kundfakturor har skapats ännu/);
  assert.match(js,/data-action="new">\+ Ny kundfaktura/);
  assert.match(js,/Inbetalningar hanteras i fliken Obetalda fakturor/);
});

test('polerad design är begränsad till fakturafliken och tillgänglig på mobil och i mörkt läge',()=>{
  for(const selector of [
    '.invoice-workspace .invoice-toolbar--register',
    '.invoice-register-workspace',
    '.invoice-register-controls',
    '.invoice-register-count',
    '.invoice-register-reference',
    '.invoice-register-type--credit',
    '.invoice-workspace .invoice-list-panel .invoice-register-open',
    '@media(max-width:640px)',
    'html[data-lt-theme="dark"] .invoice-register-workspace',
    'html[data-lt-theme="dark"] .invoice-workspace .invoice-list-panel .invoice-register-type--credit',
    'prefers-reduced-motion:reduce',
    'focus-visible'
  ])assert.ok(css.includes(selector),'visuell skyddsstil saknas: '+selector);
  assert.match(css,/min-height:42px/);
  assert.match(css,/font-variant-numeric:tabular-nums/);
});
