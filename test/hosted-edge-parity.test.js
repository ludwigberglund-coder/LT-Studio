'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {expectedFunctions,normalizeSnapshot,compareHostedFunctions}=require('../scripts/verify-hosted-edge-parity.js');
const config=fs.readFileSync(path.join(__dirname,'..','supabase','config.toml'),'utf8');
const expected=expectedFunctions(config);
const valid=()=>[...expected].map(([slug,verify_jwt])=>({slug,verify_jwt,status:'ACTIVE'}));

test('GitHub config requires explicit JWT policy',()=>{
  assert.ok(expected.has('company-activate'));
  assert.ok(expected.has('operator-admin'));
  assert.throws(()=>expectedFunctions('[functions.example]\n'),/verify_jwt/);
  assert.throws(()=>expectedFunctions('[functions.example]\nverify_jwt = true\n[functions.example]\nverify_jwt = false'),/Dubblerad/);
  assert.throws(()=>expectedFunctions('[functions.example]\nverify_jwt = true\nverify_jwt = false'),/dubblerad/);
});

test('raw Supabase API arrays and connector wrappers work',()=>{
  const rows=valid();
  assert.equal(compareHostedFunctions(rows,config).ok,true);
  assert.equal(compareHostedFunctions({functions:rows},config).ok,true);
  assert.equal(compareHostedFunctions({result:{functions:rows}},config).ok,true);
  assert.equal(compareHostedFunctions({text:JSON.stringify({functions:rows})},config).ok,true);
  assert.equal(normalizeSnapshot(rows).length,rows.length);
});

test('missing staging function blocks parity',()=>{
  const report=compareHostedFunctions(valid().filter(row=>row.slug!=='company-activate'),config);
  assert.equal(report.ok,false);
  assert.ok(report.issues.some(item=>item.code==='MISSING'&&item.slug==='company-activate'));
});

test('JWT mismatch and inactive functions block parity',()=>{
  const rows=valid();
  const operator=rows.find(row=>row.slug==='operator-admin');
  operator.verify_jwt=!operator.verify_jwt;
  operator.status='INACTIVE';
  const report=compareHostedFunctions(rows,config);
  assert.equal(report.ok,false);
  assert.ok(report.issues.some(item=>item.code==='JWT_POLICY_MISMATCH'&&item.slug==='operator-admin'));
  assert.ok(report.issues.some(item=>item.code==='NOT_ACTIVE'));
});

test('unexpected and duplicate functions are not silently accepted',()=>{
  const rows=valid();
  rows.push({...rows[0]},{slug:'surprise-function',verify_jwt:true,status:'ACTIVE'});
  const report=compareHostedFunctions(rows,config);
  assert.ok(report.issues.some(item=>item.code==='DUPLICATE'));
  assert.ok(report.issues.some(item=>item.code==='UNEXPECTED'));
});

test('malformed data fails closed without echoing input',()=>{
  assert.throws(()=>compareHostedFunctions({secrets:'sensitive'},config),/Snapshot saknar/);
  assert.throws(()=>compareHostedFunctions([{slug:'../unsafe'}],config),/Ogiltig funktionsmetadata/);
  const rows=valid();
  rows[0].verify_jwt='true';
  assert.equal(compareHostedFunctions(rows,config).ok,false);
});
