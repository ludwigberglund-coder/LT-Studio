'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const {buildStatic}=require('../scripts/build-static.js');

const projectRoot=path.resolve(__dirname,'..');
const root=buildStatic();
const out=path.join(projectRoot,'test-artifacts');
fs.mkdirSync(out,{recursive:true});

const demoSource=fs.readFileSync(path.join(projectRoot,'apps/portal/demo-scenario.js'),'utf8');
const version=demoSource.match(/const VERSION='([^']+)'/)?.[1];
const storageKey=demoSource.match(/const STORAGE_KEY='([^']+)'/)?.[1];
assert.ok(version&&storageKey,'Kunde inte läsa demo-scenariots version/storage key.');

function mime(file){
  return ({
    '.html':'text/html; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.json':'application/json',
    '.svg':'image/svg+xml'
  })[path.extname(file)]||'application/octet-stream';
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  let relative=decodeURIComponent(url.pathname.replace(/^\//,''));
  if(!relative||relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':'no-store'});
    res.end(data);
  });
});

const demoState={
  version,
  asOfDate:'2026-09-28',
  customers:[
    {
      id:'demo-c-settlement',
      customerNumber:'K-1001',
      name:'pelle',
      orgNumber:'123939-3454',
      email:'test@example.invalid',
      paymentTermsDays:30,
      reminderFeeAgreed:true
    }
  ],
  customerInvoices:[
    {
      id:'settlement-credit',
      kind:'customer',
      customerNumber:'K-1001',
      customerName:'pelle',
      customerOrgNumber:'123939-3454',
      invoiceNumber:'310009',
      ocr:'310009',
      invoiceDate:'2026-09-28',
      postingDate:'2026-09-28',
      dueDate:'2026-10-28',
      totalOre:-187500,
      remainingOre:-187500,
      vatOre:-37500,
      status:'Bokförd',
      paymentMethod:'Bankgiro',
      paymentAccount:'BG 123-4567',
      invoiceAccount:'1510',
      batchNumber:'10009',
      journalNumber:'F9',
      customerType:'business',
      reminderFeeAgreed:true,
      commentCount:0,
      transactions:[],
      reminders:[]
    },
    {
      id:'settlement-debit',
      kind:'customer',
      customerNumber:'K-1001',
      customerName:'pelle',
      customerOrgNumber:'123939-3454',
      invoiceNumber:'310006',
      ocr:'310006',
      invoiceDate:'2026-09-28',
      postingDate:'2026-09-28',
      dueDate:'2026-10-28',
      totalOre:18762500,
      remainingOre:18762500,
      vatOre:3752500,
      status:'Bokförd',
      paymentMethod:'Bankgiro',
      paymentAccount:'BG 123-4567',
      invoiceAccount:'1510',
      batchNumber:'10006',
      journalNumber:'F6',
      customerType:'business',
      reminderFeeAgreed:true,
      commentCount:0,
      transactions:[],
      reminders:[]
    }
  ]
};

async function waitForSettledDialog(page){
  await page.locator('.settlement-modal').waitFor({state:'visible'});
  await page.waitForFunction(()=>{
    const backdrop=document.querySelector('.modal-backdrop');
    const modal=document.querySelector('.settlement-modal');
    if(!backdrop||!modal)return false;
    return Number.parseFloat(getComputedStyle(backdrop).opacity||'1')>=0.99
      && Number.parseFloat(getComputedStyle(modal).opacity||'1')>=0.99;
  });
}

async function styleSnapshot(page){
  return page.evaluate(()=>{
    const block=document.querySelector('.settlement-block');
    const disabled=document.querySelector('.settlement-grid input:disabled');
    const label=document.querySelector('.settlement-grid label');
    const modal=document.querySelector('.settlement-modal');
    if(!block||!disabled||!label||!modal)throw new Error('Kvittningsdialogens temaytor saknas.');
    const blockStyle=getComputedStyle(block);
    const inputStyle=getComputedStyle(disabled);
    const labelStyle=getComputedStyle(label);
    const modalStyle=getComputedStyle(modal);
    return {
      theme:document.documentElement.dataset.ltTheme,
      blockBackground:blockStyle.backgroundColor,
      blockColor:blockStyle.color,
      blockBorder:blockStyle.borderTopColor,
      inputBackground:inputStyle.backgroundColor,
      inputColor:inputStyle.color,
      inputTextFill:inputStyle.webkitTextFillColor,
      labelColor:labelStyle.color,
      modalBackground:modalStyle.backgroundColor
    };
  });
}

