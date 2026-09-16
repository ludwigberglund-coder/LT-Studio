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
    if(economy&&!sidebar.querySelector('a[href*="suppliers.html"]')){
      const automation=economy.querySelector('a[href*="automation.html"]');const link=document.createElement('a');link.className='side-link';link.href=`./suppliers.html${suffix}`;link.textContent='Leverantörer';if(automation)economy.insertBefore(link,automation);else economy.append(link);
    }
    if(economy&&!sidebar.querySelector('a[href*="inventory.html"]')){
      const automation=economy.querySelector('a[href*="automation.html"]');const link=document.createElement('a');link.className='side-link';link.href=`./inventory.html${suffix}`;link.textContent='Lager';if(automation)economy.insertBefore(link,automation);else economy.append(link);
    }
    return true;
  }
  if(!enhance()){const observer=new MutationObserver(()=>{if(enhance())observer.disconnect()});observer.observe(document.documentElement,{childList:true,subtree:true})}
})();
