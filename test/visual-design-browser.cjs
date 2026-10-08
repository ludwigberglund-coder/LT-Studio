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
  {id:'customers',route:'portal/customers.html?demo=1'},
  {id:'invoices',route:'portal/invoices.html?demo=1'},
  {id:'receivables',route:'portal/index.html?demo=1'},
  {id:'suppliers',route:'portal/suppliers.html?demo=1'},
  {id:'payables',route:'portal/payables.html?demo=1'},
  {id:'supplier-ledger',route:'portal/supplier-ledger.html?demo=1'},
  {id:'payments',route:'portal/payments.html?demo=1'},
  {id:'batches',route:'portal/batches.html?demo=1'},
  {id:'accounting',route:'portal/accounting.html?demo=1'},
  {id:'accounts',route:'portal/accounts.html?demo=1'},
  {id:'reports',route:'portal/reports.html?demo=1'},
  {id:'documents',route:'portal/documents.html?demo=1'},
  {id:'inventory',route:'portal/inventory.html?demo=1'},
  {id:'payroll',route:'portal/payroll.html?demo=1'},
  {id:'automation',route:'portal/automation.html?demo=1'},
  {id:'cms',route:'portal/website.html?demo=1'},
  {id:'profile',route:'portal/profile.html?demo=1'},
  {id:'company-settings',route:'portal/company-settings.html?demo=1'},
  {id:'uat',route:'portal/uat.html?demo=1'},
  {id:'project-admin',route:'admin/?demo=1#/overview'},
  {id:'legacy',route:'legacy/?demo=1#/overview'},
  {id:'website',route:'index.html'}
];
const viewports=[
  {id:'desktop',width:1440,height:1000},
  {id:'laptop',width:1024,height:900},
  {id:'tablet',width:768,height:900},
  {id:'mobile',width:390,height:844}
];
const themes=[
  {id:'light',colorScheme:'light'},
  {id:'dark',colorScheme:'dark'}
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
  const layoutIssues=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}/Rollands/`;
    browser=await chromium.launch({headless:true});

    for(const theme of themes){
      for(const viewport of viewports){
        const context=await browser.newContext({
          viewport:{width:viewport.width,height:viewport.height},
          colorScheme:theme.colorScheme
        });
        for(const surface of surfaces){
        if(surface.id==='website'&&theme.id==='dark')continue;
        const page=await context.newPage();
        const pageErrors=[];
        page.on('pageerror',error=>pageErrors.push(error.message));
        const response=await page.goto(new URL(surface.route,base).href,{waitUntil:'domcontentloaded',timeout:10000});
        if(response)assert.equal(response.status(),200,`${surface.id} ${viewport.id} returned ${response.status()}`);
        await page.waitForLoadState('load',{timeout:5000}).catch(()=>{});
        await page.waitForTimeout(250);

        const layout=await page.evaluate(()=>{
          const html=document.documentElement;
          const body=document.body;
          const side=document.querySelector('.shared-sidebar, .sidebar');
          const active=document.querySelector('.shared-navigation a[aria-current="page"], .side-nav .active, .nav-item.active');
          const styleSide=side?getComputedStyle(side):null;
          const styleActive=active?getComputedStyle(active):null;
          const glassSurface=html.dataset.ltGlassSurface||null;
          const glassChrome=document.querySelector(glassSurface==='website'
            ? '.site-header'
            : glassSurface==='operator'
              ? '.operator-shell .topbar'
              : '.topbar');
          const glassChromeStyle=glassChrome?getComputedStyle(glassChrome):null;
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
          const supplierInput=document.querySelector('.supplier-detail input');
          const supplierPrimary=document.querySelector('.supplier-detail .button:not(.ghost)');
          const supplierInputStyle=supplierInput?getComputedStyle(supplierInput):null;
          const supplierPrimaryStyle=supplierPrimary?getComputedStyle(supplierPrimary):null;
          const sharedBrand=document.querySelector('.shared-brand strong');
          const themeLabel=document.querySelector('.lt-theme-toggle-topbar .lt-theme-toggle-label');
          const themeLabelStyle=themeLabel?getComputedStyle(themeLabel):null;
          const systemHeading=document.querySelector('.system-status-heading h2');
          const systemRowStrong=document.querySelector('.system-status .system-row strong');
          const systemHeadingStyle=systemHeading?getComputedStyle(systemHeading):null;
          const systemRowStrongStyle=systemRowStrong?getComputedStyle(systemRowStrong):null;
          const projectTopbar=document.querySelector('.admin-shell .topbar');
          const firstInvoiceRow=document.querySelector('.invoice-list-panel .sales-table tbody tr:not(.invoice-empty-row)');
          const firstInvoiceCell=firstInvoiceRow?.querySelector('td[data-label]');
          const invoiceThead=document.querySelector('.invoice-list-panel .sales-table thead');
          const projectTopbarRect=projectTopbar?.getBoundingClientRect();
          const invoiceTheadRect=invoiceThead?.getBoundingClientRect();
          const legacyToast=document.querySelector('#toast.show');
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
            theme:document.documentElement.dataset.ltTheme||null,
            scrollWidth:Math.max(html.scrollWidth,body.scrollWidth),
            innerWidth:window.innerWidth,
            bodyText:body.innerText.trim().length,
            visibleControls,
            fontFamily:bodyStyle.fontFamily,
            bodyBackground:bodyStyle.backgroundColor,
            sidebarBackground:styleSide?.backgroundColor||null,
            activeBackground:styleActive?.backgroundColor||null,
            activeColor:styleActive?.color||null,
            glassSurface,
            glassChromeBackgroundImage:glassChromeStyle?.backgroundImage||null,
            glassChromeShadow:glassChromeStyle?.boxShadow||null,
            glassChromeBorderTopWidth:glassChromeStyle?.borderTopWidth||null,
            sharedUserDisplay:sharedUserStyle?.display||null,
            sharedUserBorderTopWidth:sharedUserStyle?.borderTopWidth||null,
            sharedAvatarWidth:sharedAvatarStyle?.width||null,
            cmsFormPaddingTop:cmsFormStyle?.paddingTop||null,
            cmsFormPaddingLeft:cmsFormStyle?.paddingLeft||null,
            cmsSidePaddingTop:cmsSideStyle?.paddingTop||null,
            supplierDividerBorderTopColor:supplierDividerStyle?.borderTopColor||null,
            supplierInputColor:supplierInputStyle?.color||null,
            supplierInputTextFill:supplierInputStyle?.webkitTextFillColor||null,
            supplierPrimaryColor:supplierPrimaryStyle?.color||null,
            supplierPrimaryBackground:supplierPrimaryStyle?.backgroundColor||null,
            sharedBrandText:sharedBrand?.textContent?.trim()||null,
            themeLabelDisplay:themeLabelStyle?.display||null,
            systemHeadingColor:systemHeadingStyle?.color||null,
            systemRowStrongColor:systemRowStrongStyle?.color||null,
            projectTopbarHeight:projectTopbarRect?Math.round(projectTopbarRect.height):null,
            invoiceMobileCard:Boolean(firstInvoiceCell?.dataset?.label)&&Boolean(invoiceTheadRect&&invoiceTheadRect.width<=2),
            legacyToastVisible:Boolean(legacyToast),
            dashboardHeroGap,
            overflowing,
            iconizedMetrics:document.querySelectorAll('.metric.ui-with-icon,.stat-button.ui-with-icon').length
          };
        });

        if(surface.id!=='website')assert.equal(layout.theme,theme.id,`${surface.id} ${viewport.id} did not apply ${theme.id} mode`);
        assert.ok(layout.bodyText>80,`${surface.id} ${viewport.id} ${theme.id} rendered too little content`);
        assert.ok(layout.visibleControls>0,`${surface.id} ${viewport.id} ${theme.id} has no visible controls`);
        if(layout.scrollWidth>layout.innerWidth+2)layoutIssues.push(`${surface.id} ${viewport.id} ${theme.id} has page-level horizontal overflow: ${layout.scrollWidth}px > ${layout.innerWidth}px; offenders=${JSON.stringify(layout.overflowing)}`);
        assert.match(layout.fontFamily,/(-apple-system|BlinkMacSystemFont|SF Pro|system-ui)/i,`${surface.id} ${viewport.id} is not using the shared Apple/system font stack`);
        assert.equal(pageErrors.length,0,`${surface.id} ${viewport.id} has uncaught browser errors: ${pageErrors.join('; ')}`);
        assert.equal(layout.iconizedMetrics,0,`${surface.id} ${viewport.id} metric cards must not be converted into inline icon buttons`);

        /* Prevent shipping visually invisible glass again: inspect real computed CSS. */
        if(viewport.id==='desktop'&&['dashboard','project-admin','website'].includes(surface.id)){
          const expectedSurface=surface.id==='dashboard'?'portal':surface.id==='website'?'website':'operator';
          assert.equal(layout.glassSurface,expectedSurface,`${surface.id} glass styling is not installed`);
          assert.match(layout.glassChromeBackgroundImage||'',/radial-gradient/i,`${surface.id} no visible refraction on the toolbar`);
          assert.notEqual(layout.glassChromeShadow,'none',`${surface.id} toolbar lacks floating depth`);
          assert.ok(parseFloat(layout.glassChromeBorderTopWidth)>=1,`${surface.id} toolbar lacks a visible rim`);
        }
        if(layout.sidebarBackground){
          assert.notEqual(layout.sidebarBackground,'rgb(20, 60, 48)',`${surface.id} ${viewport.id} leaked the old green sidebar`);
        }
        if(layout.sharedBrandText){
          assert.equal(layout.sharedBrandText,'LT Studio',`${surface.id} ${viewport.id} shows outdated workspace branding: ${layout.sharedBrandText}`);
        }
        if(layout.themeLabelDisplay){
          assert.equal(layout.themeLabelDisplay,'none',`${surface.id} ${viewport.id} topbar appearance label must not overlap adjacent controls`);
        }
        if(surface.id==='project-admin'&&layout.systemHeadingColor){
          assert.equal(layout.systemHeadingColor,'rgb(255, 255, 255)',`${viewport.id} project admin system heading lost contrast`);
          assert.equal(layout.systemRowStrongColor,'rgb(255, 255, 255)',`${viewport.id} project admin status values lost contrast`);
          if(viewport.id==='mobile')assert.ok(layout.projectTopbarHeight<=150,`project admin mobile topbar is too tall: ${layout.projectTopbarHeight}px`);
        }
        if(surface.id==='invoices'&&viewport.id==='mobile'){
          assert.equal(layout.invoiceMobileCard,true,'mobile customer invoices must render as labeled stacked rows');
        }
        if(surface.id==='legacy'){
          assert.equal(layout.legacyToastVisible,false,`${viewport.id} legacy demo notice must not cover working content on initial load`);
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
          const expectedDivider=theme.id==='dark'?'rgb(68, 76, 86)':'rgb(229, 229, 229)';
          assert.equal(layout.supplierDividerBorderTopColor,expectedDivider,`${viewport.id} ${theme.id} legacy supplier alert leaked an incorrect divider color`);
        }
        if(surface.id==='suppliers'&&theme.id==='dark'){
          assert.equal(layout.supplierInputColor,'rgb(255, 255, 255)',`${viewport.id} supplier input text lost dark-mode contrast`);
          assert.equal(layout.supplierInputTextFill,'rgb(255, 255, 255)',`${viewport.id} supplier input text fill lost dark-mode contrast`);
          assert.equal(layout.supplierPrimaryColor,'rgb(34, 39, 46)',`${viewport.id} supplier primary button text must stay dark on the pale accent surface`);
        }

        const file=`visual-${surface.id}-${viewport.id}-${theme.id}.png`;
        await page.screenshot({path:path.join(out,file),fullPage:false});
        checks.push({surface:surface.id,viewport:viewport.id,theme:theme.id,...layout,screenshot:file});
        await page.close();
        }
        await context.close();
      }
    }

    if(layoutIssues.length)throw new Error(`Visual layout issues:\n${layoutIssues.join('\n')}`);
    fs.writeFileSync(path.join(out,'visual-design-results.json'),JSON.stringify({ok:true,checks,errors},null,2));
    console.log(`Visual design smoke passed: ${checks.length} rendered viewport/theme checks (public website is theme-neutral).`);
  }catch(error){
    errors.push(error.stack||String(error));
    fs.writeFileSync(path.join(out,'visual-design-results.json'),JSON.stringify({ok:false,checks,errors},null,2));
    throw error;
  }finally{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
