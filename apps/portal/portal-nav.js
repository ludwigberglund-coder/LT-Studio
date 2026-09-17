'use strict';
(function(root){
  // One registry for every portal, project-admin and legacy workspace.
  const groups=[
    {id:'workspace',label:'Arbetsyta',items:[['overview','Översikt','portal/dashboard.html'],['uat','Testa systemet','portal/uat.html']]},
    {id:'economy',label:'Ekonomi',items:[
      ['invoices','Kundfakturor','portal/invoices.html'],['receivables','Kundreskontra','portal/receivables.html'],
      ['receivables-details','Reskontradetaljer & påminnelser','portal/index.html'],
      ['payables','Leverantörsfakturor & reskontra','portal/payables.html'],['bank','Bank & avstämning','portal/bank.html'],
      ['automation','Automationskö','portal/automation.html'],['accounting','Bokföring','portal/accounting.html'],
      ['reports','Rapporter','portal/reports.html'],['accounts','Kontoplan','portal/accounts.html'],
      ['money','Öreskalkylator','admin/#/money'],['journal','Verifikationer & periodtest','admin/#/journal']
    ]},
    {id:'operations',label:'Register & verksamhet',items:[['customers','Kunder','portal/customers.html'],['suppliers','Leverantörer','portal/suppliers.html'],['inventory','Lager & svinn','portal/inventory.html']]},
    {id:'personnel',label:'Personal',items:[['payroll','Lön & lönejournal','portal/payroll.html']]},
    {id:'administration',label:'Systemadministration',items:[
      ['website','Webbplats & innehåll','portal/website.html'],['documents','Dokument','portal/documents.html'],
      ['access','Roller & behörigheter','admin/#/access'],['decisions','Verksamhetsbeslut','admin/#/decisions'],
      ['modules','Systemmoduler','admin/#/modules'],['project','Projektöversikt','admin/#/overview'],
      ['content','Innehållsförhandsvisning','admin/#/content']
    ]},
    {id:'reference',label:'Äldre referensverktyg',items:[
      ['legacy','Tidigare system','legacy/#/overview'],['res-tools','Reskontraverktyg','legacy/#/res-tools'],
      ['batches','Buntar','legacy/#/batches'],['audit','Revisionslogg','legacy/#/audit'],
      ['inbox','Fakturainkorg','legacy/#/inbox'],['assistant','Hjälp & chatbot','legacy/#/assistant'],['settings','Äldre inställningar','legacy/#/settings']
    ]}
  ];
  if(typeof module==='object'&&module.exports){module.exports={groups};return;}
  if(root.RollandsNavigation)return;
  const script=document.currentScript;
  const base=new URL('../',script.src);
  const demo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
  const key='rollands-navigation-v2:'+base.pathname;
  const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return {}}};
  function persist(value){try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Navigation works without storage. */}}
  function href(path){const u=new URL(path,base);if(demo)u.searchParams.set('demo','1');return u.href;}
  function active(path){const u=new URL(path,base);return u.pathname===location.pathname&&(!u.hash||u.hash===(location.hash||'#/overview'));}
  function mount(){
    const sidebar=document.querySelector('.sidebar');
    if(!sidebar)return;
    const route=location.pathname+location.hash;
    if(sidebar.dataset.sharedRoute===route&&sidebar.querySelector('.shared-navigation'))return;
    const saved=read();
    sidebar.classList.add('shared-sidebar');
    sidebar.setAttribute('aria-label','Huvudmeny');
    sidebar.dataset.sharedRoute=route;
    const brand=document.createElement('a');brand.className='shared-brand';brand.href=href('portal/dashboard.html');
    brand.innerHTML='<strong>Rollands</strong><small>EKONOMI & VERKSAMHET</small>';
    const info=document.createElement('p');info.className='shared-company';info.textContent=demo?'Demoföretag · fiktiv data':'Företagsportal · behörighet kontrolleras på servern';
    const nav=document.createElement('nav');nav.className='shared-navigation';nav.setAttribute('aria-label','Systemets alla verktyg');
    for(const group of groups){
      const details=document.createElement('details');details.dataset.navGroup=group.id;
      details.open=group.items.some(item=>active(item[2]))||saved[group.id]!==false;
      const summary=document.createElement('summary');summary.textContent=group.label;details.append(summary);
      const links=document.createElement('div');links.className='shared-links';
      for(const [id,label,path] of group.items){
        const a=document.createElement('a');a.dataset.navId=id;a.textContent=label;a.href=href(path);
        if(active(path)){a.setAttribute('aria-current','page');a.classList.add('active');}
        links.append(a);
      }
      details.append(links);nav.append(details);
      details.addEventListener('toggle',()=>{const s=read();s[group.id]=details.open;persist(s);});
    }
    const foot=document.createElement('div');foot.className='shared-foot';
    const home=document.createElement('a');home.href=href('./');home.textContent='Visa företagets hemsida';foot.append(home);
    const note=document.createElement('p');note.textContent='Äldre referensverktyg har separat demodata. Menyn ger inte behörighet till skyddade data.';foot.append(note);
    sidebar.replaceChildren(brand,info,nav,foot);
    const scroll=Number(sessionStorage.getItem(key+':scroll')||0);sidebar.scrollTop=scroll;
    if(!sidebar.dataset.scrollBound){sidebar.addEventListener('scroll',()=>{try{sessionStorage.setItem(key+':scroll',String(sidebar.scrollTop))}catch{}});sidebar.dataset.scrollBound='1';}
  }
  let pending=false;
  function schedule(){if(pending)return;pending=true;queueMicrotask(()=>{pending=false;mount();});}
  // Keep observing: invoice modals, route changes and saves can replace the sidebar.
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  addEventListener('hashchange',schedule);addEventListener('pageshow',schedule);
  root.RollandsNavigation={groups,mount,href};mount();
})(globalThis);
