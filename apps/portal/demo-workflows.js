(function(){
  'use strict';
  const Demo=globalThis.RollandsDemoScenario;
  if(!Demo)return;
  function fail(message,code){const error=new Error(message);error.code=code;throw error}
  function prepareSupplierPayment(invoiceId){
    Demo.patch(state=>{
      const invoice=state.supplierInvoices.find(row=>row.id===invoiceId);
      if(!invoice)fail('Leverantörsfakturan hittades inte.','DEMO_INVOICE_NOT_FOUND');
      if(invoice.status!=='approved')fail('Fakturan måste vara attesterad före betalningsförberedelse.','DEMO_INVOICE_NOT_APPROVED');
      invoice.status='payment-prepared';
      if(!state.supplierPayments.some(row=>row.supplierInvoiceId===invoice.id&&['prepared','released'].includes(row.status)))state.supplierPayments.push({id:`spay-${invoice.id}`,supplierInvoiceId:invoice.id,paymentDate:Demo.AS_OF_DATE,supplierName:invoice.supplierName,supplierInvoiceNumber:invoice.supplierInvoiceNumber,amountOre:invoice.totalOre,status:'prepared',preparedBy:'demo-accountant'});
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
      if(payment.status!=='released')fail('Betalningen måste vara frisläppt före bankbekräftelse.','DEMO_PAYMENT_NOT_RELEASED');
      payment.status='paid';payment.confirmationReference=reference;payment.confirmedAt=new Date().toISOString();
      const invoice=state.supplierInvoices.find(row=>row.id===payment.supplierInvoiceId);if(invoice)invoice.status='paid';
      if(!state.accountingEntries.some(entry=>entry.sourceType==='supplier-payment'&&entry.sourceId===payment.id)){
        const used=state.accountingEntries.filter(entry=>entry.sourceType==='supplier-payment').length;
        state.accountingEntries.unshift({id:`entry-${payment.id}`,number:`B${19+used}`,postingDate:Demo.AS_OF_DATE,description:`Betalning leverantörsfaktura ${payment.supplierInvoiceNumber}`,sourceType:'supplier-payment',sourceId:payment.id,lines:[{account:'2440',text:'Leverantörsskulder',debitOre:payment.amountOre,creditOre:0},{account:'1930',text:'Företagskonto / bank',debitOre:0,creditOre:payment.amountOre}]});
      }
    });
    return Demo.state();
  }
  globalThis.RollandsDemoWorkflows=Object.freeze({prepareSupplierPayment,releaseSupplierPayment,confirmSupplierPayment});
})();
