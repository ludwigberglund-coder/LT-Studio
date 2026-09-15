'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {validate, validateContent} = require('../scripts/validate-content.js');
const {buildStatic} = require('../scripts/build-static.js');

const root = path.resolve(__dirname, '..');

function fixture() {
  const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  return {
    company: read('content/company.json'),
    site: read('content/site.json'),
    admin: read('content/admin.json'),
    decisions: read('config/rolands-business-decisions.json'),
    access: read('config/access-control.json')
  };
}

test('innehållsfilerna är giltiga och verksamhetsbesluten matchar företaget', () => {
  const report = validateContent();
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.summary.services, 3);
  assert.ok(report.summary.adminModules >= 7);
  assert.ok(report.summary.accessRoles >= 8);
  assert.equal(report.summary.separationWorkflows, 4);
});

test('innehållskontrollen stoppar dubblerad navigation och felaktigt organisationsnummer', () => {
  const data = fixture();
  data.company.orgNumber = 'fel';
  data.site.navigation.push({...data.site.navigation[0]});
  const errors = validate(data.company, data.site, data.admin, data.decisions, data.access);
  assert.ok(errors.some(error => /orgNumber/.test(error)));
  assert.ok(errors.some(error => /dubblerad navigationslänk/.test(error)));
});

test('statisk byggnad innehåller webbplats, projektadmin, företagsportal, domänkärnor och tidigare demo', () => {
  const target = buildStatic();
  for (const relativePath of [
    'index.html', 'app.js', 'styles.css',
    'admin/index.html', 'admin/app.js', 'admin/money-view.js', 'admin/money.css',
    'admin/access-view.js', 'admin/access.css', 'admin/journal-view.js', 'admin/journal.css',
    'portal/index.html', 'portal/app.js', 'portal/styles.css',
    'shared/content.js', 'shared/accounting/money.js', 'shared/accounting/journal.js',
    'shared/access-control/authorization.js', 'shared/receivables/customer-receivables.js',
    'content/site.json', 'content/company.json', 'content/admin.json',
    'config/rolands-business-decisions.json', 'config/access-control.json', 'config/legal-rates.json',
    'legacy/index.html', '.nojekyll'
  ]) assert.equal(fs.existsSync(path.join(target, relativePath)), true, `${relativePath} saknas`);
  assert.equal(fs.existsSync(path.join(target, 'store.json')), false);
  assert.equal(fs.existsSync(path.join(target, 'platform.sqlite')), false);
});
