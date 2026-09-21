'use strict';

const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createServer}=require('../apps/api/server.js');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');

const out=path.join(__dirname,'..','test-artifacts');

(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const db=Db.openDatabase(':memory:');
  const runtime=createServer({databasePath:':memory:',db,secureCookies:false});
  let browser,page;
  const checks=[];
  try{
    const company=Db.createCompany(db,{legalName:'Opening UI AB',displayName:'Opening UI',orgNumber:'559970-1001'});
    const user=Db.createUser(db,{username:'opening.ui',displayName:'Opening UI User',passwordHash:'test-only'});
    Db.addMembership(db,{companyId:company.id,userId:user.id});
    const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
    Db.createSession(db,{
      tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,
      expiresAt:new Date(Date.now()+60*60*1000).toISOString(),
      absoluteExpiresAt:new Date(Date.now()+2*60*60*1000).toISOString()
    });

    await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${runtime.server.address().port}`;

    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:1100}});
    await context.addCookies([{name:'rollands_session',value:token,url:base}]);
    page=await context.newPage();
    await page.addInitScript(value=>sessionStorage.setItem('rollands-csrf',value),csrf);
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});

    await page.goto(base+'/portal/accounting.html',{waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'Importera startsaldo'}).waitFor({timeout:15000});
    assert.match(await page.locator('.opening-panel').innerText(),/1510 och 2440/);
    checks.push({kind:'opening-form-visible'});

    const rows=page.locator('.opening-line-row');
    assert.equal(await rows.count(),2);
    await rows.nth(0).locator('[data-opening="account"]').fill('1510');
    await rows.nth(0).locator('[data-opening="text"]').fill('Kundfordringar totalsaldo');
    await rows.nth(0).locator('[data-opening="debit"]').fill('1000,00');
    await rows.nth(1).locator('[data-opening="account"]').fill('2091');
    await rows.nth(1).locator('[data-opening="text"]').fill('Eget kapital');
    await rows.nth(1).locator('[data-opening="credit"]').fill('1000,00');
    await page.locator('#opening-balance-form input[name="confirm"]').check();
    await page.getByRole('button',{name:'Importera ingående balans'}).click();
    await page.locator('#opening-balance-form .form-error').waitFor();
    assert.match(await page.locator('#opening-balance-form .form-error').innerText(),/1510.*reskontraunderlag/i);
    assert.equal(Accounting.listEntries(db,company.id).length,0);
    checks.push({kind:'subledger-account-blocked'});

    await rows.nth(0).locator('[data-opening="account"]').fill('1930');
    await rows.nth(0).locator('[data-opening="text"]').fill('Bank');
    await page.getByRole('button',{name:'Importera ingående balans'}).click();

    await page.getByRole('heading',{name:/IB1 · 2026/}).waitFor({timeout:15000});
    const entry=Accounting.listEntries(db,company.id)[0];
    assert.equal(entry.number,'IB1');
    assert.equal(entry.sourceType,'opening-balance');
    checks.push({kind:'opening-import-created',entry:entry.number});

    const ibRow=page.locator('[data-entry]').filter({hasText:'IB1'});
    await ibRow.click();
    assert.equal(await page.locator('#correction-form').count(),0);
    assert.match(await page.locator('.entry-detail').innerText(),/rättas inte genom det generella rättelseflödet/i);
    checks.push({kind:'generic-correction-hidden'});

    const response=await page.evaluate(()=>fetch('/api/v1/accounting/opening-balances/2026',{credentials:'same-origin'}).then(async r=>({status:r.status,body:await r.json()})));
    assert.equal(response.status,200);
    assert.equal(response.body.entry.number,'IB1');
    assert.deepEqual(errors,[]);
    checks.push({kind:'api-readback'});

    fs.writeFileSync(path.join(out,'opening-balance-browser-results.json'),JSON.stringify({ok:true,checks,errors},null,2));
    console.log(`Opening balance browser checks passed: ${checks.length} checks.`);
  }catch(error){
    fs.writeFileSync(path.join(out,'opening-balance-browser-results.json'),JSON.stringify({ok:false,checks,failure:error.stack},null,2));
    if(page)await page.screenshot({path:path.join(out,'opening-balance-browser-failure.png'),fullPage:true}).catch(()=>{});
    throw error;
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>runtime.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
