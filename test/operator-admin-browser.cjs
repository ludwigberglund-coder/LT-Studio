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
    const operator=Db.createPlatformOperator(runtime.db,{
      username:'lt.browser',
      displayName:'LT Browser Operator',
      passwordHash:Auth.hashPassword('Browser operator testlosenord 2026!'),
      mfaSecretEncrypted:Auth.encryptSecret(MFA_SECRET,ENCRYPTION_KEY)
    });
    const company=Db.createCompany(runtime.db,{legalName:'Browser Kund AB',displayName:'Browser Kund',orgNumber:'559900-9201'});
    const secondCompany=Db.createCompany(runtime.db,{legalName:'Annan Kund AB',displayName:'Annan Kund',orgNumber:'559900-9202'});
    const globalAdminUser=Db.createUser(runtime.db,{
      username:'global.admin',
      displayName:'LT Global Admin',
      passwordHash:Auth.hashPassword('Global admin testlosenord 2026!'),
      mfaSecretEncrypted:Auth.encryptSecret(MFA_SECRET,ENCRYPTION_KEY),
      platformAdmin:true
    });
    Db.addMembership(runtime.db,{companyId:company.id,userId:globalAdminUser.id,role:'readonly'});
    const customerUser=Db.createUser(runtime.db,{username:'browser.user',displayName:'Browser Användare',passwordHash:Auth.hashPassword('Browser kundlosenord 2026!')});
    Db.addMembership(runtime.db,{companyId:company.id,userId:customerUser.id,role:'readonly'});
    const sharedPassword='Delat konto losenord 2026!';
    const sharedMfaEncrypted=Auth.encryptSecret(MFA_SECRET,ENCRYPTION_KEY);
    const sharedUser=Db.createUser(runtime.db,{username:'shared.user',displayName:'Delad Användare',passwordHash:Auth.hashPassword(sharedPassword),mfaSecretEncrypted:sharedMfaEncrypted});
    Db.addMembership(runtime.db,{companyId:secondCompany.id,userId:sharedUser.id,role:'accountant'});
    const customer=Db.createCustomer(runtime.db,{companyId:company.id,customerNumber:'SECRET-BROWSER-CUSTOMER',name:'Hemlig Browserkund'});
    Db.createInvoice(runtime.db,{companyId:company.id,customerId:customer.id,invoiceNumber:'SECRET-BROWSER-INVOICE',invoiceDate:'2026-09-21',postingDate:'2026-09-21',dueDate:'2026-10-21',totalOre:333300,remainingOre:333300,vatOre:66660,status:'Bokförd'});
    Db.appendSecurityEvent(runtime.db,{kind:'LOGIN_FAILURE_THRESHOLD',severity:'warning',fingerprintHash:'c'.repeat(64),details:{private:'never-in-ui',companyId:company.id}});
    Db.appendSecurityEvent(runtime.db,{kind:'OPERATOR_LOGIN_FAILURE_THRESHOLD',severity:'critical',fingerprintHash:'d'.repeat(64),details:{private:'never-in-ui-either'}});
    Db.appendPlatformOperatorAudit(runtime.db,{operatorId:operator.id,action:'CUSTOMER_USER_ROLE_CHANGED',details:{companyId:company.id,userId:customerUser.id,before:'readonly',after:'accountant',private:'never-in-ui-audit'}});

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

    const auditProbe=await page.evaluate(async()=>{
      const response=await fetch('/api/operator/v1/operator-audit?limit=100',{credentials:'same-origin'});
      const body=await response.json().catch(()=>({}));
      return {status:response.status,body};
    });
    assert.equal(auditProbe.status,200,JSON.stringify(auditProbe.body));
    assert.ok(Array.isArray(auditProbe.body.events));
    checks.push({kind:'operator-audit-api-browser',eventCount:auditProbe.body.events.length});

    await page.getByRole('button',{name:'Säkerhetsportal',exact:true}).first().click();
    await page.getByRole('heading',{name:'Säkerhetsportal',exact:true}).waitFor();
    let securityBody=await page.locator('body').innerText();
    assert.match(securityBody,/Många felaktiga kundinloggningar/);
    assert.match(securityBody,/Browser Kund/);
    assert.match(securityBody,/Administratörslogg/);
    assert.match(securityBody,/Behörighet ändrades/);
    assert.match(securityBody,/Läsbehörighet → Ekonom/);
    assert.match(await page.locator('.security-check-table thead').textContent(),/Senaste bevis/);
    assert.doesNotMatch(securityBody,/LOGIN FAILURE THRESHOLD|never-in-ui|never-in-ui-either|never-in-ui-audit|cccccccc|dddddddd/);

    const severityFilter=page.locator('[data-security-severity]');
    await severityFilter.selectOption('critical');
    securityBody=await page.locator('body').innerText();
    assert.match(securityBody,/Många felaktiga LT Studio-admininloggningar/);
    assert.doesNotMatch(securityBody,/Många felaktiga kundinloggningar/);

    await severityFilter.selectOption('all');
    const companyFilter=page.locator('[data-security-company]');
    await companyFilter.selectOption(company.id);
    securityBody=await page.locator('body').innerText();
    assert.match(securityBody,/Många felaktiga kundinloggningar/);
    assert.doesNotMatch(securityBody,/Många felaktiga LT Studio-admininloggningar/);

    await companyFilter.selectOption('platform');
    securityBody=await page.locator('body').innerText();
    assert.match(securityBody,/Många felaktiga LT Studio-admininloggningar/);
    assert.doesNotMatch(securityBody,/Många felaktiga kundinloggningar/);

    await page.locator('[data-security-period]').selectOption('all');
    assert.equal(await page.locator('.security-check-table').count(),1);
    checks.push({kind:'security-portal-filters-and-audit',companyCorrelation:true,operatorAudit:true,evidenceAgeColumn:true});

    await page.getByRole('button',{name:'Kunder & företag',exact:true}).first().click();
    await page.getByRole('heading',{name:'Kunder & företag',exact:true}).waitFor();
    const companyRow=page.locator('[data-company-id="'+company.id+'"]');
    await companyRow.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading',{name:'Företagsadmin',exact:true}).waitFor();
    assert.match(await page.locator('body').innerText(),/Användare & behörigheter|Lägg till användare/);
    assert.equal(await page.locator('#add-user-form select[name="role"]').inputValue(),'readonly');
    const globalPanel=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Övergripande global åtkomst',exact:true})});
    await globalPanel.getByText('global.admin',{exact:true}).waitFor();
    assert.match(await globalPanel.innerText(),/MFA konfigurerad/);
    assert.match(await globalPanel.innerText(),/Alla företag/);
    const localAccessPanel=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Användare & behörigheter',exact:true})});
    const globalMemberRow=localAccessPanel.locator('tr').filter({hasText:'global.admin'});
    assert.match(await globalMemberRow.innerText(),/LT Studio global admin/);
    assert.equal(await globalMemberRow.locator('select').count(),0);
    assert.equal(await globalMemberRow.getByRole('button',{name:'Ta bort åtkomst',exact:true}).count(),0);
    checks.push({kind:'global-admin-visible-and-protected'});
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

    await page.getByRole('button',{name:'← Alla företag',exact:true}).click();
    await page.getByRole('heading',{name:'Kunder & företag',exact:true}).waitFor();
    const refreshedCompanyRow=page.locator('[data-company-id="'+company.id+'"]');
    assert.equal((await refreshedCompanyRow.locator('td').nth(2).innerText()).trim(),'3');
    await refreshedCompanyRow.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading',{name:'Företagsadmin',exact:true}).waitFor();
    checks.push({kind:'overview-refresh-after-user-link',memberCount:3});

    const sessionExpiry=new Date(Date.now()+60*60*1000).toISOString();
    const sharedCompanyATokenHash=Auth.hashToken('shared-company-a-session');
    const sharedCompanyBTokenHash=Auth.hashToken('shared-company-b-session');
    Db.createSession(runtime.db,{tokenHash:sharedCompanyATokenHash,csrfHash:Auth.hashToken('shared-a-csrf'),userId:sharedUser.id,companyId:company.id,expiresAt:sessionExpiry,absoluteExpiresAt:sessionExpiry});
    Db.createSession(runtime.db,{tokenHash:sharedCompanyBTokenHash,csrfHash:Auth.hashToken('shared-b-csrf'),userId:sharedUser.id,companyId:secondCompany.id,expiresAt:sessionExpiry,absoluteExpiresAt:sessionExpiry});

    const sharedRoleSelect=page.locator('select[data-role-user="'+sharedUser.id+'"]');
    await sharedRoleSelect.selectOption('approver');
    await page.getByText(/Behörigheten uppdaterades/).waitFor();
    assert.equal(Db.membership(runtime.db,company.id,sharedUser.id).role,'approver');
    assert.equal(Db.sessionByTokenHash(runtime.db,sharedCompanyATokenHash),null);
    assert.ok(Db.sessionByTokenHash(runtime.db,sharedCompanyBTokenHash));
    checks.push({kind:'role-change-revokes-only-company-session'});

    const sharedCompanyASecondTokenHash=Auth.hashToken('shared-company-a-session-2');
    Db.createSession(runtime.db,{tokenHash:sharedCompanyASecondTokenHash,csrfHash:Auth.hashToken('shared-a-csrf-2'),userId:sharedUser.id,companyId:company.id,expiresAt:sessionExpiry,absoluteExpiresAt:sessionExpiry});
    const sharedRow=page.locator('tr').filter({hasText:'shared.user'});
    await sharedRow.getByRole('button',{name:'Ta bort åtkomst',exact:true}).click();
    await page.getByRole('heading',{name:'Ta bort åtkomst?',exact:true}).waitFor();
    await page.locator('.modal-card').getByRole('button',{name:'Ta bort åtkomst',exact:true}).click();
    await page.getByText(/åtkomst.*togs bort/i).waitFor();
    assert.equal(Db.membership(runtime.db,company.id,sharedUser.id),null);
    assert.equal(Db.sessionByTokenHash(runtime.db,sharedCompanyASecondTokenHash),null);
    assert.ok(Db.sessionByTokenHash(runtime.db,sharedCompanyBTokenHash));
    checks.push({kind:'remove-access-revokes-only-company-session'});

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
