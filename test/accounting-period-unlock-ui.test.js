'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','accounting.js'),'utf8');

test('periodupplåsning visar både separat beslut och säker självupplåsning',()=>{
  assert.match(source,/Godkänn upplåsning/);
  assert.match(source,/Avslå/);
  assert.match(source,/Ensam behörig användare/);
  assert.match(source,/Verifiera och lås upp/);
  assert.match(source,/autocomplete="current-password"/);
  assert.match(source,/autocomplete="one-time-code"/);
  assert.match(source,/unlockPolicy\.selfUnlockAllowed/);
  assert.match(source,/En annan behörig användare hos företaget måste fatta beslutet/);
});
