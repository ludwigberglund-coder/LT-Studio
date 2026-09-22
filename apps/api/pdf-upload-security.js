'use strict';

const MAX_PDF_BYTES=10*1024*1024;
const ACTIVE_PDF_NAMES=Object.freeze([
  'javascript','js','openaction','aa','launch','submitform','importdata',
  'richmedia','embeddedfile','embeddedfiles','xfa','acroform'
]);

function pdfSecurityError(message,code='UNSAFE_PDF',statusCode=415){
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  return error;
}
function decodePdfNameEscapes(text){
  return String(text||'').replace(/#([0-9a-fA-F]{2})/g,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));
}
function assertPdfFileName(fileName){
  const name=String(fileName||'').trim();
  if(!/\.pdf$/i.test(name))throw pdfSecurityError('Endast filer med .pdf-filändelse är tillåtna.','PDF_EXTENSION_REQUIRED',415);
  return name;
}
function assertSafePdf(bytes,{fileName='document.pdf',maxBytes=MAX_PDF_BYTES}={}){
  assertPdfFileName(fileName);
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw pdfSecurityError('PDF-innehåll saknas.','MISSING_PDF_CONTENT',422);
  if(bytes.length>maxBytes)throw pdfSecurityError(`PDF-filen får vara högst ${Math.floor(maxBytes/1024/1024)} MB.`,'DOCUMENT_TOO_LARGE',413);
  if(bytes.length<5||bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw pdfSecurityError('Filen är inte en giltig PDF.','INVALID_PDF_SIGNATURE',415);

  // PDF names can encode characters as #xx (e.g. /Java#53cript). Decode those
  // before searching so simple obfuscation cannot bypass the active-content gate.
  const syntax=decodePdfNameEscapes(bytes.toString('latin1')).toLowerCase();
  if(/\/encrypt\b/.test(syntax))throw pdfSecurityError('Krypterade PDF-filer tillåts inte eftersom innehållet inte kan säkerhetskontrolleras.','ENCRYPTED_PDF_NOT_ALLOWED',415);
  for(const name of ACTIVE_PDF_NAMES){
    const pattern=new RegExp('\\/'+name+'\\b','i');
    if(pattern.test(syntax))throw pdfSecurityError('PDF-filen innehåller aktiva eller inbäddade funktioner som inte är tillåtna.','ACTIVE_PDF_CONTENT_NOT_ALLOWED',415);
  }
  return Object.freeze({sizeBytes:bytes.length});
}

module.exports=Object.freeze({MAX_PDF_BYTES,ACTIVE_PDF_NAMES,assertPdfFileName,assertSafePdf,decodePdfNameEscapes});
