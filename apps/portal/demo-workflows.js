(function(){
  'use strict';
  const Demo=globalThis.RollandsDemoScenario;
  if(!Demo)return;
  function fail(message,code){const error=new Error(message);error.code=code;throw error}
  function postSupplierInvoice(invoiceId){
    Demo.patch(state=>{
      const invoice=state.supplierInvoices.find(row=>row.id===invoiceId);
      if(!invoice)fail('Leverantörsfakturan hittades inte.','DEMO_INVOICE_NOT_FOUND');
      if(invoice.liabilityPosted||invoice.liabilityAccountingEntryId)return;
      if(invoice.status!=='approved')fail('Fakturan måste vara attesterad före bokföring.','DEMO_INVOICE_NOT_APPROVED');
      const debit=(invoice.coding||[]).reduce((sum,row)=>sum+Number(row.debitOre||0),0),credit=(invoice.coding||[]).reduce((sum,row)=>sum+Number(row.creditOre||0),0);
      if(debit!==invoice.totalOre||credit!==invoice.totalOre)fail('Konteringen balanserar inte mot fakturabeloppet.','DEMO_INVALID_CODING');
      const liability=(invoice.coding||[]).filter(row=>row.account==='2440').reduce((sum,row)=>sum+Number(row.creditOre||0)-Number(row.debitOre||0),0);
      if(liability!==invoice.totalOre)fail('Konto 2440 stämmer inte med fakturabeloppet.','DEMO_INVALID_LIABILITY');
      const used=state.accountingEntries.filter(entry=>entry.sourceType==='supplier-invoice').length;
      const entry={id:`entry-invoice-${invoice.id}`,number:`B${20+used}`,postingDate:invoice.invoiceDate,description:`Leverantörsfaktura ${invoice.supplierInvoiceNumber} – ${invoice.supplierName}`,sourceType:'supplier-invoice',sourceId:invoice.id,lines:structuredClone(invoice.coding)};
      state.accountingEntries.unshift(entry);invoice.liabilityPosted=true;invoice.liabilityAccountingEntryId=entry.id;invoice.openAmountOre=invoice.totalOre;
    });
    return Demo.state();
  }
  function prepareSupplierPayment(invoiceId){
    Demo.patch(state=>{
      const invoice=state.supplierInvoices.find(row=>row.id===invoiceId);
      if(!invoice)fail('Leverantörsfakturan hittades inte.','DEMO_INVOICE_NOT_FOUND');
      if(invoice.status!=='approved')fail('Fakturan måste vara attesterad före betalningsförberedelse.','DEMO_INVOICE_NOT_APPROVED');
      if(!invoice.liabilityPosted&&!invoice.liabilityAccountingEntryId)fail('Leverantörsskulden måste bokföras före betalningsförberedelse.','DEMO_LIABILITY_NOT_POSTED');
      invoice.status='payment-prepared';
      if(!state.supplierPayments.some(row=>row.supplierInvoiceId===invoice.id&&['prepared','released','paid'].includes(row.status)))state.supplierPayments.push({id:`spay-${invoice.id}`,supplierInvoiceId:invoice.id,paymentDate:Demo.AS_OF_DATE,supplierName:invoice.supplierName,supplierInvoiceNumber:invoice.supplierInvoiceNumber,amountOre:invoice.openAmountOre??invoice.totalOre,account:'1930',status:'prepared',preparedBy:'demo-accountant'});
    });
    return Demo.state();
  }
  function releaseSupplierPayment(paymentId){
    Demo.patch(state=>{
      const payment=state.supplierPayments.find(row=>row.id===paymentId);
      if(!payment)fail('Betalningen hittades inte.','DEMO_PAYMENT_NOT_FOUND');
      if(payment.status!=='prepared')fail('Endast en förberedd betalning kan frisläppas.','DEMO_PAYMENT_NOT_PREPARED');
      payment.status='released';payment.releasedBy='demo-approver';payment.releasedAt=new Date().toISOString();
    });
    return Demo.state();
  }
  function confirmSupplierPayment(paymentId,reference=`DEMO-${paymentId}`){
    Demo.patch(state=>{
      const payment=state.supplierPayments.find(row=>row.id===paymentId);
      if(!payment)fail('Betalningen hittades inte.','DEMO_PAYMENT_NOT_FOUND');
      if(payment.status==='paid')return;
      if(payment.status!=='released')fail('Betalningen måste vara frisläppt före bankbekräftelse.','DEMO_PAYMENT_NOT_RELEASED');
      const invoice=state.supplierInvoices.find(row=>row.id===payment.supplierInvoiceId);
      if(!invoice?.liabilityPosted&&!invoice?.liabilityAccountingEntryId)fail('Leverantörsskulden måste vara bokförd före betalningen.','DEMO_LIABILITY_NOT_POSTED');
      payment.status='paid';payment.confirmationReference=reference;payment.confirmedAt=new Date().toISOString();
      if(invoice){invoice.status='paid';invoice.openAmountOre=0}
      if(!state.accountingEntries.some(entry=>entry.sourceType==='supplier-payment'&&entry.sourceId===payment.id)){
        const used=state.accountingEntries.filter(entry=>entry.sourceType==='supplier-payment').length;
        state.accountingEntries.unshift({id:`entry-${payment.id}`,number:`A${50+used}`,postingDate:Demo.AS_OF_DATE,description:`Betalning leverantörsfaktura ${payment.supplierInvoiceNumber}`,sourceType:'supplier-payment',sourceId:payment.id,lines:[{account:'2440',text:'Leverantörsskulder',debitOre:payment.amountOre,creditOre:0},{account:payment.account||'1930',text:'Företagskonto / bank',debitOre:0,creditOre:payment.amountOre}]});
      }
    });
    return Demo.state();
  }
  globalThis.RollandsDemoWorkflows=Object.freeze({postSupplierInvoice,prepareSupplierPayment,releaseSupplierPayment,confirmSupplierPayment});
})();
