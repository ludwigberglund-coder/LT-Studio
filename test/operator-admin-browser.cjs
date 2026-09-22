'use strict';

const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createServer}=require('../apps/api/server.js');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');

const MFA_SECRET='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const ENCRYPTION_KEY='operator-browser-test-encryption-key-longer-than-32-chars';
const out=path.join(__dirname,'..','test-artifacts');

(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const runtime=createServer({databasePath:':memory:',db:Db.openDatabase(':memory:'),secureCookies:false,authEncryptionKey:ENCRYPTION_KEY});
  let browser,page;
  const checks=[];
  try{
    Db.createPlatformOperator(runtime.db,{
      username:'lt.browser',
      displayName:'LT Browser Operator',
      passwordHash:Auth.hashPassword('Browser operator testlosenord 2026!'),
      mfaSecretEncrypted:Auth.encryptSecret(MFA_SECRET,ENCRYPTION_KEY)
    });
    const company=Db.createCompany(runtime.db,{legalName:'Browser Kund AB',displayName:'Browser Kund',orgNumber:'559900-9201'});
    const customer=Db.createCustomer(runtime.db,{companyId:company.id,customerNumber:'SECRET-BROWSER-CUSTOMER',name:'Hemlig Browserkund'});
    Db.createInvoice(runtime.db,{companyId:company.id,customerId:customer.id,invoiceNumber:'SECRET-BROWSER-INVOICE',invoiceDate:'2026-09-21',postingDate:'2026-09-21',dueDate:'2026-10-21',totalOre:333300,remainingOre:333300,vatOre:66660,status:'Bokförd'});
    Db.appendSecurityEvent(runtime.db,{kind:'LOGIN_FAILURE_THRESHOLD',severity:'warning',fingerprintHash:'c'.repeat(64),details:{private:'never-in-ui'}});

    await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${runtime.server.address().port}`;

    browser=await chromium.launch({headless:true});
    page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});

    await page.goto(base+'/operator/',{waitUntil:'networkidle'});
    await page.getByRole('heading',{name:'Operatörsinloggning'}).waitFor();
    assert.equal(await page.locator('input[name="username"]').count(),1);
    assert.equal(await page.locator('input[name="password"]').count(),1);
    assert.equal(await page.locator('input[name="totp"]').count(),1);
    checks.push({kind:'login-page'});

    await page.locator('input[name="username"]').fill('lt.browser');
    await page.locator('input[name="password"]').fill('Browser operator testlosenord 2026!');
    await page.locator('input[name="totp"]').fill(Auth.totpCode(MFA_SECRET,Date.now()));
    await page.getByRole('button',{name:'Logga in',exact:true}).click();

    await page.getByRole('heading',{name:'Plattformsöversikt',exact:true}).waitFor({timeout:15000});
    const body=await page.locator('body').innerText();
    assert.match(body,/Browser Kund/);
    assert.match(body,/Säkerhet 24 h/i);
    assert.match(body,/Hälsokontroller/);
    assert.match(body,/Databas · läsning/);
    assert.match(body,/Extern monitoring/);
    assert.match(body,/Audit · externt ankare/);
    assert.match(body,/Många felaktiga kundinloggningar/);
    assert.doesNotMatch(body,/Hemlig Browserkund|SECRET-BROWSER-CUSTOMER|SECRET-BROWSER-INVOICE|333300|66660|never-in-ui|cccccccc/);
    checks.push({kind:'overview',company:'Browser Kund'});

    await page.getByRole('button',{name:'Uppdatera',exact:true}).click();
    await page.getByRole('heading',{name:'Kundmiljöer',exact:true}).waitFor();
    checks.push({kind:'refresh'});

    await page.getByRole('button',{name:'Hantera användare',exact:true}).click();
    await page.getByRole('heading',{name:/Användare · Browser Kund/}).waitFor();
    assert.match(await page.locator('#user-admin-panel').innerText(),/Endast LT Studio-operatörer/);
    await page.locator('#create-user-form input[name="displayName"]').fill('Kund Användare');
    await page.locator('#create-user-form input[name="username"]').fill('kund.browser');
    await page.locator('#create-user-form input[name="password"]').fill('Kundtest1!');
    await page.locator('#create-user-form select[name="role"]').selectOption('readonly');
    await page.getByRole('button',{name:'Skapa konto',exact:true}).click();
    await page.getByText(/MFA-hemlighet \(visas bara nu\):/).waitFor();
    const created=Db.userByUsername(runtime.db,'kund.browser');
    assert.ok(created);
    assert.equal(Db.membership(runtime.db,company.id,created.id).role,'readonly');
    checks.push({kind:'create-customer-user'});

    await page.locator('select[data-user-role="'+created.id+'"]').selectOption('accountant');
    await page.getByText(/Rollen ändrades/).waitFor();
    assert.equal(Db.membership(runtime.db,company.id,created.id).role,'accountant');
    checks.push({kind:'change-customer-role'});

    page.once('dialog',async dialog=>{assert.equal(dialog.type(),'prompt');await dialog.accept('Nyttlosen1!')});
    await page.locator('button[data-action="reset-password"][data-user-id="'+created.id+'"]').click();
    await page.getByText(/Lösenordet byttes/).waitFor();
    assert.equal(Auth.verifyPassword('Nyttlosen1!',Db.userById(runtime.db,created.id).passwordHash),true);
    checks.push({kind:'reset-customer-password'});

    page.once('dialog',async dialog=>{assert.equal(dialog.type(),'confirm');await dialog.accept()});
    await page.locator('button[data-action="toggle-user"][data-user-id="'+created.id+'"]').click();
    await page.getByText(/Användaren inaktiverades/).waitFor();
    assert.equal(Db.userById(runtime.db,created.id).disabled,true);
    checks.push({kind:'disable-customer-user'});

    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.getByRole('heading',{name:'Plattformsöversikt',exact:true}).count(),1);
    checks.push({kind:'mobile-layout'});

    await page.getByRole('button',{name:'Logga ut',exact:true}).click();
    await page.getByRole('heading',{name:'Operatörsinloggning'}).waitFor();
    const session=await page.evaluate(()=>fetch('/api/operator/v1/session',{credentials:'same-origin'}).then(r=>r.json()));
    assert.equal(session.authenticated,false);
    assert.deepEqual(errors,[]);
    checks.push({kind:'logout'});

    fs.writeFileSync(path.join(out,'operator-admin-results.json'),JSON.stringify({ok:true,checks,errors},null,2));
    console.log(`Operator admin browser checks passed: ${checks.length} checks.`);
  }catch(error){
    fs.writeFileSync(path.join(out,'operator-admin-results.json'),JSON.stringify({ok:false,checks,failure:error.stack},null,2));
    if(page)await page.screenshot({path:path.join(out,'operator-admin-failure.png'),fullPage:true}).catch(()=>{});
    throw error;
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>runtime.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
