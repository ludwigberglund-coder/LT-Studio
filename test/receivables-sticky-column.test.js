'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','styles.css'),'utf8');

test('kundreskontrans fasta kundkolumn täcker scrollat innehåll utan överlapp',()=>{
  assert.match(source,/\.customer-cell\{position:sticky;left:0;z-index:3;min-width:190px;width:190px;max-width:190px;white-space:normal;background:#fff;/);
  assert.match(source,/\.res-table th\.customer-cell\{z-index:5;background:#f5f7f4\}/);
  assert.match(source,/\.res-table tr\.transaction-row>\.customer-cell\{background:#fbfcfb\}/);
  assert.doesNotMatch(source,/\.customer-cell\{[^}]*background:inherit/);
});