(async()=>{
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port+'/';

    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.addInitScript(({storageKey,demoState})=>{
      localStorage.setItem(storageKey,JSON.stringify(demoState));
      localStorage.setItem('lt-studio-theme-v1','light');
    },{storageKey,demoState});

    const page=await context.newPage();
    const pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(error.message));

    const response=await page.goto(base+'portal/index.html?demo=1',{waitUntil:'networkidle',timeout:30000});
    assert.equal(response?.status(),200);

    await page.locator('.res-table').waitFor();
    await page.locator('.lt-theme-toggle-topbar').waitFor();

    const versionedAssets=await page.evaluate(()=>[...document.querySelectorAll('link[rel="stylesheet"][href],script[src]')]
      .map(node=>node.getAttribute('href')||node.getAttribute('src'))
      .filter(url=>url&&!/^(?:https?:|data:|blob:|\/\/)/i.test(url)&&/\.(?:css|js)(?:\?|$)/i.test(url)));
    assert.ok(versionedAssets.length>=6,'För få lokala CSS/JS-resurser hittades för cache-kontroll.');
    assert.ok(versionedAssets.every(url=>/[?&]v=/.test(url)),'Alla lokala CSS/JS-filer ska versionsmärkas: '+JSON.stringify(versionedAssets));

    const creditRow=page.locator('.invoice-row[data-invoice-id="settlement-credit"]');
    await creditRow.waitFor();
    await creditRow.click({button:'right'});
    await page.getByRole('button',{name:'Kvitta kreditfaktura',exact:true}).click();
    await page.getByRole('heading',{name:'Kvitta kredit mot debet',exact:true}).waitFor();
    await waitForSettledDialog(page);

    assert.equal(await page.locator('[data-settlement-target]').inputValue(),'settlement-debit');
    assert.match(await page.locator('.settlement-modal').innerText(),/samma kund/i);
    assert.doesNotMatch(await page.locator('body').innerText(),/Rollands Frukt o Grönt AB/i);
    assert.match(await page.locator('.topbar p').innerText(),/^Demoföretag \/ Försäljning \/ Kundreskontra$/);

    const light=await styleSnapshot(page);
    assert.equal(light.theme,'light');
    assert.equal(light.blockBackground,'rgb(255, 255, 255)');
    assert.equal(light.inputBackground,'rgb(238, 241, 236)');
    assert.equal(light.inputColor,'rgb(77, 91, 85)');
    assert.equal(light.inputTextFill,'rgb(77, 91, 85)');
    assert.equal(light.labelColor,'rgb(95, 109, 102)');
    await page.screenshot({path:path.join(out,'settlement-theme-light.png'),fullPage:false});

    // Modalen ligger avsiktligt ovanpå toppbaren. Stäng den, byt tema som en
    // användare gör i portalen och öppna samma kvittning igen.
    await page.getByRole('button',{name:'Avbryt',exact:true}).click();
    await page.locator('.lt-theme-toggle-topbar').click();
    await page.waitForFunction(()=>document.documentElement.dataset.ltTheme==='dark');
    await creditRow.click({button:'right'});
    await page.getByRole('button',{name:'Kvitta kreditfaktura',exact:true}).click();
    await page.getByRole('heading',{name:'Kvitta kredit mot debet',exact:true}).waitFor();
    await waitForSettledDialog(page);

    const dark=await styleSnapshot(page);
    assert.equal(dark.theme,'dark');
    assert.equal(dark.blockBackground,'rgb(45, 51, 59)');
    assert.equal(dark.inputBackground,'rgb(55, 62, 71)');
    assert.equal(dark.inputColor,'rgb(255, 255, 255)');
    assert.equal(dark.inputTextFill,'rgb(255, 255, 255)');
    assert.equal(dark.labelColor,'rgb(220, 228, 236)');
    assert.notEqual(dark.blockBackground,light.blockBackground);
    assert.notEqual(dark.inputBackground,light.inputBackground);
    assert.notEqual(dark.labelColor,light.labelColor);
    await page.screenshot({path:path.join(out,'settlement-theme-dark.png'),fullPage:false});

    await page.getByRole('button',{name:'Avbryt',exact:true}).click();
    await page.locator('.lt-theme-toggle-topbar').click();
    await page.waitForFunction(()=>document.documentElement.dataset.ltTheme==='light');
    await creditRow.click({button:'right'});
    await page.getByRole('button',{name:'Kvitta kreditfaktura',exact:true}).click();
    await page.getByRole('heading',{name:'Kvitta kredit mot debet',exact:true}).waitFor();
    await waitForSettledDialog(page);
    const lightAgain=await styleSnapshot(page);
    assert.equal(lightAgain.blockBackground,light.blockBackground);
    assert.equal(lightAgain.inputBackground,light.inputBackground);
    assert.deepEqual(pageErrors,[]);

    console.log('Settlement theme browser OK: dialog follows light/dark toggle and built assets are versioned.');
    await context.close();
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
