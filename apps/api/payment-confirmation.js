'use strict';

const SupplierAccounting=require('./supplier-accounting.js');

function initializePaymentConfirmation(db){SupplierAccounting.initializeSupplierAccounting(db)}
function paymentForConfirmation(db,companyId,paymentId){return SupplierAccounting.paymentForConfirmation(db,companyId,paymentId)}
function confirmAndPost(db,input){return SupplierAccounting.confirmSupplierPayment(db,input)}
function correctAndReopen(db,input){return SupplierAccounting.correctSupplierPayment(db,input)}

module.exports=Object.freeze({initializePaymentConfirmation,paymentForConfirmation,confirmAndPost,correctAndReopen});
