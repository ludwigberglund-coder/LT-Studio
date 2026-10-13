'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const USER='11111111-1111-4111-8111-111111111111';
const SESSION='22222222-2222-4222-8222-222222222222';
const REQUEST={companyId:'tenant-a-001',purpose:'bank-reconciliation',requestId:'process-pilot-0000001'};
const RESERVATION={persisted:true,companyAllowed:true,globalAllowed:true,idempotent:true,reservationId:'reservation-00000000001'};
const ANSWER={decision:'review-source',explanation:'Kontrollera originalunderlaget innan någon åtgärd godkänns.',uncertainties:['Belopp och datum måste jämföras med fakturan.']};
const loadContract=()=>import('../packages/automation/ai-finance-process-contract.mjs');
const loadEngine=()=>import('../packages/automation/ai-finance-process-orchestrator.mjs');
const jwt=(claims={})=>['e30',Buffer.from(JSON.stringify({sub:USER,session_id:SESSION,aal:'aal2',...claims})).toString('base64url'),'c2ln'].join('.');
function userClient({role='accountant',companyId=REQUEST.companyId,userId=USER,dbError=false,authError=false}={}){
  const calls=[];
  return {calls,
    auth:{getUser:async token=>{calls.push(['user',token]);return authError?{error:{},data:{}}:{error:null,data:{user:{id:userId}}};}},
    from:table=>{
      calls.push(['from',table]);assert.equal(table,'company_memberships');
      const q={
        select:fields=>{calls.push(['select',fields]);return q;},
        eq:(field,value)=>{calls.push(['eq',field,value]);return q;},
        maybeSingle:async()=>dbError?{data:null,error:{message:'denied'}}:{data:{company_id:companyId,auth_user_id:userId,role},error:null}
      };
      return q;
    }
  };
}
function options(more={}){
  return {body:REQUEST,accessToken:jwt(),userClient:userClient(),enabled:true,privacyApproved:true,
    reserveBudget:async()=>RESERVATION,provider:async()=>ANSWER,...more};
}
function hasCode(code){return e=>e?.code===code;}

test('ten finance types have fully synthetic, immutable example facts',async()=>{
  const {SUPPORTED_PURPOSES,PROCESS_DEFINITIONS,MODEL_RESPONSE_SCHEMA}=await loadContract();
  assert.deepEqual(SUPPORTED_PURPOSES,[
    'customer-invoice-review','supplier-invoice-review','bank-reconciliation','unplaced-payment',
    'vat-review','report-explanation','month-close','year-close','payroll-review','inventory-review'
  ]);
  assert.equal(MODEL_RESPONSE_SCHEMA.additionalProperties,false);
  assert.deepEqual(MODEL_RESPONSE_SCHEMA.required,['decision','explanation','uncertainties']);
  for(const purpose of SUPPORTED_PURPOSES){
    const def=PROCESS_DEFINITIONS[purpose];
    assert.ok(def.label&&def.kind&&Object.isFrozen(def.facts));
  }
});

test('only company, purpose and request ID can enter the generic AI request',async()=>{
  const {validateProcessRequest}=await loadContract();
  assert.deepEqual(validateProcessRequest(REQUEST),REQUEST);
  for(const field of ['prompt','documentText','sourceId','amountOre','model','pdf','provider']){
    assert.throws(()=>validateProcessRequest({...REQUEST,[field]:'attacker input'}),hasCode('INVALID_PROCESS_REQUEST'));
  }
  assert.throws(()=>validateProcessRequest({...REQUEST,purpose:'create-payment'}),hasCode('UNSUPPORTED_PURPOSE'));
  assert.throws(()=>validateProcessRequest({...REQUEST,companyId:'tenant b'}),hasCode('INVALID_COMPANY'));
  assert.throws(()=>validateProcessRequest({...REQUEST,requestId:'x'}),hasCode('INVALID_REQUEST_ID'));
  assert.throws(()=>validateProcessRequest(null),hasCode('INVALID_PROCESS_REQUEST'));
  assert.throws(()=>validateProcessRequest(Object.assign(Object.create(null),REQUEST)),hasCode('INVALID_PROCESS_REQUEST'));
  const prototypePollution=Object.defineProperty({...REQUEST},'__proto__',{value:{hack:1},enumerable:true});
  assert.throws(()=>validateProcessRequest(prototypePollution),hasCode('INVALID_PROCESS_REQUEST'));
});

test('client verified=true cannot forge an authenticated process case',async()=>{
  const {validateProcessRequest,buildSyntheticProcessCase,isVerifiedSyntheticCase}=await loadContract();
  const request=validateProcessRequest(REQUEST);
  const fake={companyId:REQUEST.companyId,actorId:USER,aal:'aal2',verified:true,pilotMode:'synthetic'};
  assert.throws(()=>buildSyntheticProcessCase(request,fake),hasCode('AUTH_REQUIRED'));
  assert.equal(isVerifiedSyntheticCase({synthetic:true,purpose:request.purpose}),false);
});

