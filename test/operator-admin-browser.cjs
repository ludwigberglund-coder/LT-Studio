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
    const secondCompany=Db.createCompany(runtime.db,{legalName:'Annan Kund AB',displayName:'Annan Kund',orgNumber:'559900-9202'});
    const customerUser=Db.createUser(runtime.db,{username:'browser.user',displayName:'Browser Användare',passwordHash:Auth.hashPassword('Browser kundlosenord 2026!')});
    Db.addMembership(runtime.db,{companyId:company.id,userId:customerUser.id,role:'readonly'});
    const sharedPassword='Delat konto losenord 2026!';
    const sharedMfaEncrypted=Auth.encryptSecret(MFA_SECRET,ENCRYPTION_KEY);
    const sharedUser=Db.createUser(runtime.db,{username:'shared.user',displayName:'Delad Användare',passwordHash:Auth.hashPassword(sharedPassword),mfaSecretEncrypted:sharedMfaEncrypted});
    Db.addMembership(runtime.db,{companyId:secondCompany.id,userId:sharedUser.id,role:'accountant'});
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
    await page.getByRole('heading',{name:'LT Studio-inloggning'}).waitFor();
    assert.equal(await page.locator('input[name="username"]').count(),1);
    assert.equal(await page.locator('input[name="password"]').count(),1);
    assert.equal(await page.locator('input[name="totp"]').count(),1);
    checks.push({kind:'login-page'});

    await page.locator('input[name="username"]').fill('lt.browser');
    await page.locator('input[name="password"]').fill('Browser operator testlosenord 2026!');
    await page.locator('input[name="totp"]').fill(Auth.totpCode(MFA_SECRET,Date.now()));
    await page.getByRole('button',{name:'Logga in',exact:true}).click();

    await page.getByRole('heading',{name:'Adminöversikt',exact:true}).waitFor({timeout:15000});
    const body=await page.locator('body').innerText();
    assert.match(body,/Browser Kund/);
    assert.match(body,/Säkerhet 24 h/i);
    assert.match(body,/Hälsokontroller/);
    assert.match(body,/Databas · läsning/);
    assert.match(body,/LT Studio global admin/);
    assert.match(body,/Extern monitoring/);
    assert.match(body,/Audit · externt ankare/);
    assert.doesNotMatch(body,/Hemlig Browserkund|SECRET-BROWSER-CUSTOMER|SECRET-BROWSER-INVOICE|333300|66660|never-in-ui|cccccccc/);
    assert.match(body,/Plattformsaktivitet|Aktiveringsgrad|Fakturor per företag/);
    assert.ok(await page.locator('.ring-value').count()>=3);
    assert.ok(await page.locator('meter').count()>=2);
    checks.push({kind:'overview',company:'Browser Kund',visualInstruments:true});

    await page.getByRole('button',{name:'Statistik',exact:true}).first().click();
    await page.getByRole('heading',{name:'Statistik',exact:true}).waitFor();
    assert.equal(await page.locator('.chart-card').count(),4);
    assert.ok(await page.locator('.sparkline').count()>=4);
    assert.match(await page.locator('body').innerText(),/Fakturavolym|Behörighetsfördelning|Aktivering/);
    checks.push({kind:'statistics-dashboard',trendCharts:4});

    await page.getByRole('button',{name:'Säkerhetsportal',exact:true}).first().click();
    await page.getByRole('heading',{name:'Säkerhetsportal',exact:true}).waitFor();
    const securityBody=await page.locator('body').innerText();
    assert.match(securityBody,/Många felaktiga kundinloggningar/);
    assert.doesNotMatch(securityBody,/LOGIN FAILURE THRESHOLD|never-in-ui|cccccccc/);
    checks.push({kind:'security-preview'});

    await page.getByRole('button',{name:'Kunder & företag',exact:true}).first().click();
    await page.getByRole('heading',{name:'Kunder & företag',exact:true}).waitFor();
    const companyRow=page.locator('[data-company-id="'+company.id+'"]');
    await companyRow.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading',{name:'Företagsadmin',exact:true}).waitFor();
    assert.match(await page.locator('body').innerText(),/Användare & behörigheter|Lägg till användare/);
    assert.equal(await page.locator('#add-user-form select[name="role"]').inputValue(),'readonly');
    checks.push({kind:'company-admin-keyboard',company:'Browser Kund',safeDefaultRole:'readonly'});

    await page.locator('#add-user-form input[name="username"]').fill('shared.user');
    await page.locator('#add-user-form input[name="displayName"]').fill('Ska inte ersätta namn');
    await page.locator('#add-user-form input[name="password"]').fill('SkaInteErsatta1!');
    await page.getByRole('button',{name:'Skapa eller koppla användare',exact:true}).click();
    await page.getByText(/Befintligt konto kopplades/).waitFor();
    const sharedAfter=Db.userById(runtime.db,sharedUser.id);
    assert.equal(Db.membership(runtime.db,company.id,sharedUser.id).role,'readonly');
    assert.equal(sharedAfter.displayName,'Delad Användare');
    assert.equal(Auth.verifyPassword(sharedPassword,sharedAfter.passwordHash),true);
    assert.equal(Auth.verifyPassword('SkaInteErsatta1!',sharedAfter.passwordHash),false);
    assert.equal(sharedAfter.mfaSecretEncrypted,sharedMfaEncrypted);
    assert.equal(await page.locator('#mfa-result code').count(),0);
    checks.push({kind:'existing-user-linked-to-second-company'});

    const roleSelect=page.locator('select[data-role-user="'+customerUser.id+'"]');
    await roleSelect.selectOption('accountant');
    await page.getByText(/Behörigheten uppdaterades/).waitFor();
    assert.equal(Db.membership(runtime.db,company.id,customerUser.id).role,'accountant');
    checks.push({kind:'role-change-feedback'});

    await page.getByRole('button',{name:'Byt lösenord',exact:true}).click();
    await page.getByRole('heading',{name:'Byt lösenord',exact:true}).waitFor();
    assert.equal(await page.locator('.modal-card').count(),1);
    const passwordInput=page.locator('#reset-password-form input[name="password"]');
    await passwordInput.click();
    assert.equal(await page.locator('.modal-card').count(),1);
    await passwordInput.fill('NyttBrowser1!');
    await page.getByRole('button',{name:'Spara nytt lösenord',exact:true}).click();
    await page.getByText(/Lösenordet ändrades/).waitFor();
    assert.equal(Auth.verifyPassword('NyttBrowser1!',Db.userById(runtime.db,customerUser.id).passwordHash),true);
    checks.push({kind:'password-modal-reset'});

    await page.getByRole('button',{name:'Ta bort åtkomst',exact:true}).click();
    await page.getByRole('heading',{name:'Ta bort åtkomst?',exact:true}).waitFor();
    assert.equal(await page.locator('.modal-card').count(),1);
    await page.getByRole('button',{name:'Avbryt',exact:true}).click();
    checks.push({kind:'remove-access-modal'});

    await page.getByRole('button',{name:'← Alla företag',exact:true}).click();
    await page.getByRole('heading',{name:'Kunder & företag',exact:true}).waitFor();
    const companySearch=page.locator('[data-company-search]');
    await companySearch.fill('saknas-helt');
    await page.getByText('Inga företag matchar filtret.').waitFor();
    await companySearch.fill('Browser Kund');
    assert.equal(await page.locator('[data-company-id="'+company.id+'"]').count(),1);
    await page.locator('[data-company-filter]').selectOption('unconfigured');
    await page.getByText('Inga företag matchar filtret.').waitFor();
    await page.locator('[data-company-filter]').selectOption('all');
    await page.locator('[data-company-sort]').selectOption('invoices');
    assert.equal(await page.locator('[data-company-id="'+company.id+'"]').count(),1);
    checks.push({kind:'company-filter-and-sort'});

    await page.getByRole('button',{name:'Uppdatera',exact:true}).click();
    checks.push({kind:'refresh'});

    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.getByRole('heading',{name:'Kunder & företag',exact:true}).count(),1);
    const mobileNav=page.locator('.mobile-nav');
    await mobileNav.waitFor({state:'visible'});
    assert.equal(await mobileNav.getByRole('button',{name:'Statistik',exact:true}).count(),1);
    checks.push({kind:'mobile-navigation'});

    await page.getByRole('button',{name:'Logga ut',exact:true}).click();
    await page.getByRole('heading',{name:'LT Studio-inloggning'}).waitFor();
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
