'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Invoice=require('../packages/invoicing/invoice.js');

test('customer invoice supports negative line prices and negative total with balanced journal',()=>{
  const document=Invoice.prepare({
    customerNumber:'K-TEST',
    seller:{
      name:'LT Studio Test AB',
      address:'Testgatan 1, 000 00 Teststad',
      orgNumber:'000000-0000',
      vatNumber:'SE000000000001',
      bankgiro:'123-4567'
    },
    buyer:{
      name:'UAT Kund AB',
      address:'Kundgatan 1, 000 00 Teststad'
    },
    invoiceDate:'2026-09-23',
    postingDate:'2026-09-23',
    dueDate:'2026-10-23',
    paymentTermsDays:30,
    currency:'SEK',
    lines:[{
      description:'Negativ fakturarad',
      quantity:'1',
      unit:'st',
      unitPrice:'-100,00',
      vatTreatment:'se-standard-25',
      vatRate:'25',
      revenueAccount:'3051'
    }]
  },{invoiceNumber:'399999',requireVatTreatment:true});

  assert.equal(document.netOre,-10000);
  assert.equal(document.vatOre,-2500);
  assert.equal(document.totalOre,-12500);
  assert.equal(document.lines[0].unitPriceOre,-10000);

  const journal=Invoice.journalLines(document);
  assert.equal(journal.reduce((sum,row)=>sum+row.debitOre-row.creditOre,0),0);
  assert.deepEqual(journal.find(row=>row.account==='1510'),{
    account:'1510',
    text:'Kundfordringar',
    debitOre:0,
    creditOre:12500
  });
  assert.equal(journal.find(row=>row.account==='3051').debitOre,10000);
  assert.equal(journal.find(row=>row.account==='2611').debitOre,2500);
});

test('zero-total customer invoice remains blocked',()=>{
  assert.throws(()=>Invoice.prepare({
    customerNumber:'K-TEST',
    seller:{name:'LT Studio Test AB',address:'Testgatan 1, 000 00 Teststad',orgNumber:'000000-0000',vatNumber:'SE000000000001',bankgiro:'123-4567'},
    buyer:{name:'UAT Kund AB',address:'Kundgatan 1, 000 00 Teststad'},
    invoiceDate:'2026-09-23',
    postingDate:'2026-09-23',
    dueDate:'2026-10-23',
    paymentTermsDays:30,
    currency:'SEK',
    lines:[{
      description:'Nollrad',
      quantity:'1',
      unit:'st',
      unitPrice:'0,00',
      vatTreatment:'se-standard-25',
      vatRate:'25',
      revenueAccount:'3051'
    }]
  },{invoiceNumber:'399998',requireVatTreatment:true}),/totalbelopp 0 kr/);
});

test('receivables reminder row shows only reminder charges, not original principal',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'..','apps','portal','app.js'),'utf8');
  const start=source.indexOf('function reminderRow');
  const end=source.indexOf('function table()',start);
  const reminderRow=source.slice(start,end);
  assert.match(reminderRow,/const reminderChargeOre=/);
  assert.match(reminderRow,/invoiceAmountOre:reminderChargeOre/);
  assert.match(reminderRow,/remainingOre:reminderChargeOre/);
  assert.match(reminderRow,/Påminnelsebelopp/);
  assert.doesNotMatch(reminderRow,/remainingOre:Number\(reminder\.totalDueOre/);
  assert.doesNotMatch(reminderRow,/<b>\$\{ore\(reminder\.totalDueOre\)\}<\/b>/);
});
