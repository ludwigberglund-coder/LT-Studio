'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');

function seed(){const db=Db.openDatabase(':memory:');Accounting.initializeAccountingStore(db);const company=Db.createCompany(db,{legalName:'Journaltest AB',displayName:'Journaltest',orgNumber:'559900-3030'});const user=Db.createUser(db,{username:'journal',displayName:'Journal Test',passwordHash:Auth.hashPassword('Journal testlosenord 2026!')});return{db,company,user}}
function post(db,company,user,date,sourceId){return Accounting.postEntry(db,{companyId:company.id,postingDate:date,description:`Test ${sourceId}`,sourceType:'test',sourceId,createdBy:user.id,series:'A',lines:[{account:'1930',debitOre:10000,creditOre:0},{account:'2990',debitOre:0,creditOre:10000}]})}

test('verifikationsserien löper inom året och kan börja om nästa räkenskapsår',()=>{const {db,company,user}=seed();try{assert.equal(post(db,company,user,'2026-12-31','s1').entry.number,'A1');assert.equal(post(db,company,user,'2026-12-31','s2').entry.number,'A2');assert.equal(post(db,company,user,'2027-01-01','s3').entry.number,'A1');assert.equal(Accounting.listEntries(db,company.id).length,3);}finally{db.close()}});
test('samma källpost kan inte skapa dubbla verifikationer',()=>{const {db,company,user}=seed();try{const first=post(db,company,user,'2026-09-16','same');const second=post(db,company,user,'2026-09-16','same');assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);assert.equal(first.entry.id,second.entry.id);assert.equal(Accounting.listEntries(db,company.id).length,1);}finally{db.close()}});
test('obalanserad post och låst period stoppas',()=>{const {db,company,user}=seed();try{assert.throws(()=>Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-16',description:'Obalanserad',sourceType:'test',sourceId:'bad',createdBy:user.id,lines:[{account:'1930',debitOre:10000,creditOre:0},{account:'2990',debitOre:0,creditOre:9000}]}),e=>e.code==='UNBALANCED_ENTRY');db.prepare(`INSERT INTO accounting_periods(company_id,period,status) VALUES(?,?,'locked')`).run(company.id,'2026-09');assert.throws(()=>post(db,company,user,'2026-09-16','locked'),e=>e.code==='PERIOD_LOCKED');}finally{db.close()}});
