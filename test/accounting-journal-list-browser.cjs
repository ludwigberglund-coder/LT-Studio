'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');

const root=path.resolve(__dirname,'../dist');
const mime=extension=>({
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json'
})[extension]||'application/octet-stream';
const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');
  let relative=decodeURIComponent(url.pathname).replace(/^\/+/,'');
  if(!relative||relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return}
  fs.readFile(file,(error,buffer)=>{
    if(error){response.writeHead(404);response.end('Not found');return}
    response.writeHead(200,{'Content-Type':mime(path.extname(file)),'Cache-Control':'no-store'});
    response.end(buffer);
  });
});

(async()=>{
  let browser,page;
  try{
    assert.ok(fs.existsSync(path.join(root,'portal/accounting.html')),'Run npm run build:static before browser test');
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port+'/';
    browser=await chromium.launch({headless:true});
    page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'portal/accounting.html?demo=1',{waitUntil:'domcontentloaded'});
    await page.locator('.journal-list').waitFor();
    await page.evaluate(()=>{
      window.RollandsDemoScenario.patch(state=>{
        state.accountingEntries=Array.from({length:12},(_,index)=>({
          id:'scroll-journal-'+index,
          number:'A'+(200+index),
          postingDate:'2025-01-10',
          createdAt:new Date(Date.UTC(2026,9,12,8,index,0)).toISOString(),
          description:'Browser test entry '+index,
          sourceType:'customer-payment',
          lines:[
            {account:'1930',debitOre:12500,creditOre:0,text:'Inbetalning'},
            {account:'1510',debitOre:0,creditOre:12500,text:'Kundfordran'}
          ]
        }));
      });
    });
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.journal-list').waitFor();

    assert.equal(await page.locator('[data-entry]').first().getAttribute('data-entry'),'scroll-journal-11');
    const table=page.locator('#journal-scroll-region');
    const before=await table.evaluate(node=>({
      height:node.clientHeight,total:node.scrollHeight,
      visibleRows:[...node.querySelectorAll('tbody tr')].slice(0,6).map(row=>row.getBoundingClientRect().bottom),
      bottom:node.getBoundingClientRect().bottom
    }));
    assert.ok(before.total>before.height,'older journal entries are scrollable without expanding');
    assert.ok(before.height>=300&&before.height<=306,'default list shows five compact rows');
    assert.ok(before.visibleRows[4]<=before.bottom+3,'the fifth row is initially visible');
    assert.ok(before.visibleRows[5]>before.bottom,'the sixth row is initially below the viewport');
    assert.equal(await page.getByRole('button',{name:/Visa fler verifikationer/}).getAttribute('aria-expanded'),'false');

    const detailAbove=await page.evaluate(()=>{
      const detail=document.querySelector('.accounting-grid > .panel:first-child > .entry-detail');
      const list=document.querySelector('.journal-list');
      return Boolean(detail&&list&&(detail.compareDocumentPosition(list)&Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.ok(detailAbove,'selected entry details must be above the list in DOM order');

    await table.hover();
    await page.mouse.wheel(0,300);
    await page.waitForTimeout(250);
    assert.ok(await table.evaluate(node=>node.scrollTop)>0,'wheel scroll must move journal rows inside the table');

    await page.getByRole('button',{name:/Visa fler verifikationer/}).click();
    assert.equal(await page.locator('[data-action="toggle-journals"]').getAttribute('aria-expanded'),'true');
    assert.ok((await table.evaluate(node=>node.clientHeight))>before.height,'expand control increases the scrollable viewport');

    const older=page.locator('[data-entry="scroll-journal-4"]');
    await older.scrollIntoViewIfNeeded();
    await older.click();
    assert.match(await page.locator('.accounting-grid > .panel:first-child > .entry-detail').innerText(),/Browser test entry 4/);
    assert.equal(await page.locator('[data-entry="scroll-journal-4"]').getAttribute('aria-current'),'true');

    await page.getByRole('button',{name:/Visa färre/}).click();
    assert.equal(await page.locator('[data-action="toggle-journals"]').getAttribute('aria-expanded'),'false');
    assert.ok((await table.evaluate(node=>node.clientHeight))<=306);
    const keyboardRow=page.locator('[data-entry="scroll-journal-3"]');
    await keyboardRow.scrollIntoViewIfNeeded();
    await keyboardRow.focus();
    await page.keyboard.press('Enter');
    assert.match(await page.locator('.accounting-grid > .panel:first-child > .entry-detail').innerText(),/Browser test entry 3/);

    // Search must filter only loaded journal data and not wipe partially entered corrections.
    const correctionReason=page.locator('#correction-form textarea[name="reason"]');
    await correctionReason.fill('Utkast till rättelse som ska bevaras vid sökning');
    const search=page.getByRole('searchbox',{name:'Sök verifikation'});
    await search.focus();
    await page.keyboard.type('A204');
    assert.equal(await page.locator('[data-entry]').count(),1,'search matches journal number');
    assert.equal(await page.locator('[data-entry]').first().getAttribute('data-entry'),'scroll-journal-4');
    assert.match(await page.locator('#journal-search-status').innerText(),/1 träff av 12 inlästa/);
    assert.equal(await correctionReason.inputValue(),'Utkast till rättelse som ska bevaras vid sökning');

    await search.fill('1930');
    assert.equal(await page.locator('[data-entry]').count(),12,'search matches account in journal lines');
    await search.fill('Browser test entry 7');
    assert.equal(await page.locator('[data-entry]').count(),1,'search matches description');
    assert.equal(await page.locator('[data-entry]').first().getAttribute('data-entry'),'scroll-journal-7');
    await search.fill('2025-01-10');
    assert.equal(await page.locator('[data-entry]').count(),12,'search matches posting date');
    await search.fill('NO-SUCH-JOURNAL-ENTRY');
    assert.equal(await page.locator('[data-entry]').count(),0);
    assert.match(await page.locator('.journal-list').innerText(),/Inga verifikationer matchar sökningen/);
    assert.equal(await correctionReason.inputValue(),'Utkast till rättelse som ska bevaras vid sökning');
    await page.getByRole('button',{name:'Rensa sökning'}).click();
    assert.equal(await page.locator('#journal-search-field').inputValue(),'');
    assert.equal(await page.locator('[data-entry]').count(),12,'clear search restores latest journals');
    assert.equal(await page.locator('[data-entry]').first().getAttribute('data-entry'),'scroll-journal-11');
    assert.equal(await correctionReason.inputValue(),'Utkast till rättelse som ska bevaras vid sökning');
    assert.ok(await page.locator('.month-close-guide').count(),'monthly close guide stays intact');
    assert.deepEqual(errors,[],'browser should have no unhandled exceptions');
    console.log('Journal list browser regression passed: newest five, wheel scroll, expandable list, search and preserved correction draft.');
  }catch(error){
    if(page)await page.screenshot({path:path.join(__dirname,'../test-artifacts/journal-list-failure.png'),fullPage:true}).catch(()=>{});
    throw error;
  }finally{
    if(browser)await browser.close();
    if(server.listening)await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
