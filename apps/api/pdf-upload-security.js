'use strict';
const PdfLibrary=require('pdf-lib');
const Shared=require('../../packages/invoicing/passive-pdf.js');
function requireBuffer(bytes){
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw Object.assign(new Error('PDF-innehåll saknas.'),{code:'MISSING_PDF_CONTENT',statusCode:422});
}
function assertSafePdf(bytes,options={}){requireBuffer(bytes);return Shared.assertSafePdf(bytes,options);}
async function assertSafePdfDeep(bytes,options={}){requireBuffer(bytes);return Shared.assertSafePdfDeep(bytes,options,PdfLibrary);}
module.exports=Object.freeze({...Shared,assertSafePdf,assertSafePdfDeep});
