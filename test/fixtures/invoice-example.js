'use strict';
function example(){return {
 customerNumber:'K-1001',invoiceDate:'2026-09-17',postingDate:'2026-09-17',dueDate:'2026-10-17',deliveryDate:'2026-09-17',paymentTermsDays:30,currency:'SEK',
 seller:{name:'Rolands Frukt o Grönt Aktiebolag',address:'Bolshedens Industriväg 22\n427 50 Billdal',orgNumber:'556406-5059',vatNumber:'SE556406505901',phone:'031-00 00 00 (demo)',email:'faktura@example.invalid',website:'demo.example.invalid',registeredOffice:'Göteborg',bankgiro:'DEMO-EJ-BETALNING',plusgiro:'DEMO-PG',iban:'DEMO-IBAN',bic:'DEMO-BIC',swish:'DEMO-SWISH',taxStatus:'Exempeluppgift – kontrollera före drift'},
 buyer:{name:'Exempelkunden AB',address:'Testgatan 10\n411 00 Göteborg',orgNumber:'DEMO-ORG',vatNumber:'DEMO-VAT',email:'kund@example.invalid',phone:'000-00 00 00'},
 ourReference:'Rollands referens',yourReference:'Kundens referens',orderNumber:'ORDER-DEMO-104',ocr:'310501',interestText:'Enligt avtal',paymentTermsText:'Netto',deliveryTerms:'Avhämtning enligt överenskommelse',deliveryMethod:'Hämtas i butik',deliveryAddress:'',
 notes:'Tack för er beställning! Detta är en fiktiv exempelfaktura, inte en betalningsbegäran.',internalNotes:'Intern kontroll: välj intäktskonto per rad. Inte för kund.',taxExemptionReason:'',roundToKrona:false,
 lines:[{articleNumber:'ART-101',description:'Företagsfrukt – exempelrad',quantity:'2',unit:'st',unitPrice:'450,00',discountPercent:'0',vatRate:'25',revenueAccount:'3051'},
 {articleNumber:'TJ-202',description:'Service och leverans – exempelrad',quantity:'1,5',unit:'tim',unitPrice:'250,00',discountPercent:'10',vatRate:'12',revenueAccount:'3042'}]
};}
function state(){return {customers:[{customerNumber:'K-1001',name:'Exempelkunden AB'}],customerInvoices:[],accountingEntries:[],accountingPeriods:[{period:'2026-09',status:'open'},{period:'2026-08',status:'locked'}]};}
module.exports={example,state};
