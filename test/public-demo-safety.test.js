'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const readJson=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('publik företagsprofil är uttryckligen syntetisk',()=>{
  const company=readJson('content/company.json');
  assert.equal(company.dataClassification,'synthetic-demo');
  assert.equal(company.legalName,'Demo Handel AB');
  assert.equal(company.displayName,'Demo Saluhall');
  assert.equal(company.orgNumber,'559999-0000');
  assert.equal(company.vatNumber,'SE559999000001');
  assert.ok(String(company.contact.email).toLowerCase().endsWith('.invalid'));
  assert.ok(new URL(company.website).hostname.toLowerCase().endsWith('.invalid'));
  assert.match(company.invoice.bankgiro,/^DEMO-/);
});

test('publika verksamhetsbeslut innehåller bara demoklassificering och inga externa kundbevis',()=>{
  const decisions=readJson('config/rolands-business-decisions.json');
  assert.equal(decisions.dataClassification,'synthetic-demo');
  assert.equal(decisions.company.legalName,'Demo Handel AB');
  assert.equal(decisions.company.orgNumber,'559999-0000');
  assert.deepEqual(decisions.accounting.fiscalYear.evidence,[]);
  assert.equal(decisions.accounting.vatPeriod.publicRegistrationVerified,false);
  assert.equal(decisions.accounting.vatPeriod.publicRegistrationEvidence,null);
});

test('legacy-demo och fakturafixture använder endast tydligt märkta demouppgifter',()=>{
  const demo=read('public/demo-state.js');
  const fixture=read('test/fixtures/invoice-example.js');
  assert.match(demo,/Demo Handel AB/);
  assert.match(demo,/demo\.example\.invalid/);
  assert.match(demo,/Demo bankkonto/);
  assert.match(fixture,/Demo Handel AB/);
  assert.match(fixture,/demo\.example\.invalid|example\.invalid/);
});

test('publika kundbeslutsdokument beskriver data som demo eller privat verifiering',()=>{
  const decisions=read('docs/VERKSAMHETSBESLUT.md');
  const evidence=read('docs/ROLANDS-ACCOUNTING-DECISIONS-EVIDENCE.md');
  assert.match(decisions,/syntetisk demokonfiguration/i);
  assert.match(evidence,/inte längre verifieringsbevis|publika repositoryt/i);
});
