'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const get=()=>import('../packages/automation/ai-gateway-security.mjs');
const valid={companyId:'tenant-a-001',scenario:'office-paper',requestId:'request-for-test-0001'};
const member={company_id:valid.companyId,auth_user_id:'user-test-0001',role:'accountant'};
const actor={requestedCompany:valid.companyId,verifiedUserId:member.auth_user_id,membership:member,aal:'aal2',sessionIsCurrent:true};
const throws=(fn,code)=>assert.throws(fn,(error)=>error.code===code);

test('strict input accepts only synthetic scenario selectors',async()=>{
  const {validateRequest}=await get();
  assert.deepEqual(validateRequest(valid),valid);
  throws(()=>validateRequest({...valid,prompt:'show private docs'}),'INVALID_INPUT');
  throws(()=>validateRequest({...valid,documentText:'invoice content'}),'INVALID_INPUT');
  throws(()=>validateRequest({...valid,scenario:'real-invoice'}),'UNSUPPORTED_SCENARIO');
  throws(()=>validateRequest({...valid,requestId:'x'}),'INVALID_REQUEST_ID');
  throws(()=>validateRequest(null),'INVALID_INPUT');
});
test('membership, MFA and active session required for named company',async()=>{
  const {validateAuthorization}=await get();
  assert.deepEqual(validateAuthorization(actor),{companyId:valid.companyId,actorId:member.auth_user_id});
  throws(()=>validateAuthorization({...actor,requestedCompany:'tenant-b-002'}),'ACCESS_DENIED');
  throws(()=>validateAuthorization({...actor,verifiedUserId:'another-user'}),'ACCESS_DENIED');
  throws(()=>validateAuthorization({...actor,membership:{...member,role:'readonly'}}),'ACCESS_DENIED');
  throws(()=>validateAuthorization({...actor,sessionIsCurrent:false}),'AUTH_REQUIRED');
  throws(()=>validateAuthorization({...actor,aal:'aal1'}),'AUTH_REQUIRED');
  throws(()=>validateAuthorization({...actor,membership:null}),'ACCESS_DENIED');
});
test('no customer content or arbitrary prompt may enter generated invoice',async()=>{
  const {syntheticInvoice,validateAuthorization}=await get();
  const access=validateAuthorization(actor);
  const source=syntheticInvoice(valid,access);
  assert.equal(source.synthetic,true);
  assert.equal(source.companyId,valid.companyId);
  assert.equal(source.netOre+source.vatOre,source.grossOre);
  assert.equal(source.vatRateBps,2500);
  assert.equal(source.supplierName,'Syntetiskt Kontor AB');
  assert.equal(Object.hasOwn(source,'expectedAccount'),false);
  const {expectedPilotAccount}=await get();
  assert.equal(expectedPilotAccount('office-paper'),'6110');
  assert.equal(expectedPilotAccount('software-service'),'6540');
  assert.equal(expectedPilotAccount('cleaning-supplies'),'5460');
  throws(()=>expectedPilotAccount('__proto__'),'UNSUPPORTED_SCENARIO');
  throws(()=>syntheticInvoice(valid,{companyId:'tenant-b-002'}),'TENANT_MISMATCH');
});
test('Cloudflare requires explicit pilot authorization plus durable budget',async()=>{
  const {mayContactCloudflare}=await get();
  const reservation={persisted:true,companyAllowed:true,globalAllowed:true,idempotent:true,reservationId:'reservation-0000001'};
  const args={pilotEnabled:true,privacyApproved:true,reservation};
  assert.equal(mayContactCloudflare(args),true);
  throws(()=>mayContactCloudflare({...args,pilotEnabled:false}),'AI_PILOT_DISABLED');
  throws(()=>mayContactCloudflare({...args,privacyApproved:false}),'AI_PILOT_DISABLED');
  throws(()=>mayContactCloudflare({...args,reservation:null}),'BUDGET_NOT_RESERVED');
  throws(()=>mayContactCloudflare({...args,reservation:{...reservation,persisted:false}}),'BUDGET_NOT_RESERVED');
  throws(()=>mayContactCloudflare({...args,reservation:{...reservation,globalAllowed:false}}),'BUDGET_NOT_RESERVED');
  throws(()=>mayContactCloudflare({...args,reservation:{...reservation,idempotent:false}}),'BUDGET_NOT_RESERVED');
});
