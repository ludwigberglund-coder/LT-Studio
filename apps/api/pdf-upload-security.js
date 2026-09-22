'use strict';

const MAX_PDF_BYTES=10*1024*1024;
const MIN_PDF_BYTES=32;
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
  const name=String(fileName||'').trim().normalize('NFC');
  if(!name||name.length>180||/[\u0000-\u001f\u007f\\/]/.test(name))throw pdfSecurityError('PDF-filnamnet är ogiltigt.','INVALID_PDF_FILENAME',415);
  if(!/\.pdf$/i.test(name))throw pdfSecurityError('Endast filer med .pdf-filändelse är tillåtna.','PDF_EXTENSION_REQUIRED',415);
  const stem=name.slice(0,-4);
  if(/\.(?:js|mjs|cjs|html?|svg|xml|exe|dll|bat|cmd|com|ps1|sh|jar|php\d*|py|rb|pl|cgi|scr|msi|apk|app|dmg|pkg|zip|rar|7z|tar|gz|docm|xlsm|pptm)$/i.test(stem)){
    throw pdfSecurityError('Förklädda eller körbara filändelser är inte tillåtna före .pdf.','DECEPTIVE_PDF_FILENAME',415);
  }
  return name;
}
function assertSafePdf(bytes,{fileName='document.pdf',maxBytes=MAX_PDF_BYTES}={}){
  assertPdfFileName(fileName);
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw pdfSecurityError('PDF-innehåll saknas.','MISSING_PDF_CONTENT',422);
  if(bytes.length<MIN_PDF_BYTES)throw pdfSecurityError('PDF-filen är för liten för att vara ett giltigt faktura- eller dokumentunderlag.','DOCUMENT_TOO_SMALL',415);
  if(bytes.length>maxBytes)throw pdfSecurityError(`PDF-filen får vara högst ${Math.floor(maxBytes/1024/1024)} MB.`,'DOCUMENT_TOO_LARGE',413);
  if(!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r?\n|\r)/.test(bytes.subarray(0,16).toString('latin1')))throw pdfSecurityError('Filen har inte en giltig PDF-version eller PDF-header.','INVALID_PDF_SIGNATURE',415);
  const tail=bytes.subarray(Math.max(0,bytes.length-1024)).toString('latin1');
  if(!/%%EOF[\x00\t\n\f\r ]*$/.test(tail))throw pdfSecurityError('PDF-filen saknar ett giltigt PDF-slut och avvisas.','INVALID_PDF_EOF',415);

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

module.exports=Object.freeze({MAX_PDF_BYTES,MIN_PDF_BYTES,ACTIVE_PDF_NAMES,assertPdfFileName,assertSafePdf,decodePdfNameEscapes});
