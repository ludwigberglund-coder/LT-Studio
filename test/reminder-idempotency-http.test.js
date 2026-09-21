'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const crypto=require('node:crypto');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const {createApiApp}=require('../apps/api/app.js');

test('identiska ekonomiska påminnelseförsök återanvänder samma post och audit',async()=>{
  const db=Db.openDatabase(':memory:');
  let server;
  try{
    const company=Db.createCompany(db,{legalName:'Retry Test AB',displayName:'Retry Test',orgNumber:'559900-6510'});
    const user=Db.createUser(db,{username:'retry.user',displayName:'Retry User',passwordHash:'test-hash'});
    Db.addMembership(db,{companyId:company.id,userId:user.id});
    const customer=Db.createCustomer(db,{companyId:company.id,customerNumber:'K-1',name:'Retry Kund AB',customerType:'business'});
    const invoice=Db.createInvoice(db,{
      companyId:company.id,customerId:customer.id,invoiceNumber:'310010',invoiceDate:'2026-09-01',postingDate:'2026-09-01',
      dueDate:'2026-10-01',totalOre:125000,remainingOre:125000,vatOre:25000,status:'Bokförd'
    });

    const api=createApiApp({db,secureCookies:false});
    const document={invoiceNumber:'310010',invoiceDate:'2026-09-01',postingDate:'2026-09-01',dueDate:'2026-10-01',paymentTermsDays:30};
    const documentJson=JSON.stringify(document);
    const sha=crypto.createHash('sha256').update(documentJson).digest('hex');
    db.prepare('INSERT INTO customer_invoice_documents(invoice_id,company_id,document_json,document_sha256,created_at) VALUES(?,?,?,?,?)')
      .run(invoice.id,company.id,documentJson,sha,'2026-09-01T10:00:00.000Z');

    const token=Auth.randomToken(32),csrf=Auth.randomToken(24);
    Db.createSession(db,{
      tokenHash:Auth.hashToken(token),csrfHash:Auth.hashToken(csrf),userId:user.id,companyId:company.id,
      expiresAt:'2099-01-01T00:00:00.000Z',absoluteExpiresAt:'2099-01-01T00:00:00.000Z'
    });

    server=http.createServer((req,res)=>api.handle(req,res));
    await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
    const base='http://127.0.0.1:'+server.address().port;
    const headers={Cookie:'rollands_session='+token,'Content-Type':'application/json','X-CSRF-Token':csrf};

    const first=await fetch(base+'/api/v1/invoices/'+invoice.id+'/reminders',{
      method:'POST',headers,body:JSON.stringify({sentDate:'2026-10-20',includeInterest:true,note:'Första försöket'})
    });
    const firstBody=await first.json();
    const retry=await fetch(base+'/api/v1/invoices/'+invoice.id+'/reminders',{
      method:'POST',headers,body:JSON.stringify({sentDate:'2026-10-20',includeInterest:true,note:'Retry med annan intern anteckning'})
    });
    const retryBody=await retry.json();

    assert.equal(first.status,201);
    assert.equal(firstBody.duplicate,false);
    assert.match(firstBody.reminder.requestFingerprint,/^[a-f0-9]{64}$/);
    assert.equal(retry.status,200);
    assert.equal(retryBody.duplicate,true);
    assert.equal(retryBody.reminder.id,firstBody.reminder.id);
    assert.equal(retryBody.reminder.requestFingerprint,firstBody.reminder.requestFingerprint);
    assert.equal(Db.remindersForInvoice(db,company.id,invoice.id).length,1);
    assert.equal(
      Db.auditForCompany(db,company.id).filter(event=>event.action==='PAYMENT_REMINDER_CREATED'&&event.entityId===invoice.id).length,
      1
    );
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    db.close();
  }
});
