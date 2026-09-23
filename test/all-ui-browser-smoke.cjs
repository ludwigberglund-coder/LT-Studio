'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const {buildStatic}=require('../scripts/build-static.js');

const root=buildStatic();
const out=path.resolve(__dirname,'..','test-artifacts');
fs.mkdirSync(out,{recursive:true});

const portalPages=[
  'index.html',
  'dashboard.html',
  'invoices.html',
  'receivables.html',
  'customers.html',
  'payables.html',
  'suppliers.html',
  'payments.html',
  'bank.html',
  'accounting.html',
  'accounts.html',
  'reports.html',
  'documents.html',
  'inventory.html',
  'payroll.html',
  'automation.html',
  'website.html',
  'profile.html',
  'company-settings.html',
  'uat.html'
];

const surfaces=[
  ...portalPages.map(file=>({id:`portal-${file.replace(/\.html$/,'')}`,route:`portal/${file}?demo=1`,kind:'portal'})),
  {id:'project-admin',route:'admin/?demo=1#/overview',kind:'admin'},
  {id:'legacy',route:'legacy/?demo=1#/overview',kind:'legacy'},
  {id:'public-website',route:'index.html',kind:'public'}
];

const viewports=[
  {id:'desktop',width:1440,height:1000},
  {id:'mobile',width:390,height:844}
];

function mime(file){
  return ({
    '.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.json':'application/json',
    '.svg':'image/svg+xml',
    '.png':'image/png',
    '.jpg':'image/jpeg',
    '.jpeg':'image/jpeg',
    '.webp':'image/webp',
    '.woff2':'font/woff2'
  })[path.extname(file).toLowerCase()]||'application/octet-stream';
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(url.pathname.startsWith('/api/')){
    res.writeHead(404,{'Content-Type':'application/json'});
    res.end('{"error":"Static QA has no API"}');
    return;
  }
  if(!url.pathname.startsWith('/Rollands/')){res.writeHead(404);res.end('Not found');return;}
  let relative=decodeURIComponent(url.pathname.slice('/Rollands/'.length));
  if(!relative||relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':'no-store'});
    res.end(data);
  });
});

function sameOriginAsset(url,base){
  try{
    const parsed=new URL(url,base);
    const origin=new URL(base).origin;
    if(!['http:','https:'].includes(parsed.protocol))return false;
    return parsed.origin===origin&&!parsed.pathname.startsWith('/api/');
  }catch{return false;}
}

