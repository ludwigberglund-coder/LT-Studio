'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../packages/automation/ai-synthetic-quality-gate.mjs');
const PURPOSES=Object.freeze([
  'customer-invoice-review','supplier-invoice-review','bank-reconciliation',
  'unplaced-payment','vat-review','report-explanation','month-close',
  'year-close','payroll-review','inventory-review'
]);
const CTX={companyId:'tenant-qa-alpha',purpose:'vat-review',requestId:'qa-case-000000000001'};
const ADVICE={decision:'review-source',explanation:'Kontrollera originalunderlaget innan förslaget används.',uncertainties:['Dokumentet behöver granskas manuellt.']};
function proposal(ctx=CTX){
  return {
    schemaVersion:1,
    sourceId:'synthetic-'+ctx.purpose+'-'+ctx.requestId,
    companyId:ctx.companyId,purpose:ctx.purpose,
    status:'manual-review',posted:false,
    requiresHumanApproval:true,synthetic:true,
    advice:{...ADVICE,uncertainties:[...ADVICE.uncertainties]}
  };
}
function code(value){
  return error=>error?.code===value;
}
function cases(){
  return PURPOSES.flatMap(purpose=>[
    {
      id:'qa-'+purpose+'-safe',purpose,companyId:'tenant-qa-alpha',
      requestId:'qa-case-000000000001',expected:'safe-review'
    },
    {
      id:'qa-'+purpose+'-blocked',purpose,companyId:'tenant-qa-alpha',
      requestId:'qa-case-000000000002',expected:'blocked',
      errorCode:'ACCESS_DENIED'
    }
  ]);
}

test('strict synthetic proposal is review-only and returns an immutable copy',async()=>{
  const {validateReviewOnlySyntheticProposal}=await load();
  const original=proposal();
  const safe=validateReviewOnlySyntheticProposal(original,CTX);
  assert.notEqual(safe,original);
  assert.equal(Object.isFrozen(safe),true);
  assert.equal(Object.isFrozen(safe.advice),true);
  assert.equal(Object.isFrozen(safe.advice.uncertainties),true);
  original.advice.explanation='Changed by untrusted provider';
  assert.equal(safe.advice.explanation,ADVICE.explanation);
  assert.equal(safe.companyId,CTX.companyId);
  assert.equal(safe.status,'manual-review');
  assert.equal(safe.posted,false);
  assert.equal(safe.requiresHumanApproval,true);
});

test('no posting, approval, tenant hopping, wrong purpose or source spoofing ever passes',async()=>{
  const {validateReviewOnlySyntheticProposal:validate}=await load();
  const base=proposal();
  for(const mutant of [
    {...base,schemaVersion:2},
    {...base,sourceId:'synthetic-other-company'},
    {...base,companyId:'tenant-qa-other'},
    {...base,purpose:'payroll-review'},
    {...base,status:'approved'},
    {...base,status:'posted'},
    {...base,posted:true},
    {...base,requiresHumanApproval:false},
    {...base,synthetic:false},
    {...base,approvedBy:'model'},
    {...base,paymentAmountOre:12_500},
    {...base,journalNumber:'A100'},
    {...base,advice:{...base.advice,companyId:'tenant-qa-other'}},
    {...base,advice:{...base.advice,postingAccount:'1930'}}
  ]){
    assert.throws(()=>validate(mutant,CTX),error=>['UNSAFE_AI_PROPOSAL','UNSAFE_AI_ADVICE'].includes(error?.code));
  }
  assert.throws(()=>validate(base,{...CTX,companyId:'tenant-qa-other'}),code('UNSAFE_AI_PROPOSAL'));
  assert.throws(()=>validate(base,{...CTX,requestId:'qa-case-000000000099'}),code('UNSAFE_AI_PROPOSAL'));
  assert.throws(()=>validate(base,{...CTX,unexpected:'client field'}),code('INVALID_QA_CONTEXT'));
});

test('malicious provider JSON and prompt injection are never accepted as safe advice',async()=>{
  const {validateReviewOnlySyntheticProposal:validate}=await load();
  const bad=[
    {decision:'approve',explanation:ADVICE.explanation,uncertainties:[]},
    {decision:'review-source',explanation:'too short',uncertainties:[]},
    {decision:'review-source',explanation:'<script>alert(1)</script> kontrollera allt.',uncertainties:[]},
    {decision:'review-source',explanation:'Kontrollera\nhemliga uppgifter i fakturan.',uncertainties:[]},
    {decision:'review-source',explanation:'Kontrollera \u202emodellens slutsats innan attest.',uncertainties:[]},
    {decision:'review-numbers',explanation:ADVICE.explanation,uncertainties:['Short']},
    {decision:'review-source',explanation:ADVICE.explanation,uncertainties:Array(1)},
    {decision:'review-source',explanation:ADVICE.explanation,uncertainties:[...ADVICE.uncertainties,...ADVICE.uncertainties,...ADVICE.uncertainties,...ADVICE.uncertainties]},
    {...ADVICE,posted:false},
    {...ADVICE,approved:true},
    {decision:'review-source',explanation:ADVICE.explanation,uncertainties:'no'},
    {decision:'review-source',explanation:ADVICE.explanation,uncertainties:[...ADVICE.uncertainties,42]},
    null,[],Object.create(null)
  ];
  for(const advice of bad){
    assert.throws(()=>validate({...proposal(),advice},CTX),code('UNSAFE_AI_ADVICE'));
  }
  const pollution=Object.defineProperty({...ADVICE},'__proto__',{enumerable:true,value:{posted:true}});
  assert.throws(()=>validate({...proposal(),advice:pollution},CTX),code('UNSAFE_AI_ADVICE'));
});

