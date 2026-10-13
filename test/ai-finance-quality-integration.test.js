'use strict';
// Integration with the REAL synthetic process orchestrator (mocked Auth/RLS/quota
// and provider). It never contacts Supabase, Cloudflare, banks or real documents.
const test=require('node:test');
const assert=require('node:assert/strict');
const USER='11111111-1111-4111-8111-111111111111';
const SESSION='22222222-2222-4222-8222-222222222222';
const COMPANY='tenant-qa-alpha';
const INTRUDER='tenant-qa-other';
const RESERVATION={persisted:true,companyAllowed:true,globalAllowed:true,idempotent:true,
  reservationId:'reservation-qa-test-0000001'};
const ANSWER={decision:'review-source',
  explanation:'Kontrollera originalunderlaget innan någon ekonomisk åtgärd godkänns.',
  uncertainties:['Underlaget måste jämföras mot företagets registrerade uppgifter.']};
const loadGate=()=>import('../packages/automation/ai-synthetic-quality-gate.mjs');
const loadEngine=()=>import('../packages/automation/ai-finance-process-orchestrator.mjs');
const loadContract=()=>import('../packages/automation/ai-finance-process-contract.mjs');
function token(){
  return ['e30',Buffer.from(JSON.stringify({sub:USER,session_id:SESSION,aal:'aal2'})).toString('base64url'),'c2ln'].join('.');
}
function scopedClient({role='accountant',companyId=COMPANY}={}){
  return {
    auth:{getUser:async()=>({data:{user:{id:USER}},error:null})},
    from:table=>{
      assert.equal(table,'company_memberships');
      const query={
        select:()=>query,eq:()=>query,
        maybeSingle:async()=>({data:{company_id:companyId,auth_user_id:USER,role},error:null})
      };
      return query;
    }
  };
}
function matrix(purposes){
  return purposes.flatMap(purpose=>[
    {id:'qa-'+purpose+'-safe',purpose,companyId:COMPANY,
      requestId:'qa-finance-000000000001',expected:'safe-review'},
    {id:'qa-'+purpose+'-readonly',purpose,companyId:COMPANY,
      requestId:'qa-finance-000000000002',expected:'blocked',errorCode:'ACCESS_DENIED'},
    {id:'qa-'+purpose+'-cross-tenant',purpose,companyId:COMPANY,
      requestId:'qa-finance-000000000003',expected:'blocked',errorCode:'ACCESS_DENIED'},
    {id:'qa-'+purpose+'-bad-model',purpose,companyId:COMPANY,
      requestId:'qa-finance-000000000004',expected:'blocked',errorCode:'INVALID_MODEL_ADVICE'}
  ]);
}
test('all ten REAL synthetic process flows satisfy independent AI quality gate',async()=>{
  const {evaluateSyntheticAiSafety}=await loadGate();
  const {runSyntheticFinanceProcess}=await loadEngine();
  const {SUPPORTED_PURPOSES}=await loadContract();
  let authBoundRequests=0,quotaReservations=0,modelCalls=0;
  const report=await evaluateSyntheticAiSafety({
    purposes:SUPPORTED_PURPOSES,cases:matrix(SUPPORTED_PURPOSES),
    invoke:async(ctx,id)=>{
      authBoundRequests++;
      assert.deepEqual(Object.keys(ctx).sort(),['companyId','purpose','requestId']);
      const badModel=id.endsWith('-bad-model');
      return runSyntheticFinanceProcess({
        body:{companyId:ctx.companyId,purpose:ctx.purpose,requestId:ctx.requestId},
        accessToken:token(),
        userClient:scopedClient({
          role:id.endsWith('-readonly')?'readonly':'accountant',
          companyId:id.endsWith('-cross-tenant')?INTRUDER:COMPANY
        }),
        enabled:true,privacyApproved:true,
        reserveBudget:async data=>{
          quotaReservations++;
          assert.equal(data.companyId,COMPANY);
          assert.equal(data.actorId,USER);
          assert.equal(data.sessionId,SESSION);
          assert.equal(data.requestId,ctx.requestId);
          return RESERVATION;
        },
        provider:async facts=>{
          modelCalls++;
          assert.equal(facts.synthetic,true);
          assert.equal(facts.purpose,ctx.purpose);
          assert.equal(Object.isFrozen(facts),true);
          for(const key of ['companyId','actorId','sessionId','requestId','accessToken','documentId','pdf']){
            assert.equal(Object.hasOwn(facts,key),false);
          }
          return badModel?{...ANSWER,posted:true}:ANSWER;
        }
      });
    }
  });
  assert.equal(report.total,40);
  assert.equal(report.passed,40);
  assert.equal(report.failed,0);
  assert.equal(report.gaps.length,0);
  assert.equal(report.structurallySafe,true);
  assert.equal(report.accountingAccuracyVerified,false);
  assert.equal(authBoundRequests,40);
  // Denied tenant/role checks MUST happen before durable quota and provider.
  assert.equal(quotaReservations,20);
  assert.equal(modelCalls,20);
  assert.doesNotMatch(JSON.stringify(report),/tenant-qa-alpha|tenant-qa-other|session_id|11111111/);
});

test('postcondition denies Unicode display spoofing that upstream model adapter does not',async()=>{
  const {runSyntheticFinanceProcess}=await loadEngine();
  let providerCalls=0;
  await assert.rejects(()=>runSyntheticFinanceProcess({
    body:{companyId:COMPANY,purpose:'report-explanation',requestId:'qa-finance-000000000005'},
    accessToken:token(),userClient:scopedClient(),
    enabled:true,privacyApproved:true,
    reserveBudget:async()=>RESERVATION,
    provider:async()=>{
      providerCalls++;
      return {...ANSWER,explanation:'Kontrollera ekonomin \u202e med rätt företagsuppgifter innan attest.'};
    }
  }),error=>error?.code==='UNSAFE_AI_ADVICE');
  assert.equal(providerCalls,1);
});

test('default-off finance engine still has no authentication, quota or AI side effects',async()=>{
  const {runSyntheticFinanceProcess}=await loadEngine();
  let calls=0;
  const input={
    body:{companyId:COMPANY,purpose:'year-close',requestId:'qa-finance-000000000006'},
    accessToken:token(),
    userClient:{auth:{getUser:async()=>{calls++;return null}}},
    reserveBudget:async()=>{calls++;return RESERVATION},
    provider:async()=>{calls++;return ANSWER}
  };
  await assert.rejects(()=>runSyntheticFinanceProcess(input),error=>error?.code==='AI_PILOT_DISABLED');
  assert.equal(calls,0);
});

test('finance process output always passes the independent review-only validator',async()=>{
  const {validateReviewOnlySyntheticProposal}=await loadGate();
  const {runSyntheticFinanceProcess}=await loadEngine();
  const context={companyId:COMPANY,purpose:'supplier-invoice-review',requestId:'qa-finance-000000000007'};
  const proposal=await runSyntheticFinanceProcess({
    body:context,accessToken:token(),userClient:scopedClient(),
    enabled:true,privacyApproved:true,reserveBudget:async()=>RESERVATION,
    provider:async()=>ANSWER
  });
  const second=validateReviewOnlySyntheticProposal(proposal,context);
  assert.deepEqual(second,proposal);
  assert.notEqual(second,proposal);
  assert.equal(proposal.status,'manual-review');
  assert.equal(proposal.posted,false);
  assert.equal(proposal.requiresHumanApproval,true);
  assert.equal(Object.isFrozen(proposal.advice.uncertainties),true);
});
