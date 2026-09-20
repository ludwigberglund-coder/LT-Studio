'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Csv=require('../apps/api/csv-exports.js');
const {createServer}=require('../apps/api/server.js');

function invoice(db,company,customer,{number,date,name,totalOre=125000,vatOre=25000}){
  const c=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-'+number,name});
  return Db.createInvoice(db,{companyId:company.id,customerId:c.id,invoiceNumber:number,invoiceDate:date,postingDate:date,dueDate:date,totalOre,remainingOre:totalOre,vatOre,status:'Bokförd'});
}
function decode(buffer){return buffer.toString('utf8').replace(/^\uFEFF/,'')}

test('CSV export filtrerar period och neutraliserar Excel-formler',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const company=Db.createCompany(db,{legalName:'Export AB',displayName:'Export',orgNumber:'559910-0001'});
    invoice(db,company,null,{number:'1001',date:'2026-07-15',name:'=HYPERLINK("https://example.invalid")'});
    invoice(db,company,null,{number:'1002',date:'2026-10-01',name:'Utanför period'});
    const result=Csv.buildExport(db,company.id,{dataset:'customer-invoices',from:'2026-07-01',to:'2026-09-30'});
    const csv=decode(result.bytes);
    assert.equal(result.count,1);
    assert.match(csv,/1001/);
    assert.doesNotMatch(csv,/1002/);
    assert.match(csv,/'=HYPERLINK/);
    assert.equal(csv.includes(';125000;25000;125000;'),true);
  }finally{db.close()}
});

test('CSV export är strikt företagsisolerad',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const a=Db.createCompany(db,{legalName:'Export A AB',displayName:'A',orgNumber:'559910-0002'});
    const b=Db.createCompany(db,{legalName:'Export B AB',displayName:'B',orgNumber:'559910-0003'});
    invoice(db,a,null,{number:'A-1',date:'2026-09-01',name:'Kund A'});
    invoice(db,b,null,{number:'B-1',date:'2026-09-01',name:'Kund B'});
    const csv=decode(Csv.buildExport(db,a.id,{dataset:'customer-invoices',from:'2026-09-01',to:'2026-09-30'}).bytes);
    assert.match(csv,/A-1/);
    assert.doesNotMatch(csv,/B-1|Kund B/);
  }finally{db.close()}
});

test('ogiltigt datumintervall blockeras före export',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const company=Db.createCompany(db,{legalName:'Export Datum AB',displayName:'Datum',orgNumber:'559910-0004'});
    assert.throws(()=>Csv.buildExport(db,company.id,{dataset:'customer-invoices',from:'2026-09-30',to:'2026-09-01'}),e=>e.code==='INVALID_EXPORT_RANGE');
  }finally{db.close()}
});

test('HTTP-export kräver personlig session och returnerar endast valt företags filtrerade data',async()=>{
  const db=Db.openDatabase(':memory:');
  const a=Db.createCompany(db,{legalName:'HTTP Export A AB',displayName:'A',orgNumber:'559910-0005'});
  const b=Db.createCompany(db,{legalName:'HTTP Export B AB',displayName:'B',orgNumber:'559910-0006'});
  const user=Db.createUser(db,{username:'export.user',displayName:'Export User',passwordHash:Auth.hashPassword('Ett sakert exportlosenord 2026!')});
  Db.addMembership(db,{companyId:a.id,userId:user.id});
  invoice(db,a,null,{number:'A-SEP',date:'2026-09-10',name:'A Kund'});
  invoice(db,a,null,{number:'A-OCT',date:'2026-10-10',name:'A Sen'});
  invoice(db,b,null,{number:'B-SEP',date:'2026-09-10',name:'B Kund'});
  const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
  Db.createSession(db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:a.id,expiresAt:new Date(Date.now()+60000).toISOString()});
  const runtime=createServer({db,databasePath:':memory:',secureCookies:false});
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
  try{
    const port=runtime.server.address().port;
    const url=`http://127.0.0.1:${port}/api/v1/reports/export?dataset=customer-invoices&from=2026-09-01&to=2026-09-30`;
    assert.equal((await fetch(url)).status,401);
    const response=await fetch(url,{headers:{Cookie:`rollands_session=${token}`}});
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/text\/csv/);
    assert.equal(response.headers.get('x-export-row-count'),'1');
    const csv=await response.text();
    assert.match(csv,/A-SEP/);
    assert.doesNotMatch(csv,/A-OCT|B-SEP|B Kund/);
  }finally{await new Promise(resolve=>runtime.close(resolve))}
});
