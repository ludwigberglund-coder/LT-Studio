'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const PdfSecurity=require('../apps/api/pdf-upload-security.js');

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
