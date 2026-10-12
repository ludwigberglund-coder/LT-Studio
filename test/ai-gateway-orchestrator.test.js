'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../packages/automation/ai-gateway-orchestrator.mjs');
const token = () => ['e30', Buffer.from(JSON.stringify({
  sub:'11111111-1111-4111-8111-111111111111',
  session_id:'22222222-2222-4222-8222-222222222222',aal:'aal2'
})).toString('base64url'), 'c2ln'].join('.');
const body = {companyId:'tenant-a-001',scenario:'office-paper',requestId:'request-pilot-001234'};
function client(role='accountant') {
  return {auth:{getUser:async()=>({data:{user:{id:'11111111-1111-4111-8111-111111111111'}},error:null})},
    from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({
      data:role ? {company_id:'tenant-a-001',auth_user_id:'11111111-1111-4111-8111-111111111111',role} : null,
      error:null
    })})})})})};
}
const reserve=async()=>({
  persisted:true,companyAllowed:true,globalAllowed:true,idempotent:true,
  reservationId:'reservation-pilot-001234'
});
const provider=async()=>({
  expenseAccount:'6110',reason:'Föreslaget konto för kontorsmaterial.',ambiguous:false
});
test('disabled synthetic pilot makes no network/database calls',async()=>{
  const {runSyntheticPilot}=await load();let calls=0;
  await assert.rejects(()=>runSyntheticPilot({
    body,accessToken:token(),userClient:client(),provider,
    reserveBudget:async()=>{calls++;return reserve();}
  }),e=>e.code==='AI_PILOT_DISABLED');
  assert.equal(calls,0);
});
test('budget reservation and provider are mandatory before any inference',async()=>{
  const {runSyntheticPilot}=await load();let providerCalls=0;
  const base={body,accessToken:token(),userClient:client(),
    pilotEnabled:true,privacyApproved:true,provider:async()=>{providerCalls++;return provider();}};
  await assert.rejects(()=>runSyntheticPilot(base),e=>e.code==='BUDGET_NOT_CONFIGURED');
  await assert.rejects(()=>runSyntheticPilot({...base,reserveBudget:async()=>null}),e=>e.code==='BUDGET_NOT_RESERVED');
  await assert.rejects(()=>runSyntheticPilot({...base,reserveBudget:async()=>{throw new Error('DB down')}}),e=>e.code==='BUDGET_NOT_RESERVED');
  await assert.rejects(()=>runSyntheticPilot({...base,reserveBudget:reserve,privacyApproved:false}),e=>e.code==='AI_PILOT_DISABLED');
  assert.equal(providerCalls,0);
});
test('real verified test request creates manually reviewed balanced proposal only',async()=>{
  const {runSyntheticPilot}=await load();let reservations=[],providers=0;
  const proposal = await runSyntheticPilot({
    body,accessToken:token(),userClient:client(),
    pilotEnabled:true,privacyApproved:true,
    reserveBudget:async(args)=>{reservations.push(args);return reserve();},
    provider:async(invoice)=>{providers++;assert.equal(invoice.companyId,'tenant-a-001');return provider();}
  });
  assert.deepEqual(reservations,[{
    companyId:'tenant-a-001',actorId:'11111111-1111-4111-8111-111111111111',
    requestId:'request-pilot-001234'
  }]);
  assert.equal(providers,1);
  assert.equal(proposal.type,'supplier-invoice-coding');
  assert.equal(proposal.ambiguous,true);
  assert.equal(proposal.deterministic,false);
  assert.equal(proposal.suggestion.requiresHumanApproval,true);
  assert.deepEqual(proposal.suggestion.rows.map(r=>[r.account,r.debitOre,r.creditOre]),[
    ['6110',100000,0],['2641',25000,0],['2440',0,125000]
  ]);
});
test('wrong-company or readonly membership blocks BEFORE durable reservation or inference',async()=>{
  const {runSyntheticPilot}=await load();let reservations=0,providers=0;
  const opts={body,accessToken:token(),userClient:client('readonly'),
    pilotEnabled:true,privacyApproved:true,
    reserveBudget:async()=>{reservations++;return reserve();},
    provider:async()=>{providers++;return provider();}};
  await assert.rejects(()=>runSyntheticPilot(opts),e=>e.code==='ACCESS_DENIED');
  await assert.rejects(()=>runSyntheticPilot({...opts,userClient:client(),
    body:{...body,companyId:'tenant-b-002'}}),e=>e.code==='ACCESS_DENIED');
  assert.equal(reservations,0);
  assert.equal(providers,0);
});
