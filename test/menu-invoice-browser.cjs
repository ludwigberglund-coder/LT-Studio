'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {PDFDocument}=require('pdf-lib');
const {groups,unifiedGroups}=require('../apps/portal/portal-nav.js');
const {buildStatic}=require('../scripts/build-static.js');
const root=buildStatic(),out=path.resolve(__dirname,'..','test-artifacts');fs.mkdirSync(out,{recursive:true});
const expected=unifiedGroups(groups).flatMap(g=>g.items).map(i=>i[0]),errors=[],checks=[];
function mime(file){return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.pdf':'application/pdf'})[path.extname(file)]||'application/octet-stream';}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}if(!u.pathname.startsWith('/Rollands/')){res.writeHead(404);res.end('Not found');return;}let relative=decodeURIComponent(u.pathname.slice('/Rollands/'.length));if(relative.endsWith('/')||!relative)relative+='index.html';const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':'no-store'});res.end(data);});});
(async()=>{
 let browser,page;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/Rollands/`;
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.on('pageerror',e=>errors.push({url:page.url(),error:e.message}));page.on('dialog',d=>d.accept());
  async function menu(){await page.locator('.shared-navigation').waitFor({timeout:15000});await page.waitForFunction(()=>document.querySelector('.shared-sidebar')?.dataset.sharedRoute===location.pathname+location.hash);const actual=await page.locator('.shared-navigation [data-nav-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.navId));assert.deepEqual(actual,expected,page.url());assert.equal(await page.locator('.shared-navigation').count(),1);await page.locator('.shared-navigation [data-nav-id] .ui-icon svg').first().waitFor({state:'attached',timeout:5000});assert.equal(await page.locator('.shared-navigation [data-nav-id] .ui-icon svg').count(),expected.length,'alla gemensamma menyval ska ha Iconoir-ikon');}
  async function openMenuLink(id){
    const link=page.locator('[data-nav-id="'+id+'"]');
    const section=link.locator('xpath=ancestor::details[1]');
    if(!(await section.evaluate(element=>element.open)))await section.locator('summary').click();
    await link.click();
  }
  const portal=fs.readdirSync(path.join(root,'portal')).filter(f=>f.endsWith('.html')&&!['uat-setup.html','company-activate.html'].includes(f)).map(f=>'portal/'+f),legacy=['overview','res-tools','batches','audit','inbox','assistant','settings'].map(v=>'legacy/?demo=1#/'+v);
  for(const route of [...portal,...legacy]){const target=new URL(route,base);target.searchParams.set('demo','1');const response=await page.goto(target.href,{waitUntil:'networkidle'});if(response)assert.equal(response.status(),200,route);await menu();checks.push({kind:'menu',route});}
  // Customer registry uses its own browser context so test data cannot
  // contaminate invoice and accounting scenarios later in this smoke test.
  {
    const customerContext=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light'});
    try{
      const customerPage=await customerContext.newPage();
      const customerErrors=[];
      customerPage.on('pageerror',error=>customerErrors.push(error.message));
      const response=await customerPage.goto(base+'portal/customers.html?demo=1',{waitUntil:'networkidle'});
      assert.equal(response.status(),200,'customer register');
      const register=customerPage.locator('.customer-register-workspace');
      await register.waitFor({timeout:15000});
      const rows=register.locator('.customer-register-row');
      const total=await rows.count();
      assert.ok(total>=3,'demo should contain registered customers');
      const count=register.locator('[data-customer-result-count]');
      assert.equal((await count.innerText()).trim(),total+' kunder');
      const search=register.locator('#customer-register-search');
      await search.fill('vastra hamnen');
      assert.equal(await rows.count(),1,'accent insensitive customer search');
      assert.equal((await count.innerText()).trim(),'1 av '+total+' kunder visas');
      assert.match(await rows.first().innerText(),/Västra Hamnen/);
      assert.match(await rows.first().locator('td[data-label="Historik"]').innerText(),/faktura/);
      await search.fill('559000-1001');
      assert.equal(await rows.count(),1,'organization number search');
      await search.fill('NO_SUCH_CUSTOMER_2026');
      assert.equal(await rows.count(),0);
      assert.equal((await count.innerText()).trim(),'0 av '+total+' kunder visas');
      assert.match(await register.locator('.customer-register-empty').innerText(),/Inga kunder matchar sökningen/);
      await search.fill('');
      assert.equal(await rows.count(),total,'clearing search restores the register');
      assert.equal(await customerPage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),true,
        'customer register must not cause sideways scrolling on a phone');
      assert.equal(await rows.first().locator('[data-edit-customer]').isVisible(),true);
      assert.equal(await rows.first().locator('[data-delete-customer]').isDisabled(),true,
        'demo customers must not show a destructive action as usable');
      await customerPage.screenshot({path:path.join(out,'customer-register-mobile.png'),fullPage:true});
      await customerPage.locator('[data-new]').click();
      await customerPage.locator('#customer-form').waitFor();
      assert.equal(await customerPage.locator('.customer-form-advanced').getAttribute('open'),null,
        'optional invoice fields begin collapsed');
      await customerPage.locator('.customer-form-advanced > summary').click();
      await customerPage.locator('input[name=name]').fill('Syntetiskt UX Test AB');
      await customerPage.locator('input[name=orgNumber]').fill('559999-0099');
      await customerPage.locator('input[name=email]').fill('syntetiskt-ux@example.invalid');
      await customerPage.locator('input[name=ourReference]').fill('TESTREF');
      await customerPage.locator('#customer-form button[type=submit]').click();
      await register.waitFor({timeout:10000});
      const savedSearch=register.locator('#customer-register-search');
      await savedSearch.fill('Syntetiskt UX Test');
      assert.equal(await register.locator('.customer-register-row').count(),1,
        'new demo customer must be searchable');
      await register.locator('[data-edit-customer]').click();
      await customerPage.locator('#customer-form').waitFor();
      assert.equal(await customerPage.locator('.customer-form-advanced').getAttribute('open'),'',
        'previously used optional fields reopen when editing');
      assert.equal(await customerPage.locator('input[name=ourReference]').inputValue(),'TESTREF');
      await customerPage.locator('[data-cancel]').click();
      await customerPage.setViewportSize({width:1440,height:1000});
      await customerPage.locator('.customer-register-workspace').waitFor();
      await customerPage.locator('#customer-register-search').fill('');
      await customerPage.screenshot({path:path.join(out,'customer-register-desktop.png'),fullPage:true});
      await customerPage.locator('[data-toggle-archived]').click();
      assert.match(await customerPage.locator('.customer-register-empty').innerText(),/Inga arkiverade kunder/);
      assert.deepEqual(customerErrors,[],'customer registry browser errors');
      checks.push({kind:'customer-registry-ui',total,search:'number/name/org',mobile:true,edit:true});
    }finally{
      await customerContext.close();
    }
  }
  {
    const response=await page.goto(base+'admin/?demo=1#/overview',{waitUntil:'networkidle'});
    if(response)assert.equal(response.status(),200,'admin/');
    await page.getByRole('heading',{name:'LT Studio-inloggning'}).waitFor({timeout:15000});
    assert.match(page.url(),/\/operator\//,'/admin/ ska leda till den säkra Driftadmin-portalen');
    assert.equal(await page.locator('.shared-navigation').count(),0,'Driftadmin ska inte använda kundportalens navigation');
    checks.push({kind:'admin-entry-redirect',route:'admin/',target:'operator/'});
  }
  {
    const response=await page.goto(base+'portal/uat-setup.html',{waitUntil:'networkidle'});
    if(response)assert.equal(response.status(),200,'portal/uat-setup.html');
    await page.locator('#bootstrap-form').waitFor({timeout:15000});
    assert.equal(await page.locator('.shared-navigation').count(),0,'UAT-aktivering före inloggning ska inte exponera intern arbetsytenavigation');
    checks.push({kind:'pre-auth-setup',route:'portal/uat-setup.html'});
  }
  {
    const response=await page.goto(base+'portal/company-activate.html?code=demo-invalid',{waitUntil:'networkidle'});
    if(response)assert.equal(response.status(),200,'portal/company-activate.html');
    await page.locator('.activation-shell').waitFor({timeout:15000});
    assert.equal(await page.locator('.shared-navigation').count(),0,'Kundaktivering före inloggning ska inte exponera intern arbetsytenavigation');
    checks.push({kind:'pre-auth-company-activation',route:'portal/company-activate.html'});
  }
  await page.goto(base+'portal/dashboard.html?demo=1',{waitUntil:'networkidle'});
  await page.locator('.shared-user-menu').waitFor({timeout:15000});
  assert.equal(await page.locator('.shared-user-menu').count(),1);
  await page.evaluate(async()=>{await Promise.all([RollandsNavigation.mountUserMenu(),RollandsNavigation.mountUserMenu(),RollandsNavigation.mountUserMenu()]);});
  assert.equal(await page.locator('.shared-user-menu').count(),1,'samtidiga monteringar får aldrig skapa dubbla profilmenyer');
  assert.equal(await page.locator('.user-chip').count(),0,'modulens äldre profilchip ska tas bort när den gemensamma menyn monteras');
  assert.equal((await page.locator('.shared-user-label strong').innerText()).trim(),'Demoanvändare');
  assert.equal((await page.locator('.shared-user-avatar').innerText()).trim(),'D');
  await page.locator('.shared-user-trigger').click();
  await page.getByRole('link',{name:'Lämna demon',exact:true}).waitFor();
  await page.locator('.shared-user-trigger').click();
for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:1000});await menu();const layout=await page.evaluate(()=>{const shell=getComputedStyle(document.querySelector('.shared-workspace-shell')),sidebar=getComputedStyle(document.querySelector('.shared-sidebar'));return{grid:shell.gridTemplateColumns,sidebar:sidebar.display,position:sidebar.position}});const firstTrack=Number.parseFloat(layout.grid);if(width>760){assert.notEqual(layout.sidebar,'none');if(width>1180){assert.ok(Math.abs(firstTrack-276)<1,`stor desktop ska behålla 276 px sidomeny, fick ${layout.grid}`);}else{assert.ok(firstTrack>=220&&firstTrack<=276,`kompakt desktop ska använda en läsbar sidomeny mellan 220 och 276 px, fick ${layout.grid}`);}}else{assert.notEqual(layout.sidebar,'none');assert.equal(layout.position,'fixed','mobil sidomeny ska vara en off-canvas drawer');assert.equal(layout.grid.trim().split(/\s+/).length,1,'mobil layout ska vara en kolumn');assert.equal(await page.locator('.shared-menu-toggle').count(),1,'mobilen ska alltid ha en hamburgarknapp');assert.equal(await page.locator('.shared-menu-toggle').isVisible(),true,'hamburgarknappen ska vara synlig på mobil');await page.waitForFunction(()=>document.querySelector('.shared-menu-toggle')?.getAttribute('aria-expanded')==='false',{timeout:3000});assert.equal(await page.locator('.shared-menu-toggle').getAttribute('aria-expanded'),'false','mobilmenyn ska starta stängd');}checks.push({kind:'viewport',width,layout});}
  const finder=page.locator('#shared-nav-search-input');
  await finder.fill('kontoplan');
  assert.equal(await page.locator('[data-nav-id="accounts"]').isVisible(),true,'sök visar även tekniska funktioner');
  assert.equal(await page.locator('[data-nav-id="payables"]').isVisible(),false,'andra verktyg filtreras');
  await finder.fill('något-som-inte-finns');
  assert.equal(await page.locator('.shared-nav-search-empty').isVisible(),true,'sökning utan träff har ett tydligt svar');
  await finder.fill('kundreskontra');
  assert.equal(await page.locator('[data-nav-id="receivables"]').isVisible(),true,'sökning med gammalt fackord hittar obetalda fakturor');
  await finder.fill('leverantörsreskontra');
  assert.equal(await page.locator('[data-nav-id="supplier-ledger"]').isVisible(),true,'sökning med gammalt fackord hittar fakturor att betala');
  await finder.fill('');
  assert.equal(await page.locator('.shared-nav-search-empty').isVisible(),false);
  checks.push({kind:'navigation-search'});
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await page.locator('[data-nav-id="receivables"]').isVisible(),false,'reskontran nås via faktura-arbetsytan');
  assert.equal(await page.locator('[data-nav-id="supplier-ledger"]').isVisible(),false,'leverantörsreskontran nås via inköps-arbetsytan');
  await openMenuLink('payables');
  await page.locator('.lt-workspace-switcher').waitFor();
  assert.deepEqual(await page.locator('.lt-workspace-switcher-links a').evaluateAll(nodes=>nodes.map(n=>n.dataset.workspaceTab)),[
    'documents','payables','suppliers'
  ],'en enda ordinarie leverantörsfaktura- och betalningsflik ska finnas kvar');
  assert.equal(await page.locator('[data-workspace-tab="payables"]').getAttribute('aria-current'),'page');
  assert.equal(await page.locator('[data-workspace-tab="supplier-ledger"]').count(),0,'betalningen ska inte längre ha en separat underflik');
  // Existing bookmarks must still work, without exposing a second normal tab.
  await page.goto(base+'portal/supplier-ledger.html?demo=1',{waitUntil:'networkidle'});
  await menu();await page.getByRole('heading',{name:'Betalningsplanering',exact:true}).waitFor();
  assert.match(page.url(),/portal\/supplier-ledger\.html/);
  assert.equal(await page.locator('[data-nav-id="supplier-ledger"]').isVisible(),true,'äldre direktlänk förblir åtkomlig när den är aktiv');
  assert.equal(await page.locator('.lt-workspace-switcher').count(),0,'äldre direktlänk ska inte skapa en andra kundflik');
  await openMenuLink('documents');
  await menu();await page.locator('.lt-workspace-switcher').waitFor();
  assert.match(page.url(),/portal\/documents\.html/);
  assert.equal(await page.locator('[data-workspace-tab="documents"]').getAttribute('aria-current'),'page');
  checks.push({kind:'purchase-workspace-tabs'});
  await openMenuLink('accounts');await page.locator('#account-form').waitFor();await page.locator('#account-form [name=number]').fill('3099');await page.locator('#account-form [name=name]').fill('Egen tjänsteintäkt 12 %');await page.locator('#account-form [name=vatRate]').selectOption('12');await page.getByRole('button',{name:'Spara intäktskonto',exact:true}).click();
  await openMenuLink('invoices');await page.locator('.lt-workspace-switcher').waitFor();
  assert.deepEqual(await page.locator('.lt-workspace-switcher-links a').evaluateAll(nodes=>nodes.map(n=>n.dataset.workspaceTab)),[
    'invoices','receivables','customers'
  ],'kundfakturor och kundreskontra ska dela en arbetsyta');
  assert.equal(await page.locator('[data-workspace-tab="invoices"]').getAttribute('aria-current'),'page');
  await page.screenshot({path:path.join(out,'sales-workspace-tabs.png'),fullPage:true});
  await page.getByRole('button',{name:'Ny kundfaktura',exact:true}).click();await page.locator('#invoice-form').waitFor();await menu();
  assert.equal(await page.locator('.lt-workspace-switcher').count(),1,'arbetsyteflikarna ska finnas kvar när formuläret öppnas');
  const guide=page.locator('#invoice-form .invoice-guide');
  assert.equal(await guide.count(),1,'fakturautkastet ska visa en tydlig trestegsguide');
  assert.deepEqual(await guide.locator('[data-invoice-jump]').evaluateAll(nodes=>nodes.map(n=>n.dataset.invoiceJump)),['customer','dates','finish']);
  assert.equal((await guide.locator('[data-invoice-guide-state="customer"]').innerText()).trim(),'Börja här');
  assert.equal(await page.locator('.invoice-section').filter({hasText:'Avgifter och öresutjämning'}).getAttribute('open'),null,'valfria avgifter ska börja hopfällda');
  assert.equal(await page.locator('.invoice-section').filter({hasText:'6. Meddelanden'}).getAttribute('open'),null,'valfria meddelanden ska börja hopfällda');
  const pdfTools=page.locator('details.invoice-pdf-tools');
  assert.equal(await pdfTools.getAttribute('open'),null,'PDF-verktygen tar inte plats innan de behövs');
  assert.equal(await pdfTools.locator('button').count(),2,'båda PDF-åtgärderna ska fortfarande finnas kvar');
  await guide.locator('[data-invoice-jump="customer"]').click();
  assert.equal(await page.evaluate(()=>document.activeElement?.name),'customerNumber','kundsteget fokuserar kundvalet');
  await guide.locator('[data-invoice-jump="dates"]').click();
  assert.equal(await page.evaluate(()=>document.activeElement?.name),'invoiceDate','andra steget fokuserar fakturadatum');
  await guide.locator('[data-invoice-jump="finish"]').click();
  assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-invoice-finish')),true,'sista steget fokuserar kontrollen, aldrig bokföringsknappen');
  await pdfTools.locator('summary').click();
  assert.equal(await pdfTools.locator('button[data-action="open-draft-pdf"]').isVisible(),true);
  assert.equal(await pdfTools.locator('button[data-action="print-draft-pdf"]').isVisible(),true);
  await pdfTools.locator('summary').click();
  checks.push({kind:'invoice-guided-creation'});
  const issueButton=page.getByRole('button',{name:'Skapa och bokför faktura',exact:true});await issueButton.evaluate(button=>{button.disabled=true});const blockedStyle=await issueButton.evaluate(button=>{const style=getComputedStyle(button);return{backgroundColor:style.backgroundColor,color:style.color,opacity:style.opacity,cursor:style.cursor}});assert.deepEqual(blockedStyle,{backgroundColor:'rgb(229, 229, 229)',color:'rgb(115, 115, 115)',opacity:'1',cursor:'not-allowed'});await issueButton.evaluate(button=>{button.disabled=false});
  assert.equal(await page.locator('[name=orderNumber]').count(),0);assert.equal(await page.locator('[name=deliveryDate]').count(),0);assert.equal(await page.locator('[name="buyer.vatNumber"]').count(),0);assert.equal(await page.locator('[name="buyer.phone"]').count(),0);
  await page.locator('[name=customerNumber]').selectOption('K-1001');assert.equal((await page.locator('[data-invoice-guide-state="customer"]').innerText()).trim(),'Kund vald');const customerSection=page.locator('.invoice-section').filter({hasText:'Mottagare & kund'});assert.equal(await page.locator('[name="buyer.address"]').count(),0);assert.equal(await page.locator('[name="buyer.orgNumber"]').count(),0);assert.equal(await page.locator('[name="buyer.email"]').count(),0);assert.equal(await customerSection.getByLabel('Företagsnamn - kund').inputValue(),'Västra Hamnen Logistik AB');assert.equal(await customerSection.getByLabel('Organisationsnummer - kund').inputValue(),'559000-1001');assert.equal(await customerSection.getByLabel('Fakturaadress, postnummer och ort - kund').inputValue(),'Testhamnsgatan 10, 411 00 Göteborg');assert.equal(await customerSection.getByLabel('Mottagarens e-post - kund').inputValue(),'ekonomi@vastrahamnen.example.invalid');
  await page.locator('[name=invoiceDate]').fill('2026-09-17');await page.locator('[name=invoiceDate]').dispatchEvent('change');assert.equal(await page.locator('[name=postingDate]').count(),0);await page.locator('[name=paymentTermsDays]').fill('14');await page.locator('[name=paymentTermsDays]').dispatchEvent('change');assert.equal(await page.locator('[name=dueDate]').inputValue(),'2026-10-01');
  const extra=page.locator('.invoice-extra-details');
  assert.equal(await extra.count(),1,'references and OCR must remain reachable');
  assert.equal(await extra.getAttribute('open'),null,'optional invoice fields are initially collapsed');
  await extra.locator('summary').click();
  await extra.locator('[name=ourReference]').fill('Syntetisk UAT-referens');
  await extra.locator('summary').click();
  assert.equal(await page.evaluate(()=>new FormData(document.getElementById('invoice-form')).get('ourReference')),'Syntetisk UAT-referens','collapsing optional fields must not lose entered values');
  const sellerDetails=page.locator('.invoice-section').filter({hasText:'Avsändare, kontakt och betalningsuppgifter'});assert.equal(await sellerDetails.getAttribute('open'),null);await sellerDetails.locator('summary').click();assert.equal(await sellerDetails.locator('input[readonly]').count(),9);
  const row0=page.locator('[data-row="0"]');await row0.locator('[data-row-field=description]').fill('Färsk frukt');assert.equal((await page.locator('[data-invoice-guide-state="rows"]').innerText()).trim(),'Fakturarad påbörjad');await row0.locator('[data-row-field=quantity]').fill('2');await row0.locator('[data-row-field=unit]').fill('kg');await row0.locator('[data-row-field=unitPrice]').fill('450,00');assert.equal(await row0.locator('[data-row-field=vatTreatment]').count(),0,'Typ av försäljning ska inte visas');const vat0=row0.locator('[data-row-field=vatRate]');assert.deepEqual(await vat0.locator('option').allTextContents(),['Välj momssats','25 %','12 %','6 %']);await vat0.selectOption('6');
  const revenue0=row0.locator('[data-row-field=revenueAccount]');
  const eligibleSix=await revenue0.locator('option').evaluateAll(items=>items.map(item=>item.value).filter(Boolean));
  assert.equal(await revenue0.inputValue(),eligibleSix.length===1?eligibleSix[0]:'','only one configured account may be suggested; otherwise leave selection blank');
  assert.match(await row0.locator('[data-account-guidance]').innerText(),/konto/i);
  await revenue0.selectOption('3053');assert.equal(await row0.locator('[data-row-field=revenueAccount] option[value="3042"]').count(),0,'12 %-konto får inte visas vid 6 % moms');assert.equal(await row0.locator('[data-row-field=revenueAccount] option[value="3051"]').count(),0,'25 %-konto får inte visas vid 6 % moms');
  await page.getByRole('button',{name:'Ändra K-1001 i kundregistret',exact:true}).click();await page.locator('#customer-form').waitFor();assert.match(page.url(),/customers\.html\?/);await page.locator('#customer-form [name=address]').fill('UAT Nya Testgatan 99, 411 99 Göteborg');await page.getByRole('button',{name:'Spara kund',exact:true}).click();await page.locator('#invoice-form').waitFor();assert.match(page.url(),/invoices\.html\?resume=1/);const resumedCustomerSection=page.locator('.invoice-section').filter({hasText:'Mottagare & kund'});assert.equal(await resumedCustomerSection.getByLabel('Fakturaadress, postnummer och ort - kund').inputValue(),'UAT Nya Testgatan 99, 411 99 Göteborg');const resumedRow0=page.locator('[data-row="0"]');assert.equal(await resumedRow0.locator('[data-row-field=description]').inputValue(),'Färsk frukt');assert.equal(await resumedRow0.locator('[data-row-field=unitPrice]').inputValue(),'450,00');assert.equal(await resumedRow0.locator('[data-row-field=revenueAccount]').inputValue(),'3053');
  await page.getByRole('button',{name:'Lägg till fakturarad',exact:true}).click();const row1=page.locator('[data-row="1"]');await row1.locator('[data-row-field=description]').fill('Cateringtjänst');await row1.locator('[data-row-field=quantity]').fill('1');await row1.locator('[data-row-field=unitPrice]').fill('250,00');await row1.locator('[data-row-field=vatRate]').selectOption('12');
  const revenue1=row1.locator('[data-row-field=revenueAccount]');
  const eligibleTwelve=await revenue1.locator('option').evaluateAll(items=>items.map(item=>item.value).filter(Boolean));
  assert.equal(await revenue1.inputValue(),eligibleTwelve.length===1?eligibleTwelve[0]:'','do not guess between multiple accounts');
  await revenue1.selectOption('3099');assert.equal(await row1.locator('[data-row-field=revenueAccount] option[value="3051"]').count(),0,'25 %-konto får inte visas vid 12 % moms');assert.equal(await row1.locator('[data-row-field=revenueAccount] option[value="3053"]').count(),0,'6 %-konto får inte visas vid 12 % moms');
  const feesSection=page.locator('.invoice-section').filter({hasText:'Avgifter och öresutjämning'});
  await feesSection.locator('summary').click();
  await page.locator('[name=useFees]').check();
  assert.equal(await feesSection.getAttribute('open'),'','valfria avgifter blir synliga när de väljs');
  await page.locator('[name="administration.amount"]').fill('10,00');
  await page.locator('[name="freight.amount"]').fill('50,00');
  const messageSection=page.locator('.invoice-section').filter({hasText:'6. Meddelanden'});
  await messageSection.locator('summary').click();
  await page.locator('[name=includeMessage]').check();
  assert.equal(await messageSection.getAttribute('open'),'','meddelandefältet öppnas när det aktiveras');
  await page.locator('[name=notes]').fill('Tack för ert köp.');
  await page.screenshot({path:path.join(out,'invoice-editor.png'),fullPage:true});const before=await page.evaluate(()=>RollandsDemoScenario.state().customerInvoices.length);
  await row1.locator('[data-row-field=description]').press('Enter');await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>RollandsDemoScenario.state().customerInvoices.length),before,'Enter i fakturaformuläret får inte ställa ut fakturan');
  await page.getByRole('button',{name:'Skapa och bokför faktura',exact:true}).click();await page.getByRole('heading',{name:/Faktura 310/}).waitFor();await menu();
  const posted=await page.evaluate(()=>{const s=RollandsDemoScenario.state(),record=s.customerInvoices.at(-1),entry=s.accountingEntries.find(e=>e.sourceId===record.id);return {record,entry,count:s.customerInvoices.length};});
  assert.equal(posted.count,before+1);assert.equal(posted.record.ocr,posted.record.invoiceNumber);assert.equal(posted.record.document.ocr,posted.record.invoiceNumber);assert.equal(posted.record.document.lines[1].revenueAccount,'3099');assert.equal(posted.record.document.lines.find(r=>r.kind==='administration').revenueAccount,'3690');assert.equal(posted.record.document.lines.find(r=>r.kind==='administration').vatTreatment,'se-standard-25','intern fakturaavgift ska bära verifierad momsbehandling');assert.equal(posted.record.document.lines.find(r=>r.kind==='freight').revenueAccount,'3520');assert.equal(posted.record.document.lines.find(r=>r.kind==='freight').vatTreatment,'se-standard-25','intern fraktrad ska bära verifierad momsbehandling');assert.equal(posted.entry.lines.reduce((n,r)=>n+r.debitOre-r.creditOre,0),0);assert.equal(posted.entry.lines.find(r=>r.account==='3099').creditOre,25000);
  const pdfBytes=await page.evaluate(async()=>Array.from(await LTStudioInvoicePdf.createInvoicePdf(RollandsDemoScenario.state().customerInvoices.at(-1).document)));const buf=Buffer.from(pdfBytes);fs.writeFileSync(path.join(out,'invoice-browser.pdf'),buf);const pdf=await PDFDocument.load(buf);assert.equal(pdf.getTitle(),'FAKTURA '+posted.record.invoiceNumber);assert.ok(pdf.getPageCount()>=1);
  await page.getByRole('button',{name:'Till fakturalistan',exact:true}).click();await page.locator('.invoice-toolbar h2').getByText('Kundfakturor',{exact:true}).waitFor();
  const register=page.locator('.invoice-register-workspace');
  await register.waitFor();
  assert.equal(await register.locator('.invoice-register-heading h3').innerText(),'Fakturalista');
  const count=register.locator('[data-invoice-list-count]');
  assert.equal((await count.innerText()).trim(),posted.count+' '+(posted.count===1?'faktura':'fakturor'),'översikten ska räkna registrerade fakturor, inte påstå betald status');
  assert.equal(await register.locator('.sales-table th[scope="col"]').count(),7,'alla ursprungliga kolumner ska finnas kvar');
  assert.equal(await register.locator('.sales-table tbody tr:not(.invoice-empty-row)').count(),posted.count);
  const searchField=register.locator('#invoice-register-search');
  await searchField.fill(posted.record.invoiceNumber);
  const matched=await register.locator('.sales-table tbody tr:not(.invoice-empty-row)').count();
  assert.ok(matched>=1,'bokförd faktura måste hittas genom sökningen');
  assert.equal((await count.innerText()).trim(),matched+' av '+posted.count+' fakturor visas','visat antal ska följa filtret');
  assert.ok((await register.locator('.invoice-register-reference').first().innerText()).includes(posted.record.invoiceNumber));
  await searchField.fill('THIS_INVOICE_SHOULD_NEVER_MATCH_2026');
  assert.equal((await count.innerText()).trim(),'0 av '+posted.count+' fakturor visas');
  assert.match(await register.locator('.invoice-empty-row').innerText(),/Inga fakturor matchar sökningen/);
  await searchField.fill('');
  assert.equal(await register.locator('.sales-table tbody tr:not(.invoice-empty-row)').count(),posted.count);
  await page.screenshot({path:path.join(out,'invoice-register-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await register.locator('.invoice-register-reference').first().isVisible(),true,'fakturanummer ska synas i mobilkortet');
  assert.equal(await register.locator('.invoice-register-open').first().isVisible(),true,'fakturans åtgärd ska vara nåbar på mobil');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,'fakturaregistret får inte tvinga sidledsskroll på mobil');
  await page.screenshot({path:path.join(out,'invoice-register-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  checks.push({kind:'invoice-register-visual-hierarchy'});
  const invoiceHeaders=await page.locator('.sales-panel .sales-table thead th').allTextContents();assert.ok(invoiceHeaders.map(v=>v.trim()).includes('Typ'),'Kundfakturor ska visa dokumenttyp');assert.equal(invoiceHeaders.map(v=>v.trim()).includes('Restbelopp'),false,'Kundfakturor ska inte visa reskontrasaldo');
  await page.locator('[data-workspace-tab="receivables"]').click();await menu();await page.locator('.lt-workspace-switcher').waitFor();assert.equal(await page.locator('[data-workspace-tab="receivables"]').getAttribute('aria-current'),'page');assert.match(page.url(),/portal\/index\.html/,'Kundreskontra ska använda den gemensamma reskontrasidan');assert.ok((await page.locator('body').innerText()).includes(posted.record.invoiceNumber),'fakturan ska synas i kundreskontran');
  await openMenuLink('accounting');await menu();assert.ok((await page.locator('body').innerText()).includes(posted.record.invoiceNumber),'fakturan ska synas i bokföringen');
  await openMenuLink('reports');await menu();assert.equal(await page.locator('body').innerText().then(t=>t.length>50),true,'rapportsidan ska fortsätta rendera efter fakturabokföring');await page.getByRole('button',{name:'Försäljning',exact:true}).click();await page.getByRole('heading',{name:'Försäljning per dag',exact:true}).waitFor();assert.ok((await page.locator('body').innerText()).includes('Operativ rapport.'),'försäljningsrapporten ska förklara sin operativa databas');checks.push({kind:'sales-report'});
  await page.reload({waitUntil:'networkidle'});await menu();assert.deepEqual(errors,[],'no uncaught browser errors');checks.push({kind:'invoice-chain',invoiceNumber:posted.record.invoiceNumber,ocr:posted.record.ocr,accounts:posted.entry.lines.map(r=>r.account)});fs.writeFileSync(path.join(out,'navigation-invoice-results.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(`Navigation and invoice browser checks passed: ${checks.length} checks.`);
 }catch(error){fs.writeFileSync(path.join(out,'navigation-invoice-results.json'),JSON.stringify({ok:false,checks,errors,failure:error.stack},null,2));if(page)await page.screenshot({path:path.join(out,'browser-failure.png'),fullPage:true}).catch(()=>{});throw error;}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
