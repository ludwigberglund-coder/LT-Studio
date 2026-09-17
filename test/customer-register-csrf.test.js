'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('kundregistret återanvänder CSRF-token från den säkra inloggningen',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','apps','portal','customers.js'),'utf8');
  assert.match(source,/sessionStorage\.getItem\('rollands-csrf'\)/);
  assert.doesNotMatch(source,/session\.csrfToken/);
  assert.match(source,/if\(!csrfToken\)\{location\.href='\.\/index\.html';return;\}/);
  assert.match(source,/'X-CSRF-Token':csrfToken/);
});
