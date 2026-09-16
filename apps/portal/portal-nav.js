(function(){
  'use strict';
  const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
  const suffix=isDemo?'?demo=1':'';
  const page=(location.pathname.split('/').pop()||'dashboard.html').toLowerCase();
  const icons={dashboard:'⌂',customers:'♧',receivables:'↗',bank:'⇄',supplierLedger:'▤',payables:'▧',suppliers:'♙',accounting:'Σ',reports:'⌁',automation:'✦',inventory:'◇',payroll:'◎',documents:'▱',website:'◫',control:'◉',uat:'✓'};
  const groups=[
    {label:'Arbetsyta',items:[['dashboard.html','Översikt','dashboard']]},
    {label:'Försäljning',items:[['customers.html','Kunder & fakturering','customers'],['index.html','Kundreskontra','receivables']]},
    {label:'Ekonomi',items:[['bank.html','Bank & avstämning','bank'],['supplier-ledger.html','Leverantörsreskontra','supplierLedger'],['payables.html','Leverantörsfakturor','payables'],['suppliers.html','Leverantörer','suppliers'],['accounting.html','Bokföring','accounting'],['reports.html','Rapporter','reports'],['automation.html','Automationskö','automation']]},
    {label:'Verksamhet',items:[['inventory.html','Lager','inventory'],['payroll.html','Lön','payroll'],['documents.html','Dokument','documents']]},
    {label:'Administration',items:[['website.html','Webbplats & innehåll','website'],['control.html','Kontrollcenter','control']]},
    ...(isDemo?[{label:'Test & granskning',items:[['uat.html','Testa hela systemet','uat']]}]:[])
  ];
  function navLink([href,label,icon]){const active=page===href;return `<a class="side-link unified-side-link${active?' active':''}" href="./${href}${suffix}" ${active?'aria-current="page"':''}><span class="side-icon" aria-hidden="true">${icons[icon]||'·'}</span><span class="side-label">${label}</span></a>`}
  function enhance(){const sidebar=document.querySelector('.sidebar');if(!sidebar)return false;if(sidebar.dataset.unifiedNav==='v4')return true;const companyText=(sidebar.querySelector('.company-pill')?.innerText||'Rollands Frukt o Grönt AB').split('\n')[0].trim();sidebar.dataset.unifiedNav='v4';sidebar.innerHTML=`<div class="sidebar-brand"><a class="logo unified-logo" href="./dashboard.html${suffix}" aria-label="Till översikten"><strong>Rollands</strong><small>FÖRETAGSPORTAL</small></a><span class="environment-chip">${isDemo?'DEMO':'SKYDDAD'}</span></div><div class="company-pill unified-company"><span>Aktivt företag</span><strong>${companyText||'Rollands Frukt o Grönt AB'}</strong></div><nav class="sidebar-navigation" aria-label="Huvudmeny">${groups.map(group=>`<div class="side-group"><span class="side-group-title">${group.label}</span>${group.items.map(navLink).join('')}</div>`).join('')}</nav><div class="sidebar-footer"><b>Alla verktyg på samma plats.</b><span>${isDemo?'Fiktiva testdata · inga riktiga betalningar eller utskick.':'Personlig session · behörighetsstyrd åtkomst.'}</span></div>`;return true}
  let queued=false;const schedule=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;enhance()})};enhance();new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
})();
