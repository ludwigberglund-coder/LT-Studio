'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {browserFindings}=require('../scripts/scan-client-secrets.js');

test('browser secret scan rejects server-side credential names',()=>{
  const source='const key = process.env.'+('CLOUDFLARE_'+'API_TOKEN')+';';
  assert.ok(browserFindings(source).some(row=>row.rule==='client-secret-reference'));
});

test('browser secret scan reuses high-confidence token detection',()=>{
  const source='const token = "'+('gh'+'p_'+'abcdefghijklmnopqrstuvwxyz1234567890')+'";';
  assert.ok(browserFindings(source).some(row=>row.rule==='github-token'));
});

test('browser secret scan ignores normal public configuration names',()=>{
  const source='const publicConfig = {apiBase:"/api/v1", environment:"staging"};';
  assert.deepEqual(browserFindings(source),[]);
});
