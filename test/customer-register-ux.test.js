'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..','apps','portal');
const source=fs.readFileSync(path.join(root,'customers.js'),'utf8');
const styles=fs.readFileSync(path.join(root,'customer-register.css'),'utf8');
const html=fs.readFileSync(path.join(root,'customers.html'),'utf8');

test('kundregistret är giltig JavaScript och laddar sin nya design',()=>{
  assert.doesNotThrow(()=>new vm.Script(source));
  assert.match(html,/<link rel="stylesheet" href="\.\/customer-register\.css">/);
  assert.doesNotMatch(html,/<\/script>\\n\s*<script/);
  assert.match(source,/function filteredCustomers\(\)/);
  assert.match(source,/function normalizeCustomerSearch\(value\)/);
  assert.match(source,/function customerRows\(/);
  assert.match(source,/function customerList\(\)/);
  assert.match(source,/function render\(\)/);
});

test('kundsökningen kan filtrera namn, nummer, organisationsnummer och kontaktuppgifter',()=>{
  assert.match(source,/normalize\('NFD'\)/);
  assert.match(source,/toLocaleLowerCase\('sv-SE'\)/);
  assert.match(source,/customerNumber,c\.name,c\.orgNumber,c\.email,addressText\(c\)/);
  assert.match(source,/id="customer-register-search" type="search"/);
  assert.match(source,/data-customer-rows/);
  assert.match(source,/customerSearch=event\.target\.value/);
  assert.match(source,/if\(tbody\)tbody\.innerHTML=customerRows\(\)/);
  assert.match(source,/if\(count\)count\.textContent=customerListCountText\(\)/);
  assert.match(source,/data-customer-result-count role="status"/);
  assert.match(source,/Inga kunder matchar sökningen/);
});

test('kundregistret behåller alla tidigare uppgifter och befintliga åtgärder',()=>{
  for(const item of [
    'Kundnummer','Kund','Kontakt / adress','Historik','Åtgärd',
    'data-edit-customer','data-delete-customer','data-restore-customer',
    'data-toggle-archived','data-new','data-cancel','data-customer-delete-confirm',
    'name="paymentTermsDays"','name="reminderFeeAgreed"',
    'ourReference','yourReference','customer-form','returnToInvoice()','resumeInvoice()'
  ])assert.ok(source.includes(item),'Befintlig funktion saknas: '+item);
  assert.match(source,/function customerDeleteModal\(\)/);
  assert.match(source,/async function loadPrivateCustomers\(\)/);
  assert.match(source,/if\(isSupabase\)\{/);
});

test('kundhistorik får inte påstå noll fakturor när datakällan saknar verifierat antal',()=>{
  assert.match(source,/if\(isSupabase\)return null/);
  assert.match(source,/const count=customerHistoryCount\(c\)/);
  assert.match(source,/count===null\s*\?/);
  assert.match(source,/Ej sammanställt/);
  assert.match(source,/const mustArchive=isSupabase\|\|/);
  assert.match(source,/Befintliga fakturor och historik bevaras/);
  assert.doesNotMatch(source,/invoiceCount:0\}\)\;?\s*return/);
});

test('kundformuläret har samma fält men valfria fakturainställningar kan fällas ut',()=>{
  for(const field of ['name','orgNumber','email','address','paymentTermsDays','ourReference','yourReference','reminderFeeAgreed']){
    assert.ok(source.includes(field),'Formulärfält saknas: '+field);
  }
  assert.match(source,/<details class="customer-form-advanced full"/);
  assert.match(source,/Boolean\(c\.ourReference\|\|c\.yourReference\|\|c\.reminderFeeAgreed\)/);
  assert.match(source,/Fler fakturainställningar/);
  assert.match(source,/type="submit">Spara kund/);
  assert.match(source,/type="button" data-cancel>Avbryt/);
});

test('kundregistret är responsivt och läsbart även i mörkt läge',()=>{
  for(const value of [
    '.customer-workspace .customer-register-head',
    '.customer-register-workspace',
    '.customer-register-row-actions',
    '.customer-register-tools input[type="search"]',
    '.customer-form-advanced-grid',
    '@media(max-width:760px)',
    '@media(max-width:640px)',
    'data-label',
    'html[data-lt-theme="dark"] .customer-register-workspace',
    'html[data-lt-theme="dark"] .customer-register-status',
    'prefers-reduced-motion:reduce',
    'focus-visible'
  ])assert.ok(styles.includes(value),'CSS-stöd saknas: '+value);
  assert.match(styles,/min-height:44px/);
  assert.match(styles,/font-variant-numeric:tabular-nums/);
});
