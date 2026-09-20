'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./private-workflows-fixture.cjs');
const Bank=require('../apps/api/bank-payments.js');
const Inventory=require('../apps/api/inventory.js');
const Payroll=require('../apps/api/payroll.js');
const Queues=require('../apps/api/queues.js');

async function run(fn){
  const f=await fixture();
  try{await fn(f)}finally{await f.close()}
}

test('andra kundens privata portal får rätt företagsidentitet från sessionen',()=>run(async f=>{
  const headers=await f.login(f.other.username);
  const response=await fetch(f.base+'/api/v1/session',{headers});
  assert.equal(response.status,200);
  const session=await response.json();
  assert.equal(session.authenticated,true);
  assert.equal(session.companyId,f.b.id);
  assert.equal(session.company.id,f.b.id);
  assert.equal(session.company.name,f.b.displayName);
  assert.equal(session.company.legalName,f.b.legalName);
  assert.doesNotMatch(JSON.stringify(session.company),/Rolands|Rollands|556406-5059/i);
}));

test('andra kundens fakturaprofil hämtas från dess egen företagsmiljö',()=>run(async f=>{
  const headers=await f.login(f.other.username);
  const response=await fetch(f.base+'/api/v1/customer-invoices/config',{headers});
  assert.equal(response.status,200);
  const config=await response.json();
  assert.equal(config.company.legalName,f.b.legalName);
  assert.equal(config.company.displayName,f.b.displayName);
  assert.equal(config.company.orgNumber,f.b.orgNumber);
  assert.equal(config.issuanceReady,false);
  assert.doesNotMatch(JSON.stringify(config.company),/Rolands|Rollands|556406-5059/i);
}));

test('ny kund får neutral CMS-startpunkt utan Rolands innehåll',()=>run(async f=>{
  const headers=await f.login(f.other.username);
  const response=await fetch(f.base+'/api/v1/website/cms',{headers});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.state.companyId,f.b.id);
  assert.equal(data.state.draft.company.legalName,f.b.legalName);
  assert.equal(data.state.draft.company.displayName,f.b.displayName);
  assert.equal(data.state.draft.company.orgNumber,f.b.orgNumber);
  assert.match(data.state.published.site.meta.title,new RegExp(f.b.displayName));
  assert.doesNotMatch(JSON.stringify(data.state),/Rolands|Rollands|556406-5059|Billdal/i);
}));


test('privata portalskal har ingen hårdkodad Rolands-identitet för kund nummer två',()=>{
  const portal=path.join(__dirname,'..','apps','portal');
  const files=fs.readdirSync(portal).filter(name=>/\.(?:html|js)$/.test(name)&&name!=='receivables.js'); // receivables.js är en uttrycklig Rolands-demo; privat drift använder app.js.
  const forbidden=[
    /<strong>Rollands<\/strong>/,
    /Rollands \/ (?:Ekonomi|Försäljning|Administration)/,
    /Rollands plattform/,
    /website:company\.website\|\|'https:\/\/rollands\.se'/
  ];
  for(const name of files){
    const source=fs.readFileSync(path.join(portal,name),'utf8');
    for(const pattern of forbidden)assert.doesNotMatch(source,pattern,name+' får inte använda Rolands som privat plattformsstandard');
  }
});


test('kund A och kund B hålls isär i bank, lager, lön, automation och CMS',()=>run(async f=>{
  const bankB=Bank.create(f.db,{companyId:f.b.id,externalId:'TENANT-B-BANK-1',bookingDate:'2026-09-20',amountOre:43210,reference:'B-ONLY',payerName:'Kund B betalare',createdBy:f.other.id}).payment;
  const itemB=Inventory.createItem(f.db,{companyId:f.b.id,sku:'B-ONLY-SKU',name:'Kund B artikel',unit:'st',purchaseAccount:'4010',inventoryAccount:'1460'});
  const movementB=Inventory.addMovement(f.db,{companyId:f.b.id,itemId:itemB.id,movementDate:'2026-09-20',type:'receipt',quantityMilli:5000,actorId:f.other.id,note:'Endast kund B'});
  const payrollB=Payroll.importRun(f.db,{
    companyId:f.b.id,period:'2026-09',payDate:'2026-09-25',sourceName:'Kund B isoleringstest',
    grossSalaryOre:100000,withheldTaxOre:30000,employerContributionsOre:31420,netPayOre:70000,vacationLiabilityChangeOre:0,
    importedBy:f.other.id,
    lines:[
      {account:'7010',text:'Bruttolön',debitOre:100000,creditOre:0},
      {account:'2710',text:'Preliminär skatt',debitOre:0,creditOre:30000},
      {account:'1930',text:'Nettolön',debitOre:0,creditOre:70000}
    ]
  });
  const proposalB=Queues.saveAutomationProposal(f.db,{
    companyId:f.b.id,type:'tenant-isolation-test',sourceId:'B-ONLY-SOURCE',status:'manual-review',
    confidence:.75,deterministic:false,ambiguous:true,reason:'Endast kund B',decisionReason:'Test',
    evidence:[{kind:'test',label:'Källa',value:'B'}],suggestion:{message:'B only'},
    engine:{name:'tenant-test',version:'1'},createdBy:f.other.id
  },{idempotencyKey:'tenant-b-isolation-1'}).proposal;

  const headersA=await f.login(f.admin.username);
  const headersB=await f.login(f.other.username);
  async function read(headers,route){
    const response=await fetch(f.base+'/api/v1'+route,{headers});
    assert.equal(response.status,200,route);
    return response.json();
  }

  const [bankA,bankForB,inventoryA,inventoryForB,payrollA,payrollForB,automationA,automationForB,cmsA,cmsB]=await Promise.all([
    read(headersA,'/bank/payments'),read(headersB,'/bank/payments'),
    read(headersA,'/inventory/items'),read(headersB,'/inventory/items'),
    read(headersA,'/payroll/runs'),read(headersB,'/payroll/runs'),
    read(headersA,'/automation/proposals'),read(headersB,'/automation/proposals'),
    read(headersA,'/website/cms'),read(headersB,'/website/cms')
  ]);

  assert.equal(bankA.payments.some(row=>row.id===bankB.id),false);
  assert.equal(bankForB.payments.some(row=>row.id===bankB.id),true);
  assert.equal(inventoryA.items.some(row=>row.id===itemB.id),false);
  assert.equal(inventoryForB.items.some(row=>row.id===itemB.id),true);
  assert.equal(payrollA.runs.some(row=>row.id===payrollB.id),false);
  assert.equal(payrollForB.runs.some(row=>row.id===payrollB.id),true);
  assert.equal(automationA.proposals.some(row=>row.id===proposalB.id),false);
  assert.equal(automationForB.proposals.some(row=>row.id===proposalB.id),true);

  assert.equal(Inventory.movementById(f.db,f.a.id,movementB.id),null);
  assert.equal(Payroll.runById(f.db,f.a.id,payrollB.id),null);
  assert.equal(Queues.automationProposalById(f.db,f.a.id,proposalB.id),null);
  assert.equal(Bank.byId(f.db,f.a.id,bankB.id),null);

  assert.equal(cmsA.state.companyId,f.a.id);
  assert.equal(cmsB.state.companyId,f.b.id);
  assert.match(cmsA.state.draft.site.hero.title,/Testbutik A/);
  assert.match(cmsB.state.draft.site.hero.title,/Testbutik B/);
  assert.doesNotMatch(JSON.stringify(cmsA.state),/B-ONLY|Kund B isoleringstest|Kund B artikel/);
}));
