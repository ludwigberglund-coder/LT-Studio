'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Access=require('../packages/access-control/authorization.js');
const config=require('../config/access-control.json');
const member=id=>({id,companyId:'company-a',authenticated:true,membershipActive:true});
test('alla personliga företagsmedlemmar har samma definierade åtgärder och MFA krävs',()=>{
  const model=Access.createModel(config);
  assert.equal(config.policy.requireMfa,true);
  assert.equal('roles' in config,false);
  for(const p of config.permissions){
    assert.equal(Access.authorize(model,member('anna'),p.id).allowed,true);
    assert.equal(Access.authorize(model,member('bo'),p.id).allowed,true);
  }
  assert.equal(Access.authorize(model,member('anna'),'unknown.action').allowed,false);
});
test('saknad identitet, inloggning, medlemskap och avstängt konto nekas',()=>{
  const model=Access.createModel(config);
  for(const actor of [null,{}, {...member('anna'),id:''},{...member('anna'),authenticated:false},{...member('anna'),companyId:''},{...member('anna'),membershipActive:false},{...member('anna'),disabled:true}]) {
    assert.equal(Access.authorize(model,actor,'accounting.post').allowed,false);
    assert.throws(()=>Access.requirePermission(model,actor,'accounting.post'),e=>e.code==='ACCESS_DENIED');
  }
});
test('personseparation gäller lika för alla företagsmedlemmar',()=>{
  const model=Access.createModel(config);
  for(const workflow of config.workflows){
    const same=Object.fromEntries(workflow.fields.map(f=>[f.id,'anna']));
    assert.equal(Access.evaluateWorkflowAction(model,member('anna'),workflow.id,same).allowed,false);
    const separate=Object.fromEntries(workflow.fields.map((f,i)=>[f.id,i?'bo':'anna']));
    assert.equal(Access.evaluateWorkflowAction(model,member('bo'),workflow.id,separate).allowed,true);
  }
});
test('ogiltiga åtgärder och osäker MFA-policy stoppas vid start',()=>{
  for(const mutate of [c=>c.permissions.push(c.permissions[0]),c=>c.policy.requireMfa=false,c=>c.workflows[0].requiredPermission='unknown.action']){
    const broken=structuredClone(config);mutate(broken);
    assert.throws(()=>Access.createModel(broken),e=>e.code==='INVALID_ACCESS_CONFIG');
  }
});
