'use strict';
(function(root){
  const MAX_PDF_BYTES=10*1024*1024,MIN_PDF_BYTES=32;
  const ACTIVE_PDF_NAMES=Object.freeze(['javascript','js','openaction','aa','launch','submitform','importdata','richmedia','embeddedfile','embeddedfiles','xfa','acroform']);
  function error(message,code='UNSAFE_PDF',statusCode=415){return Object.assign(new Error(message),{code,statusCode});}
  function decodePdfNameEscapes(text){return String(text||'').replace(/#([0-9a-fA-F]{2})/g,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));}
  function latin1(bytes){let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return out;}
  function assertPdfFileName(fileName){
    const name=String(fileName||'').trim().normalize('NFC');
    if(!name||name.length>180||/[\u0000-\u001f\u007f\\/]/.test(name))throw error('PDF-filnamnet är ogiltigt.','INVALID_PDF_FILENAME');
    if(!/\.pdf$/i.test(name))throw error('Endast filer med .pdf-filändelse är tillåtna.','PDF_EXTENSION_REQUIRED');
    if(/\.(?:js|mjs|cjs|html?|svg|xml|exe|dll|bat|cmd|com|ps1|sh|jar|php\d*|py|rb|pl|cgi|scr|msi|apk|app|dmg|pkg|zip|rar|7z|tar|gz|docm|xlsm|pptm)$/i.test(name.slice(0,-4)))
      throw error('Förklädda eller körbara filändelser är inte tillåtna före .pdf.','DECEPTIVE_PDF_FILENAME');
    return name;
  }
  function assertNoActivePdfSyntax(syntax){
    const normalized=decodePdfNameEscapes(syntax).toLowerCase();
    if(/\/encrypt\b/.test(normalized))throw error('Krypterade PDF-filer tillåts inte eftersom innehållet inte kan säkerhetskontrolleras.','ENCRYPTED_PDF_NOT_ALLOWED');
    for(const name of ACTIVE_PDF_NAMES)if(new RegExp('\\/'+name+'\\b','i').test(normalized))
      throw error('PDF-filen innehåller aktiva eller inbäddade funktioner som inte är tillåtna.','ACTIVE_PDF_CONTENT_NOT_ALLOWED');
  }
  function assertSafePdf(bytes,{fileName='document.pdf',maxBytes=MAX_PDF_BYTES}={}){
    assertPdfFileName(fileName);
    if(!(bytes instanceof Uint8Array)||!bytes.length)throw error('PDF-innehåll saknas.','MISSING_PDF_CONTENT',422);
    if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_PDF_BYTES)throw error('PDF-storleksgränsen är ogiltig.','INVALID_PDF_LIMIT');
    if(bytes.length>maxBytes)throw error(`PDF-filen får vara högst ${Math.floor(maxBytes/1024/1024)} MB.`,'DOCUMENT_TOO_LARGE',413);
    if(bytes.length<5||latin1(bytes.subarray(0,5))!=='%PDF-')throw error('Filen är inte en PDF.','INVALID_PDF_SIGNATURE');
    assertNoActivePdfSyntax(latin1(bytes));
    return Object.freeze({sizeBytes:bytes.length});
  }
  async function assertSafePdfDeep(bytes,options={},pdfLibrary){
    const result=assertSafePdf(bytes,options);
    if(bytes.length<MIN_PDF_BYTES)throw error('PDF-filen är för liten för att vara ett giltigt faktura- eller dokumentunderlag.','DOCUMENT_TOO_SMALL');
    if(!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r?\n|\r)/.test(latin1(bytes.subarray(0,16))))throw error('Filen har inte en giltig PDF-version eller PDF-header.','INVALID_PDF_SIGNATURE');
    if(!/%%EOF[\x00\t\n\f\r ]*$/.test(latin1(bytes.subarray(Math.max(0,bytes.length-1024)))))throw error('PDF-filen saknar ett giltigt PDF-slut och avvisas.','INVALID_PDF_EOF');
    let document;
    try{document=await pdfLibrary.PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});}
    catch{throw error('PDF-filen kunde inte tolkas som ett giltigt PDF-dokument och avvisas.','INVALID_PDF_STRUCTURE');}
    try{for(const[,object]of document.context.enumerateIndirectObjects())assertNoActivePdfSyntax(String(object));}
    catch(e){if(['ACTIVE_PDF_CONTENT_NOT_ALLOWED','ENCRYPTED_PDF_NOT_ALLOWED'].includes(e?.code))throw e;throw error('PDF-strukturen kunde inte säkerhetskontrolleras fullständigt och avvisas.','INVALID_PDF_STRUCTURE');}
    return result;
  }
  const api=Object.freeze({MAX_PDF_BYTES,MIN_PDF_BYTES,ACTIVE_PDF_NAMES,assertPdfFileName,assertSafePdf,assertSafePdfDeep,decodePdfNameEscapes});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.LTStudioPassivePdf=api;
})(typeof window!=='undefined'?window:null);
