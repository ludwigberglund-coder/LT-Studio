'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const API_DIR=path.join(__dirname,'..','apps','api');
const STORE_FILES=new Set([
  'document-content-store.js',
  'supplier-invoice-document-store.js',
  'customer-invoice-pdf-archive-store.js'
]);
const SCHEMA_FILES=new Map([
  ['documents.js','content_blob'],
  ['payables.js','document_blob'],
  ['customer-invoicing.js','pdf_blob']
]);

test('binärt dokumentinnehåll går endast genom godkända lagringsgränser i runtime-koden',()=>{
  const files=fs.readdirSync(API_DIR).filter(name=>name.endsWith('.js'));
  const blobPattern=/\b(content_blob|document_blob|pdf_blob)\b/;

  for(const name of files){
    const source=fs.readFileSync(path.join(API_DIR,name),'utf8');
    const lines=source.split('\n');
    const hits=lines
      .map((line,index)=>({line,index:index+1}))
      .filter(entry=>blobPattern.test(entry.line));

    if(!hits.length)continue;
    if(STORE_FILES.has(name))continue;

    const allowedColumn=SCHEMA_FILES.get(name);
    assert.ok(
      allowedColumn,
      `${name} får inte läsa eller skriva privata BLOB-fält direkt; använd lagringsgränsen.`
    );

    for(const hit of hits){
      assert.match(
        hit.line,
        new RegExp(`\\b${allowedColumn}\\s+BLOB\\b`,'i'),
        `${name}:${hit.index} får bara deklarera ${allowedColumn} som BLOB-kolumn i schema.`
      );
      assert.doesNotMatch(
        hit.line,
        /\\b(?:SELECT|UPDATE|INSERT|DELETE)\\b/i,
        `${name}:${hit.index} får inte läsa eller skriva ${allowedColumn} direkt i runtime-SQL; använd lagringsadaptern.`
      );
    }
  }
});

test('alla tre privata filflöden har en explicit SQLite-lagringsadapter',()=>{
  for(const name of STORE_FILES){
    const source=fs.readFileSync(path.join(API_DIR,name),'utf8');
    assert.match(source,/function\s+put\s*\(/,name+' saknar put()');
    assert.match(source,/function\s+get\s*\(/,name+' saknar get()');
    assert.match(source,/function\s+exists\s*\(/,name+' saknar exists()');
    assert.match(source,/companyId/,name+' måste ta emot companyId för företagsisolering');
  }
});


test('kundfakturans PDF-runtime använder det gemensamma provider-kontraktet',()=>{
  const source=fs.readFileSync(path.join(API_DIR,'customer-invoicing.js'),'utf8');
  assert.match(source,/require\('\.\/private-object-store-contract\.js'\)/);
  assert.match(source,/require\('\.\/sqlite-customer-invoice-private-object-provider\.js'\)/);
  assert.doesNotMatch(source,/require\('\.\/customer-invoice-pdf-archive-store\.js'\)/);
  assert.match(source,/createContractedPrivateObjectStore/);
});
