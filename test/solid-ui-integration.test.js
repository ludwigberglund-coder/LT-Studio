'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildStatic}=require('../scripts/build-static.js');
const root=path.resolve(__dirname,'..');

test('static build does not ship or inject Liquid Glass on any workspace',()=>{
  const dist=buildStatic();
  assert.equal(fs.existsSync(path.join(dist,'shared','liquid-glass.css')),false);
  const source=fs.readFileSync(path.join(root,'scripts','build-static.js'),'utf8');
  assert.doesNotMatch(source,/installLiquidGlass|data-lt-glass-surface/);
  for(const route of ['index.html','portal/dashboard.html','portal/invoices.html',
    'portal/payments.html','portal/unplaced-payments.html','portal/batches.html',
    'operator/index.html','legacy/index.html','admin/index.html','uat/index.html']){
    const html=fs.readFileSync(path.join(dist,route),'utf8');
    assert.doesNotMatch(html,/liquid-glass\.css|data-lt-glass-surface/,route);
  }
});
test('active UI uses solid panels instead of frosted material',()=>{
  for(const file of ['apps/portal/design-system.css','apps/portal/dashboard.css',
    'apps/portal/shared-nav.css','apps/operator/premium-ui.css',
    'apps/operator/styles.css','apps/operator/design-system.css',
    'apps/website/styles.css','apps/website/design-system.css']){
    const css=fs.readFileSync(path.join(root,file),'utf8');
    assert.doesNotMatch(css,/\bbackdrop-filter\s*:/,file+' still blurs its material');
    assert.doesNotMatch(css,/--lt-(?:apple|shell)-glass|data-lt-glass-surface/,file);
  }
  const portal=fs.readFileSync(path.join(root,'apps/portal/design-system.css'),'utf8');
  assert.match(portal,/--lt-apple-panel:var\(--surface-card\)/);
  assert.match(portal,/--lt-apple-panel:var\(--lt-dark-surface\)/);
  const operator=fs.readFileSync(path.join(root,'apps/operator/premium-ui.css'),'utf8');
  assert.match(operator,/--operator-panel:#ffffff/);
  assert.match(operator,/--operator-panel:#172731/);
});
