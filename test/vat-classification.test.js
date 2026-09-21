'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Invoice=require('../packages/invoicing/invoice.js');
const CustomerInvoicing=require('../apps/api/customer-invoicing.js');

function base(overrides={}){
  return {
    customerNumber:'K-1',
    seller:{name:'Test AB',address:'Testgatan 1, 111 11 Teststad',orgNumber:'559000-0001',vatNumber:'SE559000000101',bankgiro:'123-4567'},
    buyer:{name:'Kund AB',address:'Kundgatan 1, 111 12 Teststad'},
    invoiceDate:'2026-04-01',postingDate:'2026-04-01',dueDate:'2026-05-01',paymentTermsDays:30,currency:'SEK',
    lines:[{description:'Test',quantity:'1',unit:'st',unitPrice:'100,00',vatTreatment:'se-food',vatRate:'6',revenueAccount:'3053'}],
    ...overrides
  };
}

test('livsmedel växlar från 12 till 6 procent den 1 april 2026',()=>{
  assert.equal(Invoice.vatTreatmentRate('se-food','2026-03-31'),12);
  assert.equal(Invoice.vatTreatmentRate('se-food','2026-04-01'),6);
  const before=Invoice.prepare(base({invoiceDate:'2026-03-31',postingDate:'2026-03-31',dueDate:'2026-04-30',lines:[{description:'Frukt',quantity:'1',unit:'kg',unitPrice:'100,00',vatTreatment:'se-food',vatRate:'12',revenueAccount:'3052'}]}),{invoiceNumber:'310001',requireVatTreatment:true});
  const after=Invoice.prepare(base(),{invoiceNumber:'310002',requireVatTreatment:true});
  assert.equal(before.vatOre,1200);
  assert.equal(after.vatOre,600);
  assert.equal(after.lines[0].vatTreatment,'se-food');
});

test('restaurangtjänst är 12 procent och övrig vara/tjänst 25 procent i verifierad period',()=>{
  assert.equal(Invoice.vatTreatmentRate('se-restaurant-12','2026-09-18'),12);
  assert.equal(Invoice.vatTreatmentRate('se-standard-25','2026-09-18'),25);
});

test('backendläge kräver momsbehandling och stoppar manuell momssats som motsäger klassificeringen',()=>{
  assert.throws(()=>Invoice.prepare(base({lines:[{description:'Frukt',quantity:'1',unit:'kg',unitPrice:'100,00',vatRate:'6',revenueAccount:'3053'}]}),{invoiceNumber:'310003',requireVatTreatment:true}),/typ av försäljning/i);
  assert.throws(()=>Invoice.prepare(base({lines:[{description:'Frukt',quantity:'1',unit:'kg',unitPrice:'100,00',vatTreatment:'se-food',vatRate:'12',revenueAccount:'3052'}]}),{invoiceNumber:'310004',requireVatTreatment:true}),/stämmer inte/i);
});

test('fel intäktskonto för härledd momssats stoppas',()=>{
  assert.throws(()=>Invoice.prepare(base({lines:[{description:'Frukt',quantity:'1',unit:'kg',unitPrice:'100,00',vatTreatment:'se-food',vatRate:'6',revenueAccount:'3052'}]}),{invoiceNumber:'310005',requireVatTreatment:true}),/får inte användas med 6 % moms/i);
});

test('framtida fakturadatum utanför verifierad momsperiod spärras fail closed',()=>{
  assert.equal(Invoice.vatTreatmentRate('se-food','2027-12-31'),6);
  assert.equal(Invoice.vatTreatmentRate('se-restaurant-12','2027-12-31'),12);
  assert.equal(Invoice.vatTreatmentRate('se-standard-25','2027-12-31'),25);
  assert.throws(()=>Invoice.vatTreatmentRate('se-food','2028-01-01'),/endast verifierade till och med 2027-12-31/i);
});


test('kreditfaktura efter momssänkningen behåller originalets momssats och hänvisning',()=>{
  const original=Invoice.prepare(base({
    invoiceDate:'2026-03-31',
    postingDate:'2026-03-31',
    dueDate:'2026-04-30',
    lines:[{description:'Frukt',quantity:'1',unit:'kg',unitPrice:'100,00',vatTreatment:'se-food',vatRate:'12',revenueAccount:'3052'}]
  }),{invoiceNumber:'319901',requireVatTreatment:true});
  const credit=CustomerInvoicing.creditDocumentFrom(original,'319902','2026-04-02','Retur efter ursprungsfaktura.');
  assert.equal(original.lines[0].vatRate,12);
  assert.equal(credit.lines[0].vatRate,12);
  assert.equal(credit.lines[0].vatTreatment,'se-food');
  assert.equal(credit.vatOre,-1200);
  assert.equal(credit.vatBreakdown.find(row=>row.rate===12).vatOre,-1200);
  assert.equal(credit.vatBreakdown.find(row=>row.rate===6).vatOre,0);
  assert.equal(credit.creditOfInvoiceNumber,'319901');
  assert.equal(credit.invoiceDate,'2026-04-02');
});

test('momsfri, EU och import klassificeras inte som svenska normalfall utan explicit verifierad regel',()=>{
  for(const treatment of ['se-exempt','eu-goods','eu-services','import-goods','reverse-charge']){
    assert.throws(
      ()=>Invoice.prepare(base({lines:[{description:'Specialfall',quantity:'1',unit:'st',unitPrice:'100,00',vatTreatment:treatment,vatRate:'0',revenueAccount:'3054'}]}),{invoiceNumber:'319910',requireVatTreatment:true}),
      /verifierad typ av försäljning/i
    );
  }
});
