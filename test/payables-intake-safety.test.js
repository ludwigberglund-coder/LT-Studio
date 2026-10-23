'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const PDFLib=require('pdf-lib');
const I=require('../apps/portal/payables-intake-safety.js');
const S=require('../apps/portal/supplier-persistence.js');
const P=require('../packages/invoicing/passive-pdf.js');
const ctx=()=>({authenticated:true,company:{id:'intake-company-a'},authUser:{id:'intake-user-a'},accessToken:'synthetic',membership:{role:'accountant'}});
const input=()=>({supplierId:'__new__',supplierNumber:'L-1',supplierName:'Synthetic supplier',orgNumber:'',bankgiro:'',defaultCostAccount:'',supplierInvoiceNumber:'INV-1',invoiceDate:'2026-10-01',dueDate:'2026-10-31',totalAmount:'1250,00',vatAmount:'250,00',vatTreatment:'se-domestic-full-input-vat'});
async function fixture(){const doc=await PDFLib.PDFDocument.create();doc.addPage();const bytes=await doc.save();return {name:'synthetic.pdf',type:'application/pdf',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}
async function op(overrides={}){return I.prepare({input:input(),file:await fixture(),context:ctx(),store:S,pdf:P,pdfLibrary:PDFLib,...overrides});}
function backend({failDocumentOnce=false,failInvoiceOnce=false,lostInvoiceReply=false,lostSupplierReply=false,failUpload=false}={}){
 const db={suppliers:[],supplier_invoices:[],documents:[]};let original=null;const writes=[],uploads=[];
 let documentFailed=false,invoiceFailed=false;
 const client={from(table){assert.ok(Object.hasOwn(db,table),'no bookkeeping, approval, payment or audit mutation is invoked');return{
  async select(fields,filters){assert.match(filters,/company_id=eq.intake-company-a/);return db[table].map(r=>({...r}));},
  async insert(rows){
   if(table==='documents'&&failDocumentOnce&&!documentFailed){documentFailed=true;throw new Error('Synthetic document outage');}
   if(table==='supplier_invoices'&&failInvoiceOnce&&!invoiceFailed){invoiceFailed=true;throw new Error('Synthetic invoice outage');}
   if(db[table].some(r=>r.id===rows[0].id))throw new Error('23505');
   writes.push(table);db[table].push({...rows[0]});
   if(table==='supplier_invoices'&&lostInvoiceReply)throw new Error('Lost committed reply');
   if(table==='suppliers'&&lostSupplierReply)throw new Error('Lost committed reply');
   return rows.map(r=>({...r}));
  },
  async update(){throw new Error('Intake must not overwrite existing rows');}
 }},storage:{
  async upload(bucket,path,file){uploads.push(path);if(failUpload)throw new Error('Upload unavailable');if(original)throw new Error('Object already exists');original=file;},
  async download(){if(!original)throw new Error('Not found');return original;}
 }};
 return {db,client,writes,uploads,
  removeOriginal:()=>{original=null;},
  changeOriginal:async()=>{const bytes=new Uint8Array(await original.arrayBuffer());bytes[0]^=1;original={...original,arrayBuffer:async()=>bytes.buffer};},
  truncateOriginalRead:async()=>{const bytes=new Uint8Array(await original.arrayBuffer());original={...original,arrayBuffer:async()=>bytes.slice(1).buffer};},
  breakOriginalRead:()=>{original={...original,arrayBuffer:async()=>{throw new Error('Synthetic read failure');}};}
 };
}
const run=(b,operation,getContext=async()=>ctx())=>I.save({operation,client:b.client,store:S,getContext});
test('input validates dates and amounts before any write adapter exists',()=>{
 for(const patch of [{totalAmount:'1,000,00'},{totalAmount:'0'},{vatAmount:'1250,00'},{invoiceDate:'2026-02-30'},{dueDate:'2026-09-30'},{supplierInvoiceNumber:''},{supplierName:''},{vatTreatment:'unsupported'},{company_id:'other'}])
  assert.throws(()=>I.validate({...input(),...patch}));
 assert.equal(I.validate(input()).totalOre,125000);
 for(const amount of ['1 250,00','1\u00a0250,00','1\u202f250,00','1250.00'])
  assert.equal(I.validate({...input(),totalAmount:amount}).totalOre,125000);
 for(const amount of ['1 2 50,00','12 50,00','1 23,45','1 000 0,00'])
  assert.throws(()=>I.validate({...input(),totalAmount:amount}),/INVALID_INTAKE_AMOUNT/);
});
test('preparation validates the same passive PDF policy as the server',async()=>{
 const bytes=new TextEncoder().encode('%PDF-1.4\n/Java#53cript (bad)\n'+'.'.repeat(40)+'\n%%EOF');
 await assert.rejects(op({file:{name:'bad.pdf',type:'application/pdf',size:bytes.length,arrayBuffer:async()=>bytes.buffer}}),e=>e.code==='ACTIVE_PDF_CONTENT_NOT_ALLOWED');
 await assert.rejects(op({input:{...input(),totalAmount:'broken'}}),/INVALID_INTAKE_AMOUNT/);
 const original=await fixture();
 await assert.rejects(op({file:{...original,size:original.size-1}}),/INVALID_INTAKE_PDF/);
});
test('same original and company produce stable registration ids after page restart',async()=>{
 const file=await fixture(),a=await op({file}),b=await op({file});
 assert.equal(a.invoiceId,b.invoiceId);assert.equal(a.documentId,b.documentId);
 assert.equal(a.supplierOperation.requestId,b.supplierOperation.requestId);
 const other=ctx();other.company.id='intake-company-b';const c=await op({file,context:other});
 assert.notEqual(a.invoiceId,c.invoiceId);assert.notEqual(a.supplierId,c.supplierId);
});
test('successful registration writes one supplier, invoice and original link, never bookkeeping',async()=>{
 const b=backend(),operation=await op(),result=await run(b,operation);
 assert.equal(result.invoiceId,operation.invoiceId);
 assert.deepEqual(b.writes,['suppliers','supplier_invoices','documents']);
 assert.equal(b.db.supplier_invoices[0].status,'registered');
 assert.equal(b.db.supplier_invoices[0].company_id,'intake-company-a');
});
test('exact retry of a completed registration makes no further writes or uploads',async()=>{
 const b=backend(),operation=await op();await run(b,operation);const result=await run(b,operation);
 assert.equal(result.resumed,true);assert.equal(b.writes.length,3);assert.equal(b.uploads.length,1);
});
test('completed intake is not reported as resumed if its original PDF disappeared',async()=>{
 const b=backend(),operation=await op();await run(b,operation);
 b.removeOriginal();
 await assert.rejects(run(b,operation),/INTAKE_DOCUMENT_CONFLICT/);
 assert.equal(b.writes.length,3);
 assert.equal(b.uploads.length,1);
});
test('completed intake rejects a changed original even when its byte length is unchanged',async()=>{
 const b=backend(),operation=await op();await run(b,operation);
 await b.changeOriginal();
 await assert.rejects(run(b,operation),/INTAKE_DOCUMENT_CONFLICT/);
 assert.equal(b.writes.length,3);
 assert.equal(b.uploads.length,1);
});
test('completed intake rejects a short original read despite matching blob metadata',async()=>{
 const b=backend(),operation=await op();await run(b,operation);
 await b.truncateOriginalRead();
 await assert.rejects(run(b,operation),/INTAKE_DOCUMENT_CONFLICT/);
 assert.equal(b.writes.length,3);
 assert.equal(b.uploads.length,1);
});
test('completed intake normalizes original read failures to a document conflict',async()=>{
 const b=backend(),operation=await op();await run(b,operation);
 b.breakOriginalRead();
 await assert.rejects(run(b,operation),e=>e.code==='INTAKE_DOCUMENT_CONFLICT');
 assert.equal(b.writes.length,3);
 assert.equal(b.uploads.length,1);
});
test('failed PDF upload creates no supplier or invoice',async()=>{
 const b=backend({failUpload:true});await assert.rejects(run(b,await op()));
 assert.equal(b.writes.length,0);
});
test('failed invoice step resumes without duplicating its supplier',async()=>{
 const b=backend({failInvoiceOnce:true}),operation=await op();
 await assert.rejects(run(b,operation),e=>e.intakeStage==='invoice');
 assert.deepEqual(b.writes,['suppliers']);await run(b,operation);
 assert.deepEqual(b.writes,['suppliers','supplier_invoices','documents']);
});
test('failed metadata step resumes the already registered invoice',async()=>{
 const b=backend({failDocumentOnce:true}),operation=await op();
 await assert.rejects(run(b,operation),e=>e.intakeStage==='document');
 await run(b,operation);assert.equal(b.db.suppliers.length,1);assert.equal(b.db.supplier_invoices.length,1);assert.equal(b.db.documents.length,1);
});
test('lost supplier and invoice commit replies are read back, not blindly reissued',async()=>{
 const b=backend({lostInvoiceReply:true,lostSupplierReply:true});await run(b,await op());
 assert.deepEqual(b.writes,['suppliers','supplier_invoices','documents']);
});
test('changed invoice data on retry cannot overwrite an existing invoice',async()=>{
 const b=backend(),file=await fixture();await run(b,await op({file}));
 const changed=await op({file,input:{...input(),totalAmount:'2500,00'}});
 await assert.rejects(run(b,changed),/INTAKE_DUPLICATE_OR_CHANGED/);assert.equal(b.writes.length,3);
});
test('company change during upload stops all database writes',async()=>{
 const b=backend();const getContext=async()=>{const c=ctx();if(b.uploads.length)c.company.id='intake-company-b';return c;};
 await assert.rejects(run(b,await op(),getContext),/CONTEXT_CHANGED/);assert.equal(b.writes.length,0);
});
test('cross-company row in a preflight result is rejected',async()=>{
 const b=backend(),operation=await op();b.db.supplier_invoices.push({id:operation.invoiceId,company_id:'intake-company-b'});
 await assert.rejects(run(b,operation),/INTAKE_DUPLICATE_OR_CHANGED/);assert.equal(b.writes.length,0);
});
test('two original links are never silently resolved by choosing the last result',async()=>{
 const b=backend(),operation=await op();await run(b,operation);b.db.documents.push({...b.db.documents[0],id:'another'});
 await assert.rejects(run(b,operation),/INTAKE_DOCUMENT_CONFLICT/);assert.equal(b.writes.length,3);
});
test('an approved invoice with missing original cannot be repaired through registration',async()=>{
 const b=backend({failDocumentOnce:true}),operation=await op();await assert.rejects(run(b,operation));
 b.db.supplier_invoices[0].status='approved';b.db.supplier_invoices[0].approved_by='someone';
 await assert.rejects(run(b,operation),/INTAKE_LOCKED/);assert.equal(b.writes.length,2);
});
test('PDF prefill only proposes source fields, never banking or default account',()=>{
 const facts={source:'local-pdf-text',status:'needs-review',posted:false,fields:{supplier:{value:'Synthetic supplier',verified:false},grossOre:{value:125000,verified:false},vatOre:{value:25000,verified:false}},checks:{},warnings:[]};
 const proposed=I.prefill(facts,[{id:'supplier',name:'Synthetic supplier'}]);
 assert.equal(proposed.possibleSupplierId,'supplier');assert.equal(proposed.values.totalAmount,'1250,00');
 assert.equal(proposed.values.bankgiro,undefined);assert.equal(proposed.values.defaultCostAccount,undefined);
 assert.equal(I.prefill(facts,[{id:'one',name:'Synthetic supplier'},{id:'two',name:'Synthetic supplier'}]).possibleSupplierId,null);
 assert.equal(I.prefill({...facts,checks:{creditNote:true}}).blocked,true);
 assert.equal(I.prefill({...facts,checks:{amountBalance:false}}).blocked,true);
 assert.equal(I.prefill({...facts,checks:{declaredVatRate:19}}).blocked,true);
 assert.equal(I.prefill({...facts,checks:{amountBalance:true,declaredVatRate:25}}).blocked,false);
});
test('actual intake UI keeps manual fields and discards stale extraction answers',()=>{
 const source=fs.readFileSync(require.resolve('../apps/portal/payables-intake.js'),'utf8');
 assert.match(source,/revision!==state.revision/);assert.match(source,/request!==state.readRequest/);
 assert.match(source,/if\(!form.elements\[name\].value\)/);
 assert.match(source,/Safety.validate\(input\)/);
 assert.match(source,/felaktiga totalsummor, okänd eller blandad moms/);
 assert.doesNotMatch(source,/storage.remove|\.delete\(/);
 const html=fs.readFileSync(require.resolve('../apps/portal/payables.html'),'utf8');
 for(const file of ['passive-pdf.js','supplier-persistence.js','payables-intake-safety.js','ai-document-reader.js'])assert.ok(html.includes(file));
});
