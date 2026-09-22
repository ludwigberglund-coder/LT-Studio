'use strict';
function example(){return {
 customerNumber:'K-1001',invoiceDate:'2026-09-17',postingDate:'2026-09-17',dueDate:'2026-10-17',paymentTermsDays:30,currency:'SEK',
 seller:{name:'Demo Handel AB',address:'Exempelgatan 1\n411 00 Göteborg',orgNumber:'559999-0000',vatNumber:'SE559999000001',phone:'031-00 00 00 (demo)',email:'faktura@example.invalid',website:'https://demo.example.invalid',bankgiro:'DEMO-EJ-BETALNING',taxStatus:'Demo – verifiera skattestatus före skarp drift'},
 buyer:{name:'Exempelkunden AB',address:'Testgatan 10\n411 00 Göteborg',orgNumber:'DEMO-ORG',email:'kund@example.invalid'},
 ourReference:'Demo referens',yourReference:'Kundens referens',notes:'Tack för er beställning! Detta är en fiktiv exempelfaktura, inte en betalningsbegäran.',
 useFees:true,includeMessage:true,
 administration:{amount:'10,00',vatRate:'25',revenueAccount:'3690'},freight:{amount:'50,00',vatRate:'25',revenueAccount:'3520'},
 lines:[{description:'Företagsfrukt – exempelrad',quantity:'2',unit:'st',unitPrice:'450,00',vatRate:'25',revenueAccount:'3051'},
 {description:'Service – exempelrad',quantity:'1,5',unit:'tim',unitPrice:'250,00',vatRate:'12',revenueAccount:'3042'}]
};}
function state(){return {customers:[{customerNumber:'K-1001',name:'Exempelkunden AB'}],customerInvoices:[],accountingEntries:[],accountingPeriods:[{period:'2026-09',status:'open'},{period:'2026-08',status:'locked'}],invoiceRevenueAccounts:[]};}
module.exports={example,state};
