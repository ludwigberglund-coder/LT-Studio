const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '../public');
const server = http.createServer((req,res)=>{
  const name = new URL(req.url, 'http://localhost').pathname;
  if (name.startsWith('/api/')) {res.writeHead(404,{'Content-Type':'application/json'});res.end('{}');return;}
  const file=path.join(root,name==='/'?'index.html':name);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(error?'Missing':data);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true, channel:'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/#/res-tools');
    await page.getByRole('heading',{name:'Reskontraverktyg',exact:true}).waitFor();
    await page.evaluate(()=>{
      const base={customer:'Testkund AB',customerNumber:'K-9000',date:'2026-01-01',dueDate:'2026-01-31',status:'Bokförd',payments:[]};
      state.invoices=[{...base,id:'a',number:'310001',ocr:'310001',batchNumber:'1001',total:100,payments:[{id:'p',amount:100,date:'2026-01-02',batch:'1000',journalNumber:'A1'}]},{...base,payments:[],id:'b',number:'310002',ocr:'310002',batchNumber:'1002',total:100},{...base,payments:[],id:'c',number:'310003',ocr:'310003',batchNumber:'1003',total:-20,credit:true}];
      state.journal=[{id:'j',number:'A1',batchNumber:'1000',date:'2026-01-02',description:'Inbetalning 310001',source:'Registrerad betalning',rows:[{account:'1930',debit:100,credit:0},{account:'1510',debit:0,credit:100}]}];
      state.bankTransactions=[];state.settings.lockedPeriods=[];state=F.normalize(state);persistDemoState();render();
    });
    const move=page.locator('form[data-kind="reclassify"]');
    await move.locator('[name="sourceBatch"]').fill('1000');
    await move.locator('[name="targetInvoice"]').fill('310002');
    await move.getByRole('button',{name:'Granska omföring'}).click();
    await page.getByRole('button',{name:'Bokför & skapa bunt'}).click();
    await page.getByRole('heading',{name:'Bunt 1004',exact:true}).waitFor();
    await page.getByRole('button',{name:'Stäng',exact:true}).last().click();
    const offset=page.locator('form[data-kind="offset"]');
    await offset.locator('[name="creditInvoice"]').fill('1003');
    await offset.locator('[name="targetInvoice"]').fill('310001');
    await offset.getByRole('button',{name:'Granska kvittning'}).click();
    await page.getByRole('button',{name:'Bokför & skapa bunt'}).click();
    await page.getByRole('heading',{name:'Bunt 1005',exact:true}).waitFor();
    await page.reload();
    await page.getByRole('heading',{name:'Reskontraverktyg',exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>state.invoices.map(i=>F.remaining(i))),[80,0,0]);
    await page.getByRole('button',{name:'Till kundreskontran',exact:true}).click();
    await page.locator('.customer-card').click();
    const rest=await page.locator('.res-table tbody tr:not(.invoice-group) td:last-child').allTextContents();
    assert.equal(rest.filter(x=>x==='80').length,4);
    assert.equal(rest.filter(x=>x==='0').length,4);
    await page.getByRole('button',{name:'Reskontraverktyg',exact:true}).click();
    if(process.env.RECEIVABLES_SCREENSHOT)await page.screenshot({path:process.env.RECEIVABLES_SCREENSHOT,fullPage:true});
    await page.evaluate(()=>{
      state.bankTransactions=[{id:'cost-bank',date:'2026-01-05',amount:-10,text:'Testkostnad',transactionRef:'COST-TEST',status:'Granska',proposal:'Test'}];
      page='review';activeModal={type:'transaction',id:'cost-bank'};render();
    });
    const supplierIds=await page.locator('[name="invoiceNumber"] option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
    assert.ok(!supplierIds.includes('a') && !supplierIds.includes('b'));
    const accounts=await page.locator('[name="account"] option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
    assert.ok(accounts.length>5 && accounts.every(v=>/^(?:[4-7]\d{3}|84\d{2})\s/.test(v)));
    await page.locator('[name="account"]').selectOption(accounts[0]);
    await page.getByRole('button',{name:'Bokför verifikation',exact:true}).click();
    await page.waitForFunction(()=>state.bankTransactions[0].status==='Bokförd');
    assert.equal(await page.evaluate(()=>state.journal[0].rows[1].credit),10);
    await page.evaluate(()=>{
      state.bankTransactions.push({id:'revenue-bank',date:'2026-01-05',amount:10,text:'Testintäkt',transactionRef:'REVENUE-TEST',status:'Granska',proposal:'Test'});
      activeModal={type:'transaction',id:'revenue-bank'};render();
    });
    const customerIds=await page.locator('[name="invoiceNumber"] option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
    assert.deepEqual(customerIds,['a']);
    const revenues=await page.locator('[name="account"] option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
    assert.ok(revenues.length>0 && revenues.every(v=>/^3\d{3}\s/.test(v)));
    await page.locator('[name="invoiceNumber"]').selectOption('a');
    await page.getByRole('button',{name:'Bokför verifikation',exact:true}).click();
    await page.waitForFunction(()=>state.bankTransactions[1].status==='Matchad');
    assert.equal(await page.evaluate(()=>state.bankTransactions[1].invoiceKind),'customer');
    assert.equal(await page.evaluate(()=>F.remaining(state.invoices[0])),70);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log('Browser OK: omföring, kvittning, nya buntar, sparande efter omladdning, enhetliga restbelopp och mobilvy.');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
