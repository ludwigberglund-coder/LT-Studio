'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const PdfSecurity=require('../apps/api/pdf-upload-security.js');
const {PDFDocument}=require('pdf-lib');

function pdf(body='1 0 obj << /Type /Catalog >> endobj'){
  return Buffer.from('%PDF-1.4\n'+body+'\n%%EOF','latin1');
}

test('PDF upload security accepts a small passive PDF',()=>{
  const bytes=pdf();
  assert.deepEqual(PdfSecurity.assertSafePdf(bytes,{fileName:'faktura.pdf'}),{sizeBytes:bytes.length});
});

test('PDF upload security requires a PDF filename and signature',()=>{
  assert.throws(()=>PdfSecurity.assertSafePdf(pdf(),{fileName:'faktura.png'}),e=>e.code==='PDF_EXTENSION_REQUIRED'&&e.statusCode===415);
  assert.throws(()=>PdfSecurity.assertSafePdf(Buffer.from('not a pdf'),{fileName:'faktura.pdf'}),e=>e.code==='INVALID_PDF_SIGNATURE'&&e.statusCode===415);
});

test('PDF upload security blocks active and embedded PDF features',()=>{
  for(const body of [
    '1 0 obj << /OpenAction 2 0 R >> endobj',
    '1 0 obj << /JavaScript (app.alert(1)) >> endobj',
    '1 0 obj << /Java#53cript (app.alert(1)) >> endobj',
    '1 0 obj << /Launch 2 0 R >> endobj',
    '1 0 obj << /EmbeddedFiles 2 0 R >> endobj',
    '1 0 obj << /RichMedia 2 0 R >> endobj',
    '1 0 obj << /AcroForm 2 0 R >> endobj',
    '1 0 obj << /XFA 2 0 R >> endobj'
  ]){
    assert.throws(()=>PdfSecurity.assertSafePdf(pdf(body),{fileName:'faktura.pdf'}),e=>e.code==='ACTIVE_PDF_CONTENT_NOT_ALLOWED'&&e.statusCode===415);
  }
});

test('PDF upload security blocks encrypted PDFs',()=>{
  assert.throws(()=>PdfSecurity.assertSafePdf(pdf('trailer << /Encrypt 9 0 R >>'),{fileName:'faktura.pdf'}),e=>e.code==='ENCRYPTED_PDF_NOT_ALLOWED'&&e.statusCode===415);
});

test('PDF upload security enforces the 10 MB ceiling',()=>{
  const bytes=Buffer.alloc(PdfSecurity.MAX_PDF_BYTES+1,0x20);
  Buffer.from('%PDF-').copy(bytes,0);
  assert.throws(()=>PdfSecurity.assertSafePdf(bytes,{fileName:'stor.pdf'}),e=>e.code==='DOCUMENT_TOO_LARGE'&&e.statusCode===413);
});

test('PDF upload security rejects undersized and truncated pseudo-PDFs',()=>{
  assert.throws(()=>PdfSecurity.assertSafePdf(Buffer.from('%PDF-1.4\n%%EOF','latin1'),{fileName:'for-liten.pdf'}),e=>e.code==='DOCUMENT_TOO_SMALL'&&e.statusCode===415);
  const truncated=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n','latin1');
  assert.throws(()=>PdfSecurity.assertSafePdf(truncated,{fileName:'avhuggen.pdf'}),e=>e.code==='INVALID_PDF_EOF'&&e.statusCode===415);
});

test('PDF upload security accepts trailing PDF whitespace after EOF',()=>{
  const bytes=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n\r\t ','latin1');
  assert.deepEqual(PdfSecurity.assertSafePdf(bytes,{fileName:'faktura.pdf'}),{sizeBytes:bytes.length});
});

test('PDF upload security rejects deceptive executable-style filenames',()=>{
  const bytes=pdf();
  for(const name of ['faktura.html.pdf','bilaga.js.pdf','underlag.exe.pdf','arkiv.zip.pdf','macro.docm.pdf']){
    assert.throws(()=>PdfSecurity.assertSafePdf(bytes,{fileName:name}),e=>e.code==='DECEPTIVE_PDF_FILENAME'&&e.statusCode===415);
  }
});

test('PDF upload security requires a supported PDF version header',()=>{
  const bad=Buffer.from('%PDF-x.y\n1 0 obj << /Type /Catalog >> endobj\n%%EOF','latin1');
  assert.throws(()=>PdfSecurity.assertSafePdf(bad,{fileName:'faktura.pdf'}),e=>e.code==='INVALID_PDF_SIGNATURE'&&e.statusCode===415);
});

test('deep PDF verification accepts a structurally valid passive PDF',async()=>{
  const document=await PDFDocument.create();
  document.addPage([300,400]);
  const bytes=Buffer.from(await document.save({useObjectStreams:true}));
  await assert.doesNotReject(()=>PdfSecurity.assertSafePdfDeep(bytes,{fileName:'faktura.pdf'}));
});

test('deep PDF verification blocks JavaScript hidden in compressed PDF objects',async()=>{
  const document=await PDFDocument.create();
  document.addPage([300,400]);
  document.addJavaScript('invoice-action','app.alert("blocked")');
  const bytes=Buffer.from(await document.save({useObjectStreams:true}));
  assert.equal(bytes.toString('latin1').toLowerCase().includes('/javascript'),false);
  await assert.rejects(
    ()=>PdfSecurity.assertSafePdfDeep(bytes,{fileName:'faktura.pdf'}),
    error=>error?.code==='ACTIVE_PDF_CONTENT_NOT_ALLOWED'&&error?.statusCode===415
  );
});
