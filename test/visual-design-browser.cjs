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

const surfaces=[
  {id:'dashboard',route:'portal/dashboard.html?demo=1'},
  {id:'invoices',route:'portal/invoices.html?demo=1'},
  {id:'cms',route:'portal/website.html?demo=1'},
  {id:'project-admin',route:'admin/?demo=1#/overview'},
  {id:'website',route:'index.html'}
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
    '.svg':'image/svg+xml'
  })[path.extname(file)]||'application/octet-stream';
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(!url.pathname.startsWith('/Rollands/')){res.writeHead(404);res.end('Not found');return;}
  let relative=decodeURIComponent(url.pathname.slice('/Rollands/'.length));
  if(!relative||relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':'no-store'});
    res.end(data);
  });
});

function visible(element){
  const style=getComputedStyle(element);
  const rect=element.getBoundingClientRect();
  return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>0&&rect.height>0;
}

(async()=>{
  let browser;
  const checks=[];
  const errors=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}/Rollands/`;
    browser=await chromium.launch({headless:true});

    for(const viewport of viewports){
      const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}});
      for(const surface of surfaces){
        const page=await context.newPage();
        const pageErrors=[];
        page.on('pageerror',error=>pageErrors.push(error.message));
        const response=await page.goto(new URL(surface.route,base).href,{waitUntil:'networkidle',timeout:20000});
        if(response)assert.equal(response.status(),200,`${surface.id} ${viewport.id} returned ${response.status()}`);
        await page.waitForTimeout(250);

        const layout=await page.evaluate(()=>{
          const html=document.documentElement;
          const body=document.body;
          const side=document.querySelector('.shared-sidebar, .sidebar');
          const active=document.querySelector('.shared-navigation a[aria-current="page"], .side-nav .active, .nav-item.active');
          const styleSide=side?getComputedStyle(side):null;
          const styleActive=active?getComputedStyle(active):null;
          const bodyStyle=getComputedStyle(body);
          const sharedUser=document.querySelector('.shared-user-trigger');
          const sharedAvatar=document.querySelector('.shared-user-avatar');
          const cmsForm=document.querySelector('.cms-form');
          const cmsSidePanel=document.querySelector('.cms-side > .panel');
          const supplierDivider=document.querySelector('.supplier-alert > div');
          const dashboardHeroParagraphs=[...document.querySelectorAll('.dash-hero p')];
          const dashboardHeroGap=dashboardHeroParagraphs.length>1
            ? dashboardHeroParagraphs[1].getBoundingClientRect().top-dashboardHeroParagraphs[0].getBoundingClientRect().bottom
            : null;
          const sharedUserStyle=sharedUser?getComputedStyle(sharedUser):null;
          const sharedAvatarStyle=sharedAvatar?getComputedStyle(sharedAvatar):null;
          const cmsFormStyle=cmsForm?getComputedStyle(cmsForm):null;
          const cmsSideStyle=cmsSidePanel?getComputedStyle(cmsSidePanel):null;
          const supplierDividerStyle=supplierDivider?getComputedStyle(supplierDivider):null;
          const rendered=[...document.querySelectorAll('body *')].filter(element=>{
            const style=getComputedStyle(element);
            const rect=element.getBoundingClientRect();
            return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>0&&rect.height>0;
          });
          const visibleControls=rendered.filter(element=>element.matches('a,button,input,select,textarea,summary')).length;
          const overflowing=rendered.map(element=>{
            const rect=element.getBoundingClientRect();
            return {
              tag:element.tagName.toLowerCase(),
              className:String(element.className||'').slice(0,100),
              text:String(element.textContent||'').trim().replace(/\\s+/g,' ').slice(0,90),
              left:Math.round(rect.left),
              right:Math.round(rect.right),
              width:Math.round(rect.width)
            };
          }).filter(item=>item.left<-2||item.right>window.innerWidth+2||item.width>window.innerWidth+2).slice(0,12);
          return {
            scrollWidth:Math.max(html.scrollWidth,body.scrollWidth),
            innerWidth:window.innerWidth,
            bodyText:body.innerText.trim().length,
            visibleControls,
            fontFamily:bodyStyle.fontFamily,
            bodyBackground:bodyStyle.backgroundColor,
            sidebarBackground:styleSide?.backgroundColor||null,
            activeBackground:styleActive?.backgroundColor||null,
            activeColor:styleActive?.color||null,
            sharedUserDisplay:sharedUserStyle?.display||null,
            sharedUserBorderTopWidth:sharedUserStyle?.borderTopWidth||null,
            sharedAvatarWidth:sharedAvatarStyle?.width||null,
            cmsFormPaddingTop:cmsFormStyle?.paddingTop||null,
            cmsFormPaddingLeft:cmsFormStyle?.paddingLeft||null,
            cmsSidePaddingTop:cmsSideStyle?.paddingTop||null,
            supplierDividerBorderTopColor:supplierDividerStyle?.borderTopColor||null,
            dashboardHeroGap,
            overflowing,
            iconizedMetrics:document.querySelectorAll('.metric.ui-with-icon,.stat-button.ui-with-icon').length
          };
        });

        assert.ok(layout.bodyText>80,`${surface.id} ${viewport.id} rendered too little content`);
        assert.ok(layout.visibleControls>0,`${surface.id} ${viewport.id} has no visible controls`);
        assert.ok(layout.scrollWidth<=layout.innerWidth+2,`${surface.id} ${viewport.id} has page-level horizontal overflow: ${layout.scrollWidth}px > ${layout.innerWidth}px; offenders=${JSON.stringify(layout.overflowing)}`);
        assert.match(layout.fontFamily,/Geist/i,`${surface.id} ${viewport.id} is not using the shared Geist stack`);
        assert.equal(pageErrors.length,0,`${surface.id} ${viewport.id} has uncaught browser errors: ${pageErrors.join('; ')}`);
        assert.equal(layout.iconizedMetrics,0,`${surface.id} ${viewport.id} metric cards must not be converted into inline icon buttons`);

        if(layout.sidebarBackground){
          assert.notEqual(layout.sidebarBackground,'rgb(20, 60, 48)',`${surface.id} ${viewport.id} leaked the old green sidebar`);
        }
        if(layout.sharedUserDisplay){
          assert.ok(['flex','inline-flex'].includes(layout.sharedUserDisplay),`${surface.id} ${viewport.id} shared account trigger lost its flex layout: ${layout.sharedUserDisplay}`);
          assert.equal(layout.sharedUserBorderTopWidth,'0px',`${surface.id} ${viewport.id} shared account trigger leaked a native button border`);
          assert.equal(layout.sharedAvatarWidth,'34px',`${surface.id} ${viewport.id} shared account avatar has the wrong size`);
        }
        if(surface.id==='dashboard'&&layout.dashboardHeroGap!==null){
          assert.ok(layout.dashboardHeroGap>=8,`${viewport.id} dashboard guide action overlaps the intro copy (gap ${layout.dashboardHeroGap}px)`);
        }
        if(surface.id==='cms'){
          assert.ok(Number.parseFloat(layout.cmsFormPaddingTop)>=16,`${viewport.id} CMS form card lost its internal padding`);
          assert.ok(Number.parseFloat(layout.cmsFormPaddingLeft)>=16,`${viewport.id} CMS form card lost its horizontal padding`);
          assert.ok(Number.parseFloat(layout.cmsSidePaddingTop)>=16,`${viewport.id} CMS side cards lost their internal padding`);
        }
        if(surface.id==='legacy'&&layout.supplierDividerBorderTopColor){
          assert.equal(layout.supplierDividerBorderTopColor,'rgb(229, 229, 229)',`${viewport.id} legacy supplier alert leaked the old amber divider`);
        }

        const file=`visual-${surface.id}-${viewport.id}.png`;
        await page.screenshot({path:path.join(out,file),fullPage:false});
        checks.push({surface:surface.id,viewport:viewport.id,...layout,screenshot:file});
        await page.close();
      }
      await context.close();
    }

    fs.writeFileSync(path.join(out,'visual-design-results.json'),JSON.stringify({ok:true,checks,errors},null,2));
    console.log(`Visual design smoke passed: ${checks.length} rendered viewport checks.`);
  }catch(error){
    errors.push(error.stack||String(error));
    fs.writeFileSync(path.join(out,'visual-design-results.json'),JSON.stringify({ok:false,checks,errors},null,2));
    throw error;
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