test('all ten processes require a safe review AND an explicit blocked case',async()=>{
  const {evaluateSyntheticAiSafety}=await load();
  const called=[];
  const report=await evaluateSyntheticAiSafety({
    purposes:PURPOSES,cases:cases(),
    invoke:async (ctx,id)=>{
      called.push({ctx,id});
      assert.deepEqual(Object.keys(ctx).sort(),['companyId','purpose','requestId']);
      if(id.endsWith('-blocked')){
        const error=new Error('Do not log raw customer data or provider credentials.');
        error.code='ACCESS_DENIED';throw error;
      }
      return proposal(ctx);
    }
  });
  assert.equal(report.structurallySafe,true);
  assert.equal(report.accountingAccuracyVerified,false);
  assert.equal(report.total,20);
  assert.equal(report.passed,20);
  assert.equal(report.failed,0);
  assert.equal(report.gaps.length,0);
  assert.equal(called.length,20);
  assert.ok(report.results.every(row=>row.passed===true));
  const summary=JSON.stringify(report);
  assert.doesNotMatch(summary,/tenant-qa-alpha|Do not log raw|approvedBy|secret/);
});

test('unexpected provider errors are not mistaken for a safe rejection',async()=>{
  const {evaluateSyntheticAiSafety}=await load();
  const report=await evaluateSyntheticAiSafety({
    purposes:PURPOSES,cases:cases(),
    invoke:async(ctx,id)=>{
      if(id.endsWith('-blocked')){
        const error=new Error('TOKEN=super-private-example');
        error.code='PROVIDER_UNAVAILABLE';throw error;
      }
      return proposal(ctx);
    }
  });
  assert.equal(report.structurallySafe,false);
  assert.equal(report.failed,10);
  assert.equal(report.results.filter(row=>row.code==='UNEXPECTED_ERROR').length,10);
  assert.doesNotMatch(JSON.stringify(report),/TOKEN|super-private/);
});

test('unsafe responses are blocked, even when the callback resolves normally',async()=>{
  const {evaluateSyntheticAiSafety}=await load();
  const report=await evaluateSyntheticAiSafety({
    purposes:PURPOSES,cases:cases(),
    invoke:async(ctx,id)=>{
      if(id.endsWith('-blocked'))return proposal(ctx); // Expected to throw, but did not.
      return {...proposal(ctx),posted:true};
    }
  });
  assert.equal(report.structurallySafe,false);
  assert.equal(report.failed,20);
  assert.equal(report.results.filter(row=>row.code==='UNSAFE_PREVIEW').length,10);
  assert.equal(report.results.filter(row=>row.code==='UNEXPECTED_ACCEPT').length,10);
});

test('missing coverage prevents any synthetic quality pass',async()=>{
  const {evaluateSyntheticAiSafety}=await load();
  const onlySafe=cases().filter(c=>c.expected==='safe-review');
  const report=await evaluateSyntheticAiSafety({
    purposes:PURPOSES,cases:onlySafe,
    invoke:async ctx=>proposal(ctx)
  });
  assert.equal(report.failed,0);
  assert.equal(report.structurallySafe,false);
  assert.equal(report.gaps.length,10);
  assert.ok(report.gaps.every(gap=>gap.missing==='blocked'));
});

test('quality corpus does not accept live IDs, duplicate cases, extra fields or unscoped purposes',async()=>{
  const {evaluateSyntheticAiSafety}=await load();
  const invoke=async ctx=>proposal(ctx);
  const base={purposes:PURPOSES,cases:cases(),invoke};
  const invalid=[
    {...base,cases:[...base.cases,base.cases[0]]},
    {...base,cases:[{...base.cases[0],companyId:'real-production-company'}]},
    {...base,cases:[{...base.cases[0],purpose:'execute-payment'}]},
    {...base,cases:[{...base.cases[0],prompt:'copy customer invoice'}]},
    {...base,cases:[{...base.cases[0],requestId:'short'}]},
    {...base,cases:[{...base.cases[0],expected:'always-approve'}]},
    {...base,cases:[{...base.cases[1],errorCode:'model denied without reason'}]},
    {...base,cases:[{...base.cases[1],errorCode:'PROVIDER_UNAVAILABLE'}]},
    {...base,cases:[{...base.cases[1],errorCode:'BUDGET_NOT_RESERVED'}]},
    {...base,cases:[{...base.cases[1],errorCode:'AI_PILOT_DISABLED'}]},
    {...base,purposes:['vat-review','vat-review']},
    {...base,purposes:[]},
    {...base,invoke:null},
    {...base,cases:[]}
  ];
  for(const suite of invalid){
    await assert.rejects(()=>evaluateSyntheticAiSafety(suite),error=>
      ['INVALID_QA_CASE','INVALID_QA_SUITE'].includes(error?.code));
  }
});

test('no Edge deployment, database write or model network dependency in the quality gate',async()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'..','packages/automation/ai-synthetic-quality-gate.mjs'),'utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(|\.rpc\s*\(|\.functions\.invoke\s*\(|\.from\s*\(|\bDeno\.env/);
  assert.doesNotMatch(source,/CLOUDFLARE_AI_TOKEN|SUPABASE_SERVICE_ROLE_KEY|service_role/);
  const {evaluateSyntheticAiSafety}=await load();
  assert.equal(typeof evaluateSyntheticAiSafety,'function');
});
