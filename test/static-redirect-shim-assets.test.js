'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {isImmediateRedirectHtml}=require('../scripts/build-static.js');

const root=path.resolve(__dirname,'..');

test('admin redirect shim is detected before workspace assets are injected',()=>{
  const admin=fs.readFileSync(path.join(root,'apps','admin','index.html'),'utf8');
  const operator=fs.readFileSync(path.join(root,'apps','operator','index.html'),'utf8');

  assert.equal(isImmediateRedirectHtml(admin),true);
  assert.equal(isImmediateRedirectHtml(operator),false);
});

test('static build skips redirect shims in all three workspace decorators',()=>{
  const source=fs.readFileSync(path.join(root,'scripts','build-static.js'),'utf8');
  const skips=source.match(/if\(isImmediateRedirectHtml\(html\)\)continue;/g)||[];
  assert.equal(skips.length,3);
});
