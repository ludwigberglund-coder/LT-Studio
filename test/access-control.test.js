'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Access=require('../packages/access-control/authorization.js');
const config=require('../config/access-control.json');

const member=(id,role)=>({id,companyId:'company-a',role,authenticated:true,membershipActive:true});

test('rollmatrisen följer LT Studios fyra beslutade behörighetsnivåer',()=>{
  const model=Access.createModel(config);
  assert.equal(config.policy.requireMfa,true);
  assert.deepEqual(config.roles.map(role=>role.id),['admin','accountant','approver','readonly']);

  const all=new Set(config.permissions.map(permission=>permission.id));
  const readNoPayroll=new Set(config.permissions.filter(permission=>permission.risk==='read'&&permission.id!=='payroll.view').map(permission=>permission.id));

  const admin=Access.permissionsForActor(model,member('admin-user','admin'));
  const customerAdminExpected=new Set([...all].filter(permission=>permission!=='users.manage'));
  assert.deepEqual(admin,customerAdminExpected);
  assert.equal(admin.has('users.manage'),false);

  const accountant=Access.permissionsForActor(model,member('economy-user','accountant'));
  for(const permission of all){
    const expected=!['platform.settings.manage','users.manage','website.manage'].includes(permission);
    assert.equal(accountant.has(permission),expected,`accountant: ${permission}`);
  }
  assert.equal(accountant.has('payroll.view'),true);
  assert.equal(accountant.has('payroll.import'),true);

  const approver=Access.permissionsForActor(model,member('approver-user','approver'));
  for(const permission of readNoPayroll) assert.equal(approver.has(permission),true,`approver read: ${permission}`);
  assert.equal(approver.has('supplier-invoice.approve'),true);
  assert.equal(approver.has('payroll.view'),false);
  assert.equal(approver.has('accounting.post'),false);
  assert.equal(approver.has('payment.release'),false);
  assert.equal(approver.has('documents.upload'),false);

  const readonly=Access.permissionsForActor(model,member('readonly-user','readonly'));
  assert.deepEqual(readonly,readNoPayroll);
  assert.equal(readonly.has('payroll.view'),false);
  assert.equal(readonly.has('supplier-invoice.approve'),false);
});

test('saknad eller ogiltig roll nekas fail-closed',()=>{
  const model=Access.createModel(config);
  for(const actor of [
    null,{},
    {...member('anna','admin'),id:''},
    {...member('anna','admin'),authenticated:false},
    {...member('anna','admin'),companyId:''},
    {...member('anna','admin'),membershipActive:false},
    {...member('anna','admin'),disabled:true},
    {...member('anna','admin'),role:''},
    {...member('anna','admin'),role:'unknown-role'}
  ]){
    assert.equal(Access.authorize(model,actor,'accounting.post').allowed,false);
    assert.throws(()=>Access.requirePermission(model,actor,'accounting.post'),error=>error.code==='ACCESS_DENIED');
  }
});

test('attestant får attestera leverantörsfaktura men inte andra kritiska arbetsflöden',()=>{
  const model=Access.createModel(config);
  const approver=member('bo','approver');
  const invoiceWorkflow=config.workflows.find(workflow=>workflow.id==='supplier-invoice-approval');
  const invoiceAssignments=Object.fromEntries(invoiceWorkflow.fields.map((field,index)=>[field.id,index?'bo':'anna']));
  assert.equal(Access.evaluateWorkflowAction(model,approver,invoiceWorkflow.id,invoiceAssignments).allowed,true);

  for(const workflow of config.workflows.filter(workflow=>workflow.id!=='supplier-invoice-approval')){
    const separate=Object.fromEntries(workflow.fields.map((field,index)=>[field.id,index?'bo':'anna']));
    assert.equal(Access.evaluateWorkflowAction(model,approver,workflow.id,separate).allowed,false);
  }
});

test('personseparation gäller även för roller som har rätt permission',()=>{
  const model=Access.createModel(config);
  for(const workflow of config.workflows){
    const same=Object.fromEntries(workflow.fields.map(field=>[field.id,'anna']));
    assert.equal(Access.evaluateWorkflowAction(model,member('anna','admin'),workflow.id,same).allowed,false);
    const separate=Object.fromEntries(workflow.fields.map((field,index)=>[field.id,index?'bo':'anna']));
    assert.equal(Access.evaluateWorkflowAction(model,member('bo','admin'),workflow.id,separate).allowed,true);
  }
});

test('ogiltig rollkonfiguration och osäker MFA-policy stoppas vid start',()=>{
  for(const mutate of [
    c=>c.permissions.push(c.permissions[0]),
    c=>c.policy.requireMfa=false,
    c=>c.workflows[0].requiredPermission='unknown.action',
    c=>c.roles.push(c.roles[0]),
    c=>c.roles[0].permissions.push('unknown.action')
  ]){
    const broken=structuredClone(config);mutate(broken);
    assert.throws(()=>Access.createModel(broken),error=>error.code==='INVALID_ACCESS_CONFIG');
  }
});
