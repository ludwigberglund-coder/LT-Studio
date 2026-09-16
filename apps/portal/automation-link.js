const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
const target=`./automation.html${isDemo?'?demo=1':''}`;

function addAutomationLinks(){
  const groups=[...document.querySelectorAll('.side-group')];
  const economy=groups.find(group=>group.querySelector('span')?.textContent.trim()==='Ekonomi');
  if(economy&&!economy.querySelector('[data-automation-link]')){
    const button=document.createElement('button');
    button.type='button';
    button.className='side-link';
    button.dataset.automationLink='1';
    button.textContent='Automationskö';
    button.addEventListener('click',()=>{location.href=target});
    const reports=[...economy.querySelectorAll('.side-link')].find(node=>node.textContent.trim()==='Rapporter');
    if(reports)economy.insertBefore(button,reports);else economy.append(button);
  }
  const chip=document.querySelector('.user-chip');
  if(chip&&!chip.querySelector('[data-automation-toplink]')){
    const button=document.createElement('button');
    button.type='button';
    button.className='button ghost small';
    button.dataset.automationToplink='1';
    button.textContent='Automationskö';
    button.addEventListener('click',()=>{location.href=target});
    chip.insertBefore(button,chip.lastElementChild||null);
  }
}

const observer=new MutationObserver(()=>addAutomationLinks());
observer.observe(document.getElementById('portal-app'),{childList:true,subtree:true});
addAutomationLinks();
