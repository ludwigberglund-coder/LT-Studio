const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
const automationTarget=`./automation.html${isDemo?'?demo=1':''}`;
const bankTarget=`./bank.html${isDemo?'?demo=1':''}`;

function addPortalLinks(){
  const groups=[...document.querySelectorAll('.side-group')];
  const economy=groups.find(group=>group.querySelector('span')?.textContent.trim()==='Ekonomi');
  if(economy){
    const bankButton=[...economy.querySelectorAll('.side-link')].find(node=>node.textContent.trim()==='Bank & avstämning');
    if(bankButton&&!bankButton.dataset.bankLink){
      bankButton.dataset.bankLink='1';
      bankButton.classList.remove('disabled');
      bankButton.addEventListener('click',()=>{location.href=bankTarget});
    }
    if(!economy.querySelector('[data-automation-link]')){
      const button=document.createElement('button');
      button.type='button';
      button.className='side-link';
      button.dataset.automationLink='1';
      button.textContent='Automationskö';
      button.addEventListener('click',()=>{location.href=automationTarget});
      const reports=[...economy.querySelectorAll('.side-link')].find(node=>node.textContent.trim()==='Rapporter');
      if(reports)economy.insertBefore(button,reports);else economy.append(button);
    }
  }
  const chip=document.querySelector('.user-chip');
  if(chip&&!chip.querySelector('[data-automation-toplink]')){
    const button=document.createElement('button');
    button.type='button';
    button.className='button ghost small';
    button.dataset.automationToplink='1';
    button.textContent='Automationskö';
    button.addEventListener('click',()=>{location.href=automationTarget});
    chip.insertBefore(button,chip.lastElementChild||null);
  }
}

const observer=new MutationObserver(()=>addPortalLinks());
observer.observe(document.getElementById('portal-app'),{childList:true,subtree:true});
addPortalLinks();
