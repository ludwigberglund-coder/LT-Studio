'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createServer,resolveStaticRequest}=require('../apps/api/server.js');

test('pilotservern serverar portal, nödvändig konfiguration och shared-filer men inte godtyckliga repositoryfiler',async()=>{
  const runtime=createServer({databasePath:':memory:',secureCookies:false});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  try {
    const root=await fetch(base+'/',{redirect:'manual'});
    assert.equal(root.status,302);
    assert.equal(root.headers.get('location'),'/portal/index.html');
    const operator=await fetch(base+'/operator/',{redirect:'manual'});assert.equal(operator.status,302);assert.equal(operator.headers.get('location'),'/operator/index.html');
    const operatorPage=await fetch(base+'/operator/index.html');assert.equal(operatorPage.status,200);assert.match(await operatorPage.text(),/Driftadmin/);
    const reports=await fetch(base+'/portal/reports.html');
    assert.equal(reports.status,200);
    assert.match(reports.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.match(await reports.text(),/Rapporter/);
    const legalRates=await fetch(base+'/config/legal-rates.json');
    assert.equal(legalRates.status,200);
    assert.match(legalRates.headers.get('content-type'),/application\/json/);
    const rates=await legalRates.json();
    assert.equal(rates.currency,'SEK');
    assert.equal(rates.interestActMarginBasisPoints,800);
    assert.ok(Array.isArray(rates.referenceRates));
    assert.ok(rates.referenceRates.length>0);
    const shared=await fetch(base+'/shared/accounting/money.js');
    assert.equal(shared.status,200);
    const secret=await fetch(base+'/package.json');
    assert.equal(secret.status,404);
    const traversal=await fetch(base+'/portal/%2e%2e/%2e%2e/package.json');
    assert.equal(traversal.status,404);
  } finally { await new Promise(resolve=>runtime.close(resolve)); }
});

test('statisk resolver tillåter endast uttryckligt publicerade rötter',()=>{
  assert.ok(resolveStaticRequest('/portal/reports.js')?.file.endsWith('apps/portal/reports.js'));
  assert.ok(resolveStaticRequest('/operator/app.js')?.file.endsWith('apps/operator/app.js'));
  assert.ok(resolveStaticRequest('/config/legal-rates.json')?.file.endsWith('config/legal-rates.json'));
  assert.ok(resolveStaticRequest('/shared/accounting/money.js')?.file.endsWith('packages/accounting/money.js'));
  assert.equal(resolveStaticRequest('/portal/../../package.json'),null);
  assert.equal(resolveStaticRequest('/apps/api/server.js'),null);
  assert.equal(resolveStaticRequest('/operator/../package.json'),null);
});
