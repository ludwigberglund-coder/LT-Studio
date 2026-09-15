// Standalone fictitious invoice: no changes to the application's accounting data.
const fs=require('node:fs');
const path=require('node:path');
const {invoicePdf}=require('../invoice-pdf');
const Model=require('../public/invoice-model');
(async()=>{
  const seller={name:'Rolands Frukt o Grönt Aktiebolag',address:'Bolshedens Industriväg 22, 427 50 Billdal',vatNumber:'SE556406505901',registeredOffice:'Göteborg',invoiceContact:'Exempelkontakt',paymentAccount:'EXEMPEL - EJ FÖR BETALNING'};
  const lines=[{description:'Äpplen och päron - företagsfrukt vecka 38',amount:1250,vatRate:12,account:'3052'},{description:'Leverans till kontoret, enligt överenskommelse',amount:200,vatRate:25,account:'3041'}];
  const data={number:'EXEMPEL-2026-1001',ocr:Model.ocr('20261001'),customer:'Exempelkunden AB - TESTFAKTURA',address:'Äppelvägen 12\n412 50 Göteborg',customerNumber:'K-EXEMPEL',ourContact:'Exempelkontakt',reference:'Östen Åberg',date:'2026-09-14',dueDate:'2026-10-14',paymentTerms:30,seller,...Model.calculate(lines)};
  const dir=path.join(require('node:os').tmpdir(),'rollands-invoice-qa');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'exempelfaktura.pdf'),await invoicePdf(data,seller));
  const many=Array.from({length:45},(_,i)=>({...lines[i%2],description:`Rad ${i+1}: ${lines[i%2].description}. Levererat enligt beställning med en längre fakturatext för läsbarhetskontroll.`}));
  const temp=dir;
  fs.writeFileSync(path.join(temp,'flera-sidor.pdf'),await invoicePdf({...data,...Model.calculate(many)},seller));
  console.log('Exempelfaktura och flersidigt prov skapade.');
})();
