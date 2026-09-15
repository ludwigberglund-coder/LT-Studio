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
    decisions: read('config/rolands-business-decisions.json')
  };
}

test('innehållsfilerna är giltiga och verksamhetsbesluten matchar företaget', () => {
  const report = validateContent();
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.summary.services, 3);
  assert.ok(report.summary.adminModules >= 6);
});

test('innehållskontrollen stoppar dubblerad navigation och felaktigt organisationsnummer', () => {
  const data = fixture();
  data.company.orgNumber = 'fel';
  data.site.navigation.push({...data.site.navigation[0]});
  const errors = validate(data.company, data.site, data.admin, data.decisions);
  assert.ok(errors.some(error => /orgNumber/.test(error)));
  assert.ok(errors.some(error => /dubblerad navigationslänk/.test(error)));
});

test('statisk byggnad innehåller ny webbplats, projektadmin, öresdomän, delat innehåll och tidigare demo', () => {
  const target = buildStatic();
  for (const relativePath of [
    'index.html', 'app.js', 'styles.css',
    'admin/index.html', 'admin/app.js', 'admin/money-view.js', 'admin/money.css',
    'shared/content.js', 'shared/accounting/money.js',
    'content/site.json', 'content/company.json',
    'config/rolands-business-decisions.json', 'legacy/index.html', '.nojekyll'
  ]) assert.equal(fs.existsSync(path.join(target, relativePath)), true, `${relativePath} saknas`);
  assert.equal(fs.existsSync(path.join(target, 'store.json')), false);
});