test('all finance processes go through verified MFA, company RLS and durable quota',async()=>{
  const {SUPPORTED_PURPOSES}=await loadContract();
  const {runSyntheticFinanceProcess}=await loadEngine();
  for(const purpose of SUPPORTED_PURPOSES){
    let providers=0;const reservations=[];
    const body={...REQUEST,purpose};
    const result=await runSyntheticFinanceProcess(options({
      body,
      reserveBudget:async fields=>{reservations.push(fields);return RESERVATION;},
      provider:async facts=>{
        providers++;
        assert.equal(facts.synthetic,true);
        assert.equal(facts.purpose,purpose);
        assert.equal(Object.isFrozen(facts),true);
        for(const key of ['companyId','actorId','sessionId','accessToken','requestId','documentId']){
          assert.equal(Object.hasOwn(facts,key),false);
        }
        return ANSWER;
      }
    }));
    assert.equal(providers,1);
    assert.deepEqual(reservations,[{companyId:REQUEST.companyId,actorId:USER,sessionId:SESSION,requestId:REQUEST.requestId}]);
    assert.equal(result.schemaVersion,1);
    assert.equal(result.purpose,purpose);
    assert.equal(result.companyId,REQUEST.companyId);
    assert.equal(result.synthetic,true);
    assert.equal(result.posted,false);
    assert.equal(result.requiresHumanApproval,true);
    assert.equal(result.status,'manual-review');
    assert.deepEqual(result.advice,ANSWER);
    assert.match(result.sourceId,/^synthetic-/);
    assert.equal(Object.hasOwn(result,'approve'),false);
  }
});

test('disabled by default: neither session nor provider nor quota are contacted',async()=>{
  const {runSyntheticFinanceProcess}=await loadEngine();
  let calls=0;const scoped=userClient();
  const base=options({userClient:scoped,enabled:false,privacyApproved:false,
    reserveBudget:async()=>{calls++;return RESERVATION;},
    provider:async()=>{calls++;return ANSWER}
  });
  await assert.rejects(()=>runSyntheticFinanceProcess(base),hasCode('AI_PILOT_DISABLED'));
  await assert.rejects(()=>runSyntheticFinanceProcess({...base,enabled:true}),hasCode('AI_PILOT_DISABLED'));
  assert.equal(calls,0);
  assert.equal(scoped.calls.length,0);
});

test('missing, failed or non-durable rate-limit reservation blocks model calls',async()=>{
  const {runSyntheticFinanceProcess}=await loadEngine();
  let calls=0;const scoped=userClient();
  await assert.rejects(()=>runSyntheticFinanceProcess(options({
    userClient:scoped,reserveBudget:null,provider:async()=>{calls++;return ANSWER}
  })),hasCode('BUDGET_NOT_CONFIGURED'));
  assert.equal(scoped.calls.length,0);
  for(const invalid of [
    null,{...RESERVATION,persisted:false},{...RESERVATION,companyAllowed:false},
    {...RESERVATION,globalAllowed:false},{...RESERVATION,idempotent:false},
    {...RESERVATION,reservationId:'x'}
  ]){
    await assert.rejects(()=>runSyntheticFinanceProcess(options({
      reserveBudget:async()=>invalid,provider:async()=>{calls++;return ANSWER}
    })),hasCode('BUDGET_NOT_RESERVED'));
  }
  await assert.rejects(()=>runSyntheticFinanceProcess(options({
    reserveBudget:async()=>{throw new Error('secret database failure')},
    provider:async()=>{calls++;return ANSWER}
  })),hasCode('BUDGET_NOT_RESERVED'));
  assert.equal(calls,0);
});

test('cross-company, readonly, revoked RLS, MFA and malformed JWT reject before quota',async()=>{
  const {runSyntheticFinanceProcess}=await loadEngine();
  let calls=0;const base=()=>options({
    reserveBudget:async()=>{calls++;return RESERVATION},
    provider:async()=>{calls++;return ANSWER}
  });
  const invalid=[
    [userClient({companyId:'tenant-b-002'}),jwt(),'ACCESS_DENIED'],
    [userClient({role:'readonly'}),jwt(),'ACCESS_DENIED'],
    [userClient({dbError:true}),jwt(),'ACCESS_DENIED'],
    [userClient(),jwt({aal:'aal1'}),'AUTH_REQUIRED'],
    [userClient(),jwt({sub:'33333333-3333-4333-8333-333333333333'}),'AUTH_REQUIRED'],
    [userClient({authError:true}),jwt(),'AUTH_REQUIRED'],
    [userClient(),'invalid','AUTH_REQUIRED']
  ];
  for(const [scoped,accessToken,expected] of invalid){
    await assert.rejects(()=>runSyntheticFinanceProcess({...base(),userClient:scoped,accessToken}),hasCode(expected));
  }
  assert.equal(calls,0);
});

test('model cannot approve/post, add amounts, change tenant or embed HTML',async()=>{
  const {validateProcessAdvice}=await loadContract();
  assert.deepEqual(validateProcessAdvice(ANSWER),ANSWER);
  for(const invalid of [
    {...ANSWER,posted:true},{...ANSWER,status:'approved'},
    {...ANSWER,companyId:'tenant-b-002'},{...ANSWER,transferAmountOre:123},
    {...ANSWER,decision:'auto-pay'},{...ANSWER,explanation:'kort'},
    {...ANSWER,explanation:'Kontrollera <script>alert(1)</script> genom att klicka.'},
    {...ANSWER,uncertainties:['x']},
    {...ANSWER,uncertainties:['eight letters','more than eight','at least eight','more again']},
    {...ANSWER,uncertainties:'nothing'},null
  ])assert.throws(()=>validateProcessAdvice(invalid),hasCode('INVALID_MODEL_ADVICE'));
  const {runSyntheticFinanceProcess}=await loadEngine();
  await assert.rejects(()=>runSyntheticFinanceProcess(options({
    provider:async()=>({...ANSWER,posted:true})
  })),hasCode('INVALID_MODEL_ADVICE'));
});
