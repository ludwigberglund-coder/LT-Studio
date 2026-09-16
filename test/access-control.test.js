'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AccessControl = require('../packages/access-control/authorization.js');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'access-control.json'), 'utf8'));

test('behörighetskonfigurationen är giltig och använder default deny', () => {
  const report = AccessControl.validateConfig(config);
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(config.policy.defaultDecision, 'deny');
  assert.ok(report.summary.permissions >= 28);
  assert.ok(report.summary.roles >= 8);
  assert.equal(report.summary.workflows, 5);
});

test('alla roller med kritiska åtgärder kräver MFA', () => {
  const critical = new Set(config.permissions.filter(permission => permission.risk === 'critical').map(permission => permission.id));
  const required = new Set(config.policy.mfaRequiredRoles);
  const criticalRoles = config.roles.filter(role => role.permissions.some(permission => critical.has(permission)));
  assert.ok(criticalRoles.length > 0);
  for (const role of criticalRoles) assert.ok(required.has(role.id), `${role.id} har kritisk behörighet men saknar MFA-krav`);
});

test('en användare får unionen av sina roller men aldrig okända behörigheter', () => {
  const model = AccessControl.createModel(config);
  const actor = {id: 'user-1', roles: ['sales', 'inventory-manager']};
  const permissions = AccessControl.permissionsForActor(model, actor);
  assert.equal(permissions.has('customer-invoice.create'), true);
  assert.equal(permissions.has('inventory.manage'), true);
  assert.equal(permissions.has('payment.release'), false);
  assert.equal(AccessControl.authorize(model, actor, 'payment.release').allowed, false);
  assert.equal(AccessControl.authorize(model, actor, 'permission.does-not-exist').code, 'UNKNOWN_PERMISSION');
});

test('inaktiverade konton och okända roller nekas säkert', () => {
  const model = AccessControl.createModel(config);
  const disabled = AccessControl.authorize(model, {id: 'user-2', roles: ['accountant'], disabled: true}, 'accounting.post');
  assert.equal(disabled.allowed, false);
  assert.equal(disabled.code, 'ACCOUNT_DISABLED');
  const unknown = AccessControl.authorize(model, {id: 'user-3', roles: ['super-user']}, 'accounting.view');
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.code, 'UNKNOWN_ROLE');
  assert.throws(() => AccessControl.requirePermission(model, {id: 'user-4', roles: ['auditor']}, 'accounting.post'), error => error.code === 'ACCESS_DENIED');
});

test('leverantörsattest kräver både rätt roll och en annan person', () => {
  const model = AccessControl.createModel(config);
  const approver = {id: 'approver-1', roles: ['approver']};
  const samePerson = AccessControl.evaluateWorkflowAction(model, approver, 'supplier-invoice-approval', {registeredBy: 'approver-1',approvedBy: 'approver-1'});
  assert.equal(samePerson.allowed, false);
  assert.equal(samePerson.code, 'SEPARATION_OF_DUTIES_FAILED');
  const separated = AccessControl.evaluateWorkflowAction(model, approver, 'supplier-invoice-approval', {registeredBy: 'accountant-1',approvedBy: 'approver-1'});
  assert.equal(separated.allowed, true);
});

test('ändring av leverantörens betalningsuppgifter kräver separat godkännare', () => {
  const model = AccessControl.createModel(config);
  const approver = {id:'approver-2',roles:['approver']};
  const denied = AccessControl.evaluateWorkflowAction(model,approver,'supplier-bank-change',{requestedBy:'approver-2',approvedBy:'approver-2'});
  assert.equal(denied.allowed,false);
  assert.equal(denied.code,'SEPARATION_OF_DUTIES_FAILED');
  const allowed = AccessControl.evaluateWorkflowAction(model,approver,'supplier-bank-change',{requestedBy:'accountant-2',approvedBy:'approver-2'});
  assert.equal(allowed.allowed,true);
});

test('felaktiga roller, dubbletter, fältnycklar och okända behörigheter stoppas vid start', () => {
  const broken = structuredClone(config);
  broken.permissions.push({...broken.permissions[0]});
  broken.roles[0].permissions.push('unknown.permission');
  broken.policy.mfaRequiredRoles.push('missing-role');
  broken.workflows[0].fields[0].id = 'registered by';
  const report = AccessControl.validateConfig(broken);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => /Dubblerad behörighet/.test(error)));
  assert.ok(report.errors.some(error => /okänd behörighet/.test(error)));
  assert.ok(report.errors.some(error => /okänd roll/.test(error)));
  assert.ok(report.errors.some(error => /fields\[0\]\.id har ogiltigt format/.test(error)));
  assert.throws(() => AccessControl.createModel(broken), error => error.code === 'INVALID_ACCESS_CONFIG');
});
