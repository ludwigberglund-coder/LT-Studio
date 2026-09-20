'use strict';
(function(root){
  const groups=[
    {id:'workspace',label:'Arbetsyta',items:[['overview','Översikt','portal/dashboard.html']]},
    {id:'economy',label:'Ekonomi',items:[
      ['invoices','Kundfakturor','portal/invoices.html'],['receivables','Kundreskontra','portal/receivables.html'],
      ['receivables-details','Reskontradetaljer & påminnelser','portal/index.html'],
      ['payables','Leverantörsfakturor & reskontra','portal/payables.html'],['payments','Betalningar','portal/payments.html'],['bank','Bank & avstämning','portal/bank.html'],
      ['automation','Automationskö','portal/automation.html'],['accounting','Bokföring','portal/accounting.html'],
      ['reports','Rapporter','portal/reports.html'],['accounts','Kontoplan & intäktskonton','portal/accounts.html'],
      ['payroll','Lön & lönejournal','portal/payroll.html'],['money','Öreskalkylator','admin/#/money'],
      ['journal','Verifikationer & periodtest','admin/#/journal'],
      ['res-tools','Reskontraverktyg (äldre demo)','legacy/#/res-tools'],['batches','Buntar (äldre demo)','legacy/#/batches'],
      ['inbox','Fakturainkorg (äldre demo)','legacy/#/inbox']
    ]},
    {id:'operations',label:'Register & verksamhet',items:[['customers','Kunder','portal/customers.html'],['suppliers','Leverantörer','portal/suppliers.html'],['inventory','Lager & svinn','portal/inventory.html']]},
    {id:'administration',label:'Systemadministration',items:[
      ['website','Webbplats & innehåll','portal/website.html'],['documents','Dokument','portal/documents.html'],
      ['access','Inloggning & företag','admin/#/access'],['decisions','Verksamhetsbeslut','admin/#/decisions'],
      ['modules','Systemmoduler','admin/#/modules'],['project','Projektöversikt','admin/#/overview'],
      ['content','Innehållsförhandsvisning','admin/#/content'],
      ['audit','Revisionslogg (äldre demo)','legacy/#/audit'],['settings','Inställningar (äldre demo)','legacy/#/settings']
    ]},
    {id:'help',label:'Test & hjälp',items:[['uat','Testa systemet','portal/uat.html'],['legacy','Tidigare system','legacy/#/overview'],['assistant','Hjälp & chatbot (äldre demo)','legacy/#/assistant']]}
  ];
  const demoOnlyIds=new Set(['money','journal','res-tools','batches','inbox','audit','settings','legacy','assistant','access','decisions','modules','project','content','uat','receivables-details']);
  function visibleGroups({authenticated=false,demo=false}={}){
    if(demo)return groups;
    if(!authenticated)return [];
    return groups.map(group=>({...group,items:group.items.filter(([id])=>!demoOnlyIds.has(id)).map(item=>item[0]==='receivables'?[item[0],item[1],'portal/index.html']:item)})).filter(group=>group.items.length);
  }
  if(typeof module==='object'&&module.exports){module.exports={groups,visibleGroups};return;}
  if(root.RollandsNavigation)return;
  const base=new URL('../',document.currentScript.src);
  const demo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
  const key='rollands-navigation-v2:'+base.pathname;
  const runtimeKey='rollands-runtime-id:'+base.pathname;
  let runtimeCheckInFlight=false;
  async function ensureFreshRuntime(){
    if(demo||runtimeCheckInFlight)return false;
    runtimeCheckInFlight=true;
    try{
      const response=await fetch('/_runtime-version',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)return false;
      const data=await response.json();
      const runtimeId=String(data.runtimeId||'');
      if(!runtimeId)return false;
      const previous=sessionStorage.getItem(runtimeKey);
      sessionStorage.setItem(runtimeKey,runtimeId);
      if(previous&&previous!==runtimeId){location.reload();return true;}
    }catch{}
    finally{runtimeCheckInFlight=false;}
    return false;
  }
  function read(){try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return {}}}
  function persist(value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
  function href(path){const u=new URL(path,base);if(demo&&path!=='./')u.searchParams.set('demo','1');return u.href;}
  const normalizePath=path=>path.replace(/\/index\.html$/,'/');
  function active(path){const u=new URL(path,base);return normalizePath(u.pathname)===normalizePath(location.pathname)&&(!u.hash||u.hash===(location.hash||'#/overview'));}
  async function navigationContext(){
    if(demo)return{groups,session:null};
    try{
      const response=await fetch('/api/v1/session',{credentials:'same-origin',cache:'no-store'});
      const session=response.ok?await response.json():null;
      return{groups:visibleGroups({authenticated:session?.authenticated===true}),session};
    }catch{return{groups:[],session:null}}
  }
  async function mount(){
    const sidebar=document.querySelector('.sidebar');if(!sidebar)return;
    const route=location.pathname+location.hash;
    if(sidebar.dataset.sharedRoute===route&&sidebar.querySelector('.shared-navigation'))return;
    sidebar.classList.add('shared-sidebar');sidebar.parentElement.classList.add('shared-workspace-shell');
    sidebar.setAttribute('aria-label','Huvudmeny');sidebar.dataset.sharedRoute=route;
    const saved=read();
    const context=await navigationContext();const allowedGroups=context.groups;
    const brand=document.createElement('a');brand.className='shared-brand';brand.href=href('portal/dashboard.html');
    const companyName=demo?'Rollands':String(context.session?.company?.name||'Företaget');
    const brandName=document.createElement('strong');brandName.textContent=companyName;
    const brandPlatform=document.createElement('small');brandPlatform.textContent='LT STUDIO';brand.append(brandName,brandPlatform);
    const info=document.createElement('p');info.className='shared-company';info.textContent=demo?'Demoföretag · fiktiv data':companyName+' · skyddad företagsportal';
    const nav=document.createElement('nav');nav.className='shared-navigation';nav.setAttribute('aria-label','Systemets alla verktyg');
    for(const group of allowedGroups){
      const details=document.createElement('details');details.dataset.navGroup=group.id;
      details.open=group.items.some(item=>active(item[2]))||saved[group.id]!==false;
      const summary=document.createElement('summary');summary.textContent=group.label;details.append(summary);
      const links=document.createElement('div');links.className='shared-links';
      for(const [id,label,path] of group.items){
        const a=document.createElement('a');a.dataset.navId=id;a.textContent=label;a.href=href(path);
        if(active(path)){a.setAttribute('aria-current','page');a.classList.add('active');}links.append(a);
      }
      details.append(links);nav.append(details);
      details.addEventListener('toggle',()=>{const s=read();s[group.id]=details.open;persist(s);});
    }
    const foot=document.createElement('div');foot.className='shared-foot';
    const home=document.createElement('a');home.href=href(demo?'./':'portal/dashboard.html');home.textContent=demo?'Visa företagets hemsida':'Till arbetsöversikten';foot.append(home);
    const note=document.createElement('p');note.textContent=demo?'Äldre referensverktyg har separat demodata.':'Alla medlemmar i företaget har samma verktyg. Servern kontrollerar varje skyddad åtgärd.';foot.append(note);
    sidebar.replaceChildren(brand,info,nav,foot);
    try{sidebar.scrollTop=Number(sessionStorage.getItem(key+':scroll')||0)}catch{}
    if(!sidebar.dataset.scrollBound){sidebar.addEventListener('scroll',()=>{try{sessionStorage.setItem(key+':scroll',String(sidebar.scrollTop))}catch{}});sidebar.dataset.scrollBound='1';}
  }
  let pending=false;
  function schedule(){if(pending)return;pending=true;queueMicrotask(async()=>{pending=false;await mount();});}
  // Renders can replace the entire sidebar. Stay subscribed instead of disconnecting after boot.
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  addEventListener('hashchange',schedule);
  addEventListener('pageshow',()=>{schedule();ensureFreshRuntime();});
  addEventListener('focus',ensureFreshRuntime);
  addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')ensureFreshRuntime();});
  setInterval(ensureFreshRuntime,30000);
  root.RollandsNavigation={groups,mount,href};ensureFreshRuntime();mount();
})(globalThis);
