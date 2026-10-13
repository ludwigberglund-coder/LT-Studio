'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const modulePath='../packages/automation/ai-autopost-readiness.mjs';
async function evaluate(input){
  const {evaluateAutoPostReadiness}=await import(modulePath);
  return evaluateAutoPostReadiness(input);
}
function example(){
  return {
    candidate:{
      companyId:'tenant-a-001',kind:'supplier-invoice',
      sourceId:'document-123456',sourceSha256:'a'.repeat(64),
      supplierId:'supplier-123456',invoiceDate:'2026-09-12',
      postingDate:'2026-09-13',currency:'SEK',netOre:100000,
      vatOre:25000,grossOre:125000,vatTreatment:'domestic-25',
      creditNote:false,
      lines:[
        {account:'6110',debitOre:100000,creditOre:0},
        {account:'2641',debitOre:25000,creditOre:0},
        {account:'2440',debitOre:0,creditOre:125000}
      ]
    },
    session:{
      companyId:'tenant-a-001',role:'accountant',
      tenantVerified:true,aal2Verified:true,sessionValid:true
    },
    companyPolicy:{companyOptedIn:true,maxGrossOre:200000},
    checks:{
      originalPdfVerified:true,supplierStable:true,
      templateApprovals:3,sameSupplierTemplate:true,
      periodOpen:true,accountsActive:true,vatRulesVerified:true,
      duplicateChecked:true,duplicateFound:false,
      idempotencyReserved:true,previouslyPosted:false,auditReady:true
    },
    template:{expenseAccount:'6110',vatAccount:'2641',payableAccount:'2440'}
  };
}
test('known synthetic repeat invoice can only become a future candidate, never live posting',async()=>{
  const result=await evaluate(example());
  assert.equal(result.simulationEligible,true);
  assert.equal(result.canPost,false);
  assert.equal(result.action,'manual-review');
  assert.deepEqual(result.reasons,['LIVE_POSTING_NOT_RELEASED']);
  assert.ok(Object.isFrozen(result));
});
test('missing information and unknown fields fail closed without network or writes',async()=>{
  for(const value of [undefined,{}, {candidate:{}},{...example(), surprise:true}]){
    const decision=await evaluate(value);
    assert.equal(decision.canPost,false);
    assert.equal(decision.simulationEligible,false);
    assert.ok(decision.reasons.includes('INVALID_INPUT'));
  }
});
test('cross-company input, invalid MFA and unprivileged roles are not eligible',async()=>{
  for(const change of [
    v=>{v.session.companyId='tenant-b-002'},
    v=>{v.session.tenantVerified=false},
    v=>{v.session.sessionValid=false},
    v=>{v.session.aal2Verified=false},
    v=>{v.session.role='readonly'},
    v=>{v.session.role='approver'}
  ]){
    const sample=example();change(sample);
    const result=await evaluate(sample);
    assert.equal(result.simulationEligible,false);
    assert.ok(result.reasons.includes('AUTH_OR_TENANT_UNVERIFIED'));
  }
});
test('automatic bookkeeping must be explicitly opted in per company and amount-limited',async()=>{
  for(const change of [
    v=>{v.companyPolicy.companyOptedIn=false},
    v=>{v.companyPolicy.maxGrossOre=0},
    v=>{v.companyPolicy.maxGrossOre=50000}
  ]){
    const sample=example();change(sample);
    const result=await evaluate(sample);
    assert.equal(result.simulationEligible,false);
    assert.equal(result.canPost,false);
  }
});
test('original PDF, source hash, supplier continuity and audited template are mandatory',async()=>{
  for(const [change,expected] of [
    [v=>{v.checks.originalPdfVerified=false},'SOURCE_NOT_VERIFIED'],
    [v=>{v.candidate.sourceSha256='invalid'},'SOURCE_NOT_VERIFIED'],
    [v=>{v.candidate.sourceId='?'},'SOURCE_NOT_VERIFIED'],
    [v=>{v.checks.supplierStable=false},'UNPROVEN_SUPPLIER_TEMPLATE'],
    [v=>{v.checks.sameSupplierTemplate=false},'UNPROVEN_SUPPLIER_TEMPLATE'],
    [v=>{v.checks.templateApprovals=2},'UNPROVEN_SUPPLIER_TEMPLATE']
  ]){
    const sample=example();change(sample);
    const result=await evaluate(sample);
    assert.equal(result.simulationEligible,false);
    assert.ok(result.reasons.includes(expected));
  }
});
test('duplicate document, unresolved retry and previous posting always stop automation',async()=>{
  for(const change of [
    v=>{v.checks.duplicateChecked=false},
    v=>{v.checks.duplicateFound=true},
    v=>{v.checks.idempotencyReserved=false},
    v=>{v.checks.previouslyPosted=true}
  ]){
    const sample=example();change(sample);
    const decision=await evaluate(sample);
    assert.equal(decision.simulationEligible,false);
    assert.ok(decision.reasons.includes('DUPLICATE_OR_IDEMPOTENCY_RISK'));
  }
});
test('locked period, invalid date and source date after posting date require review',async()=>{
  for(const change of [
    v=>{v.checks.periodOpen=false},
    v=>{v.candidate.invoiceDate='2026-02-30'},
    v=>{v.candidate.postingDate='2026-09-01'}
  ]){
    const sample=example();change(sample);
    const decision=await evaluate(sample);
    assert.equal(decision.simulationEligible,false);
    assert.ok(decision.reasons.includes('INVALID_OR_LOCKED_PERIOD'));
  }
});
test('VAT, amounts and balanced BAS accounts must match trusted repeat template',async()=>{
  for(const [change,expected] of [
    [v=>{v.candidate.vatOre=26000},'AMOUNT_OR_VAT_MISMATCH'],
    [v=>{v.candidate.grossOre=126000},'AMOUNT_OR_VAT_MISMATCH'],
    [v=>{v.candidate.lines[2].creditOre=124000},'ACCOUNTS_OR_JOURNAL_INVALID'],
    [v=>{v.candidate.lines[0].account='1940'},'ACCOUNTS_OR_JOURNAL_INVALID'],
    [v=>{v.candidate.lines.push({account:'9999',debitOre:0,creditOre:1})},'ACCOUNTS_OR_JOURNAL_INVALID'],
    [v=>{v.checks.accountsActive=false},'ACCOUNTS_OR_JOURNAL_INVALID'],
    [v=>{v.checks.vatRulesVerified=false},'ACCOUNTS_OR_JOURNAL_INVALID']
  ]){
    const sample=example();change(sample);
    const decision=await evaluate(sample);
    assert.equal(decision.simulationEligible,false);
    assert.ok(decision.reasons.includes(expected));
  }
});
test('credit notes, foreign currency and unusual VAT are not in first automatic pilot',async()=>{
  for(const change of [
    v=>{v.candidate.creditNote=true},
    v=>{v.candidate.currency='EUR'},
    v=>{v.candidate.vatTreatment='reverse-charge'},
    v=>{v.candidate.kind='bank-payment'}
  ]){
    const sample=example();change(sample);
    const result=await evaluate(sample);
    assert.equal(result.simulationEligible,false);
    assert.ok(result.reasons.includes('TRANSACTION_REQUIRES_REVIEW'));
  }
});
test('append-only audit readiness must be confirmed',async()=>{
  const sample=example();sample.checks.auditReady=false;
  assert.ok((await evaluate(sample)).reasons.includes('AUDIT_NOT_READY'));
});
test('module cannot post journal entries, send payments or access private data',()=>{
  const text=fs.readFileSync(path.join(__dirname,'..','packages/automation/ai-autopost-readiness.mjs'),'utf8');
  assert.doesNotMatch(text,/\bfetch\s*\(|\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.functions\.invoke\s*\(/);
  assert.doesNotMatch(text,/SUPABASE_SERVICE_ROLE_KEY|CLOUDFLARE_AI_TOKEN/);
  assert.match(text,/canPost:false/);
});
