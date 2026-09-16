(function(){
  const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
  const suffix=isDemo?'?demo=1':'';
  function enhance(){
    const sidebar=document.querySelector('.sidebar');if(!sidebar)return false;
    if(!sidebar.querySelector('a[href*="dashboard.html"]')){
      const group=document.createElement('div');group.className='side-group unified-overview';group.innerHTML=`<span>Arbetsyta</span><a class="side-link" href="./dashboard.html${suffix}">Översikt</a>`;
      const company=sidebar.querySelector('.company-pill');if(company)company.after(group);else sidebar.prepend(group);
    }
    const economy=[...sidebar.querySelectorAll('.side-group')].find(g=>/Ekonomi/i.test(g.querySelector('span')?.textContent||''));
    const addBeforeAutomation=(href,label)=>{if(!economy||sidebar.querySelector(`a[href*="${href}"]`))return;const automation=economy.querySelector('a[href*="automation.html"]');const link=document.createElement('a');link.className='side-link';link.href=`./${href}${suffix}`;link.textContent=label;if(automation)economy.insertBefore(link,automation);else economy.append(link)};
    addBeforeAutomation('suppliers.html','Leverantörer');
    addBeforeAutomation('inventory.html','Lager');
    addBeforeAutomation('accounting.html','Bokföring');
    addBeforeAutomation('reports.html','Rapporter');
    addBeforeAutomation('payroll.html','Lön');
    addBeforeAutomation('documents.html','Dokument');
    if(!sidebar.querySelector('a[href*="website.html"]')){const group=document.createElement('div');group.className='side-group unified-admin';group.innerHTML=`<span>Administration</span><a class="side-link" href="./website.html${suffix}">Webbplats & innehåll</a>`;const footer=sidebar.querySelector('.sidebar-footer');if(footer)sidebar.insertBefore(group,footer);else sidebar.append(group)}
    return true;
  }
  if(!enhance()){const observer=new MutationObserver(()=>{if(enhance())observer.disconnect()});observer.observe(document.documentElement,{childList:true,subtree:true})}
})();
