(function(){
  'use strict';
  const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
  const Demo=globalThis.RollandsDemoScenario;
  const Workflows=globalThis.RollandsDemoWorkflows;
  const originalFetch=globalThis.fetch.bind(globalThis);
  globalThis.fetch=(input,init)=>{
    if(typeof input==='string'&&/\/api\/v1\/payables\/payments\/[^/]+\/confirm$/.test(input))input=`${input}-post`;
    return originalFetch(input,init);
  };
  function selectedId(){return document.querySelector('.queue-row.selected[data-invoice-id]')?.dataset.invoiceId||''}
  async function api(path,options={}){const csrf=sessionStorage.getItem('rollands-csrf')||'';const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'&&csrf?{'X-CSRF-Token':csrf}:{})};const response=await originalFetch(`/api/v1${path}`,{credentials:'same-origin',...options,headers,body:options.body?JSON.stringify(options.body):undefined});const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||'Begäran misslyckades.');error.code=data.code;throw error}return data}
  function setMessage(message){const main=document.querySelector('.content');if(!main)return;let box=main.querySelector('[data-accounting-flow-message]');if(!box){box=document.createElement('div');box.className='notice';box.dataset.accountingFlowMessage='1';main.prepend(box)}box.textContent=message}
  async function invoiceState(id){if(isDemo){const invoice=Demo?.state().supplierInvoices.find(row=>row.id===id);return invoice||null}return (await api(`/payables/invoices/${encodeURIComponent(id)}`)).invoice}
  async function refreshControls(){
    const actions=document.querySelector('.coding-actions');const id=selectedId();if(!actions||!id)return;
    let invoice;try{invoice=await invoiceState(id)}catch{return}
    actions.querySelector('[data-accounting-post]')?.remove();
    const prepare=actions.querySelector('[data-action="prepare-payment"]');
    if(invoice?.status==='approved'&&!invoice.liabilityPosted&&!invoice.liabilityAccountingEntryId){
      if(prepare)prepare.hidden=true;
      const button=document.createElement('button');button.type='button';button.className='button';button.dataset.accountingPost='1';button.textContent='Bokför leverantörsskuld';actions.prepend(button);
    }else if(prepare)prepare.hidden=false;
  }
  async function postInvoice(){
    const id=selectedId();if(!id)throw new Error('Välj en faktura först.');
    if(isDemo){if(!Workflows?.postSupplierInvoice)throw new Error('Demoflödet för fakturabokföring saknas.');Workflows.postSupplierInvoice(id);setMessage('Leverantörsskulden är bokförd i demon. Nu kan betalningen förberedas.');await refreshControls();return}
    const result=await api(`/payables/invoices/${encodeURIComponent(id)}/post`,{method:'POST',body:{}});setMessage(result.message||`Leverantörsskulden är bokförd som ${result.entry?.number||'verifikation'}.`);await refreshControls();
  }
  async function approveOnly(){
    const id=selectedId();if(!id)throw new Error('Välj en faktura först.');
    if(isDemo){const invoice=Demo?.state().supplierInvoices.find(row=>row.id===id);if(!invoice)throw new Error('Fakturan hittades inte.');Demo.patch(next=>{const target=next.supplierInvoices.find(row=>row.id===id);target.status='approved';target.approvedBy='demo-approver'});location.reload();return}
    await api(`/payables/invoices/${encodeURIComponent(id)}/approve`,{method:'POST',body:{}});location.reload();
  }
  function demoPrepare(){const id=selectedId();if(!id)throw new Error('Välj en faktura först.');Workflows.prepareSupplierPayment(id);location.reload()}
  function demoRelease(paymentId){Workflows.releaseSupplierPayment(paymentId);location.reload()}
  function demoConfirm(paymentId){Workflows.confirmSupplierPayment(paymentId,`DEMO-${paymentId}`);location.reload()}
  document.addEventListener('click',async event=>{
    const post=event.target.closest('[data-accounting-post]');if(post){event.preventDefault();event.stopImmediatePropagation();post.disabled=true;try{await postInvoice()}catch(error){setMessage(error.message)}finally{post.disabled=false}return}
    const approve=event.target.closest('[data-action="approve"]');if(approve){event.preventDefault();event.stopImmediatePropagation();approve.disabled=true;try{await approveOnly()}catch(error){setMessage(error.message)}finally{approve.disabled=false}return}
    if(isDemo){
      const prepare=event.target.closest('[data-action="prepare-payment"]');if(prepare){event.preventDefault();event.stopImmediatePropagation();try{demoPrepare()}catch(error){setMessage(error.message)}return}
      const release=event.target.closest('[data-action="release-payment"]');if(release){event.preventDefault();event.stopImmediatePropagation();try{demoRelease(release.dataset.paymentId)}catch(error){setMessage(error.message)}return}
      const confirm=event.target.closest('[data-action="confirm-payment"]');if(confirm){event.preventDefault();event.stopImmediatePropagation();try{demoConfirm(confirm.dataset.paymentId)}catch(error){setMessage(error.message)}}
    }
  },true);
  const observer=new MutationObserver(()=>{refreshControls().catch(()=>{})});
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
