'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../apps/portal/supplier-workspace.css'), 'utf8');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

test('supplier queue choices stay compact without fixed heights or a long one-column phone list', () => {
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /min-height:\s*72px/);
  assert.doesNotMatch(css, /min-height:\s*(110|132|150)px/);
  assert.doesNotMatch(css, /grid-template-columns:\s*1fr\s*;/);
  const card = rules.find(([, selector]) => selector.trim() === '.payables-shell .supplier-task-card');
  assert.ok(card);
  assert.doesNotMatch(card[2], /(?:^|;)\s*height\s*:/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test('only duplicate decorative headings use display none; warnings and actions remain visible', () => {
  const hidden = rules.filter(([, , body]) => /display:\s*none/.test(body));
  assert.equal(hidden.length, 1);
  const selectors = hidden[0][1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(s => s.trim());
  assert.deepEqual(selectors, [
    '.payables-shell .supplier-queue .queue-head .eyebrow',
    '.payables-shell .invoice-next-step-top',
    '.payables-shell .payables-grid .coding-panel .panel-head .eyebrow'
  ]);
  assert.doesNotMatch(hidden[0][1], /coding-actions|coding-table|notice|alert|invoice-next-step-check|supplier-queue-scope/);
});

test('secondary descriptions remain accessible while task names and totals stay visible', () => {
  const help = rules.find(([, selector]) => selector.trim().endsWith('.supplier-task-card small'));
  assert.ok(help);
  assert.match(help[2], /clip-path:\s*inset\(50%\)/);
  assert.doesNotMatch(help[2], /display:\s*none|visibility:\s*hidden/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /font-size:\s*16px/);
  assert.match(css, /data-lt-theme="dark"/);
});

// The canonical theme loads last and has important segmented-control rules.
test('component size and selected state survive the last-loaded shared theme', () => {
  assert.match(css, /min-height:\s*72px\s*!important/);
  assert.match(css, /border:\s*2px solid var\(--supplier-accent\)\s*!important/);
  assert.match(css, /font-size:\s*16px\s*!important/);
  assert.match(css, /border:\s*0\s*!important/);
});
