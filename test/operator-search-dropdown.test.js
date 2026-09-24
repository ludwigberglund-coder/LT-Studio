'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('operator company search uses a live accessible dropdown',()=>{
  const source=read('apps/operator/app.js');
  const css=read('apps/operator/styles.css');

  assert.match(source,/type="search"/);
  assert.match(source,/role="combobox"/);
  assert.match(source,/aria-autocomplete="list"/);
  assert.match(source,/aria-controls="operator-company-search-results"/);
  assert.match(source,/role="listbox"/);
  assert.match(source,/data-company-search-id/);
  assert.match(source,/function companySearchSuggestions/);
  assert.match(source,/function companySearchResults/);
  assert.match(source,/function updateCompanySearchDropdown/);
  assert.match(source,/ArrowDown/);
  assert.match(source,/ArrowUp/);
  assert.match(source,/Escape/);
  assert.match(source,/event\.key==='Enter'/);
  assert.match(source,/await openCompany\(company\.id\)/);
  assert.match(css,/\.company-search-results/);
  assert.match(css,/\.company-search-option/);
  assert.match(css,/@keyframes operatorSearchDrop/);
});
