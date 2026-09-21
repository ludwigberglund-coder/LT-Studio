'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const {platformOverview}=require('../apps/api/platform-overview.js');

test('plattformsoverview listar företag och aggregerad säkerhet utan affärsdetaljer',()=>{
  const db=Db.openDatabase(':memory:');
  try{
    const a=Db.createCompany(db,{legalName:'Alpha Butik AB',displayName:'Alpha Butik',orgNumber:'559900-7001'});
    const b=Db.createCompany(db,{legalName:'Beta Mat AB',displayName:'Beta Mat',orgNumber:'559900-7002'});
    const user=Db.createUser(db,{username:'operator-overview-member',displayName:'Översiktsmedlem',passwordHash:'test-only'});
    Db.addMembership(db,{companyId:a.id,userId:user.id});
    const token=Auth.randomToken(),csrf=Auth.randomToken();
    Db.createSession(db,{tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),companyId:a.id,userId:user.id,expiresAt:'2099-01-01T00:00:00.000Z',absoluteExpiresAt:'2099-01-02T00:00:00.000Z'});

    const customerA=Db.createCustomer(db,{companyId:a.id,customerNumber:'A-CUSTOMER-SECRET',name:'Alpha Hemlig Kund'});
    Db.createInvoice(db,{companyId:a.id,customerId:customerA.id,invoiceNumber:'A-INVOICE-SECRET',invoiceDate:'2026-09-21',postingDate:'2026-09-21',dueDate:'2026-10-21',totalOre:125000,remainingOre:125000,vatOre:25000,status:'Bokförd'});
    const customerB=Db.createCustomer(db,{companyId:b.id,customerNumber:'B-CUSTOMER-SECRET',name:'Beta Hemlig Kund'});
    Db.createInvoice(db,{companyId:b.id,customerId:customerB.id,invoiceNumber:'B-INVOICE-SECRET',invoiceDate:'2026-09-21',postingDate:'2026-09-21',dueDate:'2026-10-21',totalOre:50000,remainingOre:50000,vatOre:10000,status:'Bokförd'});
    Db.appendAudit(db,{companyId:a.id,userId:user.id,action:'TEST_ACTIVITY',entityType:'test',details:{}});
    const securityEvent=Db.appendSecurityEvent(db,{kind:'LOGIN_FAILURE_THRESHOLD',severity:'warning',fingerprintHash:'b'.repeat(64),details:{privateTechnicalDetail:'do-not-expose'}});
    db.prepare('UPDATE security_events SET created_at=? WHERE id=?').run('2026-09-21T11:00:00.000Z',securityEvent.id);

    const result=platformOverview(db,{nowMs:Date.parse('2026-09-21T12:00:00.000Z')});
    assert.equal(result.runtimeModel,'shared-saas');
    assert.equal(result.companyCount,2);
    assert.equal(result.activeSessionCount,1);
    assert.deepEqual(result.companies.map(row=>row.displayName),['Alpha Butik','Beta Mat']);

    const alpha=result.companies[0],beta=result.companies[1];
    assert.equal(alpha.memberCount,1);
    assert.equal(alpha.activeSessionCount,1);
    assert.equal(alpha.customerRecordCount,1);
    assert.equal(alpha.invoiceRecordCount,1);
    assert.equal(alpha.accessConfigured,true);
    assert.ok(alpha.lastActivityAt);
    assert.equal(beta.memberCount,0);
    assert.equal(beta.activeSessionCount,0);
    assert.equal(beta.accessConfigured,false);

    assert.equal(result.security.windowHours,24);
    assert.equal(result.security.warning,1);
    assert.equal(result.security.critical,0);
    assert.equal(result.security.total,1);
    assert.ok(result.security.latestEventAt);

    const serialized=JSON.stringify(result);
    assert.doesNotMatch(serialized,/Hemlig Kund|CUSTOMER-SECRET|INVOICE-SECRET|125000|50000/);
    assert.doesNotMatch(serialized,/bbbbbbbb|privateTechnicalDetail|do-not-expose/);
  }finally{db.close()}
});

test('plattformsoverview validerar databas, tidpunkt och säkerhetsfönster',()=>{
  assert.throws(()=>platformOverview(null),error=>error.code==='PLATFORM_OVERVIEW_DATABASE_REQUIRED');
  const db=Db.openDatabase(':memory:');
  try{
    assert.throws(()=>platformOverview(db,{nowMs:NaN}),error=>error.code==='PLATFORM_OVERVIEW_INVALID_TIME');
    assert.throws(()=>platformOverview(db,{securityWindowHours:0}),error=>error.code==='PLATFORM_OVERVIEW_INVALID_SECURITY_WINDOW');
  }finally{db.close()}
});