(async()=>{
  let browser;
  const checks=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}/Rollands/`;
    browser=await chromium.launch({headless:true});

    for(const viewport of viewports){
      const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}});
      for(const surface of surfaces){
        const page=await context.newPage();
        const pageErrors=[];
        const failedRequests=[];
        const badResponses=[];

        page.on('pageerror',error=>pageErrors.push(error.message));
        page.on('requestfailed',request=>{
          if(sameOriginAsset(request.url(),base))failedRequests.push({url:request.url(),error:request.failure()?.errorText||'failed'});
        });
        page.on('response',response=>{
          if(sameOriginAsset(response.url(),base)&&response.status()>=400){
            badResponses.push({url:response.url(),status:response.status()});
          }
        });

        const response=await page.goto(new URL(surface.route,base).href,{waitUntil:'networkidle',timeout:25000});
        assert.ok(response,`${surface.id} ${viewport.id} did not return a document response`);
        assert.equal(response.status(),200,`${surface.id} ${viewport.id} returned ${response.status()}`);
        await page.waitForTimeout(250);

        const state=await page.evaluate(()=>{
          const html=document.documentElement;
          const body=document.body;
          const visible=element=>{
            const style=getComputedStyle(element);
            const rect=element.getBoundingClientRect();
            return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>0&&rect.height>0;
          };
          const rendered=[...document.querySelectorAll('body *')].filter(visible);
          const overflowing=rendered.map(element=>{
            const rect=element.getBoundingClientRect();
            return {
              tag:element.tagName.toLowerCase(),
              className:String(element.className||'').slice(0,80),
              text:String(element.textContent||'').trim().replace(/\s+/g,' ').slice(0,70),
              left:Math.round(rect.left),
              right:Math.round(rect.right),
              width:Math.round(rect.width)
            };
          }).filter(item=>item.left<-2||item.right>window.innerWidth+2||item.width>window.innerWidth+2).slice(0,10);

          const ids=[...document.querySelectorAll('[id]')].map(element=>element.id).filter(Boolean);
          const duplicateIds=[...new Set(ids.filter((id,index)=>ids.indexOf(id)!==index))];
          const brokenImages=[...document.images].filter(img=>!img.complete||img.naturalWidth===0).map(img=>img.src);
          const navLinks=[...document.querySelectorAll('.shared-navigation a,.side-nav a,.side-nav button,.nav-item')].filter(visible);
          const interactive=[...document.querySelectorAll('a[href],button,input,select,textarea,summary')].filter(visible);
          const emptyButtons=[...document.querySelectorAll('button')].filter(visible).filter(button=>{
            const label=(button.innerText||button.getAttribute('aria-label')||button.getAttribute('title')||'').trim();
            return !label&&!button.querySelector('svg');
          }).length;
          const iconFailures=[...document.querySelectorAll('[data-iconoir],.ui-icon')].filter(element=>visible(element)&&!element.querySelector('svg')).length;
          const bodyStyle=getComputedStyle(body);
          const sidebar=document.querySelector('.shared-sidebar,.sidebar');
          const sidebarBackground=sidebar?getComputedStyle(sidebar).backgroundColor:null;

          return {
            title:document.title.trim(),
            textLength:body.innerText.trim().length,
            scrollWidth:Math.max(html.scrollWidth,body.scrollWidth),
            innerWidth:window.innerWidth,
            overflowing,
            duplicateIds,
            brokenImages,
            visibleControls:interactive.length,
            navLinks:navLinks.length,
            emptyButtons,
            iconFailures,
            fontFamily:bodyStyle.fontFamily,
            bodyOverflowX:bodyStyle.overflowX,
            htmlOverflowX:getComputedStyle(html).overflowX,
            sidebarBackground
          };
        });

        assert.ok(state.title.length>0,`${surface.id} ${viewport.id} has an empty document title`);
        assert.ok(state.textLength>50,`${surface.id} ${viewport.id} rendered too little UI text`);
        assert.ok(state.visibleControls>0,`${surface.id} ${viewport.id} has no visible controls`);
        const horizontalOverflowClipped=['hidden','clip'].includes(state.bodyOverflowX)||['hidden','clip'].includes(state.htmlOverflowX);
        assert.ok(state.scrollWidth<=state.innerWidth+2||horizontalOverflowClipped,`${surface.id} ${viewport.id} has reachable page-level horizontal overflow: ${state.scrollWidth}px > ${state.innerWidth}px; body=${state.bodyOverflowX}; html=${state.htmlOverflowX}; offenders=${JSON.stringify(state.overflowing)}`);
        assert.equal(state.duplicateIds.length,0,`${surface.id} ${viewport.id} has duplicate DOM ids: ${state.duplicateIds.join(', ')}`);
        assert.equal(state.brokenImages.length,0,`${surface.id} ${viewport.id} has broken images: ${state.brokenImages.join(', ')}`);
        assert.equal(state.emptyButtons,0,`${surface.id} ${viewport.id} has visible unlabeled buttons`);
        assert.equal(state.iconFailures,0,`${surface.id} ${viewport.id} has Iconoir placeholders without SVG`);
        assert.equal(pageErrors.length,0,`${surface.id} ${viewport.id} has uncaught browser errors: ${pageErrors.join('; ')}`);
        assert.deepEqual(failedRequests,[],`${surface.id} ${viewport.id} has failed same-origin assets: ${JSON.stringify(failedRequests)}`);
        assert.deepEqual(badResponses,[],`${surface.id} ${viewport.id} has bad same-origin asset responses: ${JSON.stringify(badResponses)}`);
        assert.match(state.fontFamily,/Geist/i,`${surface.id} ${viewport.id} is not using the shared Geist stack`);
        if(state.sidebarBackground){
          assert.notEqual(state.sidebarBackground,'rgb(20, 60, 48)',`${surface.id} ${viewport.id} leaked the old green sidebar`);
        }

        if(surface.kind==='portal'){
          assert.ok(state.navLinks>=5,`${surface.id} ${viewport.id} rendered too few shared navigation links (${state.navLinks})`);
          const toggle=page.locator('.shared-menu-toggle');
          const sidebar=page.locator('.sidebar.shared-sidebar');
          if(await sidebar.count()){
            assert.equal(await toggle.count(),1,`${surface.id} ${viewport.id} must render exactly one shared menu toggle`);
            assert.equal(await toggle.isVisible(),true,`${surface.id} ${viewport.id} menu toggle must always be visible`);
            if(viewport.id==='mobile'){
              await toggle.click();
              await page.waitForTimeout(380);
              assert.equal(await toggle.getAttribute('aria-expanded'),'true',`${surface.id} mobile menu did not open`);
              assert.equal(await page.locator('.shared-workspace-shell').evaluate(el=>el.classList.contains('shared-mobile-menu-open')),true,`${surface.id} mobile shell did not enter open state`);
              await page.keyboard.press('Escape');
              await page.waitForTimeout(80);
              assert.equal(await toggle.getAttribute('aria-expanded'),'false',`${surface.id} mobile menu did not close with Escape`);
            }else{
              await toggle.click();
              await page.waitForTimeout(80);
              assert.equal(await page.locator('.shared-workspace-shell').evaluate(el=>el.classList.contains('shared-sidebar-collapsed')),true,`${surface.id} desktop menu did not collapse`);
              await toggle.click();
              await page.waitForTimeout(80);
              assert.equal(await page.locator('.shared-workspace-shell').evaluate(el=>el.classList.contains('shared-sidebar-collapsed')),false,`${surface.id} desktop menu did not reopen`);
            }
          }
        }

        if(surface.id==='portal-index'){
          const totalBalanceMetric=page.locator('.metrics .metric').filter({hasText:'Totalt kundsaldo'}).first();
          assert.equal(await totalBalanceMetric.count(),1,`receivables must show a Totalt kundsaldo metric on ${viewport.id}`);
          assert.ok((await totalBalanceMetric.locator('strong').innerText()).trim().length>0,`Totalt kundsaldo must have a value on ${viewport.id}`);
          await page.evaluate(()=>{document.querySelector('.portal').dataset.stabilityProbe='kept'});
          const search=page.locator('#receivable-search-input');
          assert.equal(await search.count(),1,`portal-index ${viewport.id} must expose receivables search`);
          await search.fill('3');
          await page.waitForTimeout(50);
          assert.equal(await page.locator('.portal').getAttribute('data-stability-probe'),'kept',`typing in receivables search must not replace the portal DOM on ${viewport.id}`);
          await search.fill('310002');
          await page.waitForTimeout(80);
          assert.equal(await page.locator('.invoice-row').count(),1,`invoice-number search should resolve to the matching customer's invoice rows on ${viewport.id}`);
          assert.match(await page.locator('.invoice-row').first().innerText(),/Nordic Office Göteborg AB/);
          await search.fill('222222-2222');
          await page.waitForTimeout(80);
          assert.equal(await page.locator('.invoice-row').count(),1,`organisation-number search should resolve to the matching customer's invoice rows on ${viewport.id}`);
          assert.match(await page.locator('.invoice-row').first().innerText(),/Nordic Office Göteborg AB/);
          await search.fill('Nordic Office');
          await page.waitForTimeout(80);
          assert.equal(await page.locator('.invoice-row').count(),1,`customer-name search should resolve to the matching customer's invoice rows on ${viewport.id}`);
          const row=page.locator('.invoice-row').first();
          const badge=row.locator('.invoice-rest-badge b');
          const headers=await page.locator('.res-table thead th').allTextContents();
          const restIndex=headers.findIndex(label=>label.trim()==='Restbelopp');
          assert.ok(restIndex>=0,`Restbelopp column must be visible on ${viewport.id}`);
          const restCell=row.locator('td').nth(restIndex);
          assert.equal((await badge.innerText()).trim(),(await restCell.innerText()).trim(),`invoice balance beside customer and Restbelopp column must match on ${viewport.id}`);
          await search.fill('');
          await page.waitForTimeout(80);
          assert.ok(await page.locator('.invoice-row').count()>=4,`clearing search should restore invoice rows on ${viewport.id}`);

          const commentRow=page.locator('.invoice-row[data-invoice-id="demo-i1"]');
          await commentRow.click({button:'right'});
          await page.getByRole('button',{name:'Skriv kommentar'}).click();
          const commentDraft=page.locator('#invoice-comment-draft');
          await commentDraft.fill('UAT-kommentar som ska ligga kvar.');
          assert.equal(await page.locator('.portal').getAttribute('data-stability-probe'),'kept',`typing a comment must not replace the portal DOM on ${viewport.id}`);
          assert.equal(await commentDraft.isVisible(),true,`comment composer must remain visible while typing on ${viewport.id}`);
          await page.getByRole('button',{name:'Spara kommentar'}).click();
          await page.waitForTimeout(80);
          assert.match(await page.locator('.comments').innerText(),/UAT-kommentar som ska ligga kvar/);
          await page.locator('.modal-actions [data-action="close-modal"]').click();
          await commentRow.click({button:'right'});
          await page.getByRole('button',{name:'Visa kommentar'}).click();
          assert.match(await page.locator('.comments').innerText(),/UAT-kommentar som ska ligga kvar/,`saved comment must reopen from context menu on ${viewport.id}`);
          await page.locator('.modal-actions [data-action="close-modal"]').click();

          await commentRow.click({button:'right'});
          await page.getByRole('button',{name:'Skapa betalningspåminnelse'}).click();
          const reminderModal=page.locator('.modal').filter({hasText:'Betalningspåminnelse'});
          await reminderModal.locator('input[name="includeReminderFee"]').check();
          await reminderModal.getByRole('button',{name:'Beräkna'}).click();
          await page.waitForTimeout(80);
          await reminderModal.getByRole('button',{name:'Registrera påminnelse'}).click();
          await page.waitForTimeout(80);
          assert.ok(await page.locator('.reminder-row').count()>=1,`registered reminder must appear directly under its invoice on ${viewport.id}`);
          assert.match(await page.locator('.reminder-row').first().innerText(),/Betalningspåminnelse/);

        }
        checks.push({surface:surface.id,viewport:viewport.id,...state});
        await page.close();
      }
      await context.close();
    }

    const result={ok:true,total:checks.length,checks};
    fs.writeFileSync(path.join(out,'all-ui-browser-results.json'),JSON.stringify(result,null,2));
    console.log(`All UI technical smoke passed: ${checks.length} page/viewport checks across ${surfaces.length} surfaces.`);
  }catch(error){
    fs.writeFileSync(path.join(out,'all-ui-browser-results.json'),JSON.stringify({ok:false,checks,error:error.stack||String(error)},null,2));
    throw error;
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
