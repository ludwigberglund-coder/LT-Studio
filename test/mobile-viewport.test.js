'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const load = file => fs.readFileSync(path.join(root, file), 'utf8');

test('customer and operator portals keep a device-width viewport without blocking pinch zoom', () => {
  for (const htmlPath of ['apps/portal/index.html', 'apps/portal/dashboard.html', 'apps/portal/accounting.html', 'apps/operator/index.html']) {
    const html = load(htmlPath);
    assert.match(html, /<meta name="viewport" content="width=device-width,\s*initial-scale=1">/, htmlPath);
    assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i, htmlPath);
  }
});

test('all customer-portal pages get the shared mobile layout and iOS form-focus fix', () => {
  const css = load('apps/portal/design-system.css');
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /\.shared-workspace-shell\s*\.topbar/);
  assert.match(css, /\.dashboard-content/);
  assert.match(css, /\.accounting-content/);
  assert.match(css, /\.table-scroll/);
  assert.match(css, /\.journal-scroll/);
  assert.match(css, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
  assert.match(css, /font-size:\s*16px\s*!important/);
  assert.match(css, /overflow-x:\s*auto/);
});

test('operator also fits narrow phones without iOS automatic focus zoom', () => {
  const css = load('apps/operator/premium-ui.css');
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /\.operator-shell\s+\.main/);
  assert.match(css, /\.operator-shell\s+\.topbar/);
  assert.match(css, /\.login-shell/);
  assert.match(css, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
  assert.match(css, /font-size:\s*16px\s*!important/);
  assert.match(css, /overflow-x:\s*auto/);
});

test('mobile overrides load after standard styles in each workspace', () => {
  const portal = load('apps/portal/index.html');
  const operator = load('apps/operator/index.html');
  assert.ok(portal.indexOf('styles.css') < portal.indexOf('design-system.css'));
  assert.ok(operator.indexOf('design-system.css') < operator.indexOf('premium-ui.css'));
});
