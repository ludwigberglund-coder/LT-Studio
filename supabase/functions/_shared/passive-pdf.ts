// Shared PDF gate for customer invoice finalization and generic document archive.
// Both paths reject the same dangerous formats and objects server-side.
import { PDFDocument } from "npm:pdf-lib@1.17.1";

export const MAX_PDF_BYTES=10*1024*1024;
const MIN_PDF_BYTES=32;
const ACTIVE_PDF_NAMES=["javascript","js","openaction","aa","launch","submitform","importdata","richmedia","embeddedfile","embeddedfiles","xfa","acroform"];


export async function sha256Hex(bytes:Uint8Array){
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function isPdfMagic(bytes:Uint8Array){
  return bytes.length>=5&&bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46&&bytes[4]===0x2d;
}
function latin1(bytes:Uint8Array){return new TextDecoder("windows-1252").decode(bytes)}
function decodePdfNameEscapes(value:string){
  return String(value||"").replace(/#([0-9a-fA-F]{2})/g,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));
}
export function assertSafeFileName(fileName:string){
  const name=String(fileName||"").trim().normalize("NFC");
  if(!name||name.length>180||/[\u0000-\u001f\u007f\\/]/.test(name))throw Object.assign(new Error("PDF-filnamnet är ogiltigt."),{status:415,code:"INVALID_PDF_FILENAME"});
  if(!/\.pdf$/i.test(name))throw Object.assign(new Error("Endast PDF-filer är tillåtna."),{status:415,code:"PDF_EXTENSION_REQUIRED"});
  const stem=name.slice(0,-4);
  if(/\.(?:js|mjs|cjs|html?|svg|xml|exe|dll|bat|cmd|com|ps1|sh|jar|php\d*|py|rb|pl|cgi|scr|msi|apk|app|dmg|pkg|zip|rar|7z|tar|gz|docm|xlsm|pptm)$/i.test(stem)){
    throw Object.assign(new Error("Förklädda eller körbara filändelser tillåts inte."),{status:415,code:"DECEPTIVE_PDF_FILENAME"});
  }
}
function assertNoActivePdfSyntax(value:string){
  const normalized=decodePdfNameEscapes(value).toLowerCase();
  if(/\/encrypt\b/.test(normalized))throw Object.assign(new Error("Krypterade PDF-filer tillåts inte."),{status:415,code:"ENCRYPTED_PDF_NOT_ALLOWED"});
  for(const name of ACTIVE_PDF_NAMES){
    if(new RegExp("\\/"+name+"\\b","i").test(normalized)){
      throw Object.assign(new Error("PDF-filen innehåller aktiva eller inbäddade funktioner som inte är tillåtna."),{status:415,code:"ACTIVE_PDF_CONTENT_NOT_ALLOWED"});
    }
  }
}
export async function assertSafePdfDeep(bytes:Uint8Array,fileName:string){
  assertSafeFileName(fileName);
  if(bytes.byteLength<MIN_PDF_BYTES)throw Object.assign(new Error("PDF-filen är för liten för att vara ett giltigt underlag."),{status:415,code:"DOCUMENT_TOO_SMALL"});
  if(bytes.byteLength>MAX_PDF_BYTES)throw Object.assign(new Error("PDF-filen är större än 10 MB."),{status:413,code:"DOCUMENT_TOO_LARGE"});
  if(!isPdfMagic(bytes))throw Object.assign(new Error("Filen har inte giltig PDF-signatur."),{status:415,code:"INVALID_PDF_MAGIC"});
  const head=latin1(bytes.subarray(0,16));
  if(!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r?\n|\r)/.test(head))throw Object.assign(new Error("PDF-versionen eller headern är ogiltig."),{status:415,code:"INVALID_PDF_HEADER"});
  const tail=latin1(bytes.subarray(Math.max(0,bytes.length-1024)));
  if(!/%%EOF[\x00\t\n\f\r ]*$/.test(tail))throw Object.assign(new Error("PDF-filen saknar ett giltigt slut."),{status:415,code:"INVALID_PDF_EOF"});
  assertNoActivePdfSyntax(latin1(bytes));
  let document;
  try{document=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false})}
  catch{throw Object.assign(new Error("PDF-filen kunde inte tolkas säkert."),{status:415,code:"INVALID_PDF_STRUCTURE"})}
  try{
    for(const[,object] of document.context.enumerateIndirectObjects())assertNoActivePdfSyntax(String(object));
  }catch(error){
    if((error as any)?.code==="ACTIVE_PDF_CONTENT_NOT_ALLOWED"||(error as any)?.code==="ENCRYPTED_PDF_NOT_ALLOWED")throw error;
    throw Object.assign(new Error("PDF-strukturen kunde inte säkerhetskontrolleras fullständigt."),{status:415,code:"INVALID_PDF_STRUCTURE"});
  }
}

