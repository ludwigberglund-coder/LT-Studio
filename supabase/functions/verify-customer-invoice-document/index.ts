import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const ALLOWED_ORIGINS=new Set(["https://ludwigberglund-coder.github.io"]);
const MAX_PDF_BYTES=10*1024*1024;

function cors(req:Request){
  const origin=req.headers.get("origin")||"";
  return {
    "Access-Control-Allow-Origin":ALLOWED_ORIGINS.has(origin)?origin:"https://ludwigberglund-coder.github.io",
    "Access-Control-Allow-Headers":"authorization, content-type, apikey",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin",
    "Content-Type":"application/json",
    "Cache-Control":"no-store"
  };
}
const reply=(req:Request,status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors(req)});
const clean=(v:unknown)=>String(v??"").trim();

function secretKey(){
  const modern=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(modern){
    try{const parsed=JSON.parse(modern);if(parsed?.default)return String(parsed.default)}catch{}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
}
function jwtClaims(token:string){
  try{
    const part=token.split(".")[1]||"";
    const normalized=part.replace(/-/g,"+").replace(/_/g,"/");
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,"=")));
  }catch{return{}}
}
function stableJson(value:unknown):string{
  if(Array.isArray(value))return "["+value.map(stableJson).join(",")+"]";
  if(value&&typeof value==="object"){
    const record=value as Record<string,unknown>;
    return "{"+Object.keys(record).sort().map(key=>JSON.stringify(key)+":"+stableJson(record[key])).join(",")+"}";
  }
  return JSON.stringify(value);
}
async function sha256Hex(bytes:Uint8Array){
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function isPdfMagic(bytes:Uint8Array){
  return bytes.length>=5&&bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46&&bytes[4]===0x2d;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST")return reply(req,405,{error:"Endast POST stöds.",code:"METHOD_NOT_ALLOWED"});
  const origin=req.headers.get("origin")||"";
  if(!ALLOWED_ORIGINS.has(origin))return reply(req,403,{error:"Dokumentverifiering får endast köras från LT Studios GitHub Pages.",code:"ORIGIN_NOT_ALLOWED"});

  try{
    const url=Deno.env.get("SUPABASE_URL")||"";
    const serviceKey=secretKey();
    const apiKey=req.headers.get("apikey")||"";
    const authorization=req.headers.get("authorization")||"";
    const token=authorization.toLowerCase().startsWith("bearer ")?authorization.slice(7).trim():"";
    if(!url||!serviceKey)throw Object.assign(new Error("Verifieringstjänsten saknar serverkonfiguration."),{status:503,code:"BACKEND_NOT_CONFIGURED"});
    if(!apiKey||!token)throw Object.assign(new Error("Giltig UAT-session krävs."),{status:401,code:"AUTH_REQUIRED"});

    const body=await req.json().catch(()=>({}));
    const companyId=clean(body.companyId);
    const requestId=clean(body.requestId);
    const purpose=clean(body.purpose);
    const objectPath=clean(body.objectPath);
    const fileName=clean(body.fileName);
    const pdfSha256=clean(body.pdfSha256).toLowerCase();
    const documentSha256=clean(body.documentSha256).toLowerCase();
    const expectedSize=Number(body.sizeBytes);
    const documentJson=body.documentJson;

    if(!companyId||!requestId.match(/^[A-Za-z0-9_-]{16,100}$/))throw Object.assign(new Error("Dokumentbegäran är ogiltig."),{status:422,code:"INVALID_REQUEST"});
    if(!["invoice","credit"].includes(purpose))throw Object.assign(new Error("Dokumenttypen är ogiltig."),{status:422,code:"INVALID_PURPOSE"});
    if(!/^[0-9a-f]{64}$/.test(pdfSha256)||!/^[0-9a-f]{64}$/.test(documentSha256))throw Object.assign(new Error("Dokumentets hash är ogiltig."),{status:422,code:"INVALID_HASH"});
    if(!Number.isSafeInteger(expectedSize)||expectedSize<=0||expectedSize>MAX_PDF_BYTES)throw Object.assign(new Error("PDF-storleken är ogiltig."),{status:422,code:"INVALID_SIZE"});
    if(!documentJson||typeof documentJson!=="object"||Array.isArray(documentJson))throw Object.assign(new Error("Fakturadokumentet är ogiltigt."),{status:422,code:"INVALID_DOCUMENT"});

    const expectedFolder=purpose==="invoice"?"customer-invoices":"customer-credit-notes";
    const parts=objectPath.split("/");
    if(parts.length!==4||parts[0]!==companyId||parts[1]!==expectedFolder||parts[2]!==requestId||parts[3]!==fileName||!fileName.toLowerCase().endsWith(".pdf")){
      throw Object.assign(new Error("PDF:ens lagringsväg är ogiltig."),{status:422,code:"INVALID_STORAGE_PATH"});
    }
    const expectedDocumentType=purpose==="invoice"?"FAKTURA":"KREDITFAKTURA";
    if(clean((documentJson as Record<string,unknown>).documentType)!==expectedDocumentType){
      throw Object.assign(new Error("Dokumenttypen matchar inte fakturaflödet."),{status:422,code:"DOCUMENT_TYPE_MISMATCH"});
    }

    const userClient=createClient(url,apiKey,{
      global:{headers:{Authorization:`Bearer ${token}`}},
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    });
    const {data:userData,error:userError}=await userClient.auth.getUser(token);
    if(userError||!userData?.user)throw Object.assign(new Error("UAT-sessionen är inte giltig."),{status:401,code:"AUTH_REQUIRED"});
    if(jwtClaims(token).aal!=="aal2")throw Object.assign(new Error("Verifierad MFA/AAL2 krävs."),{status:403,code:"MFA_REQUIRED"});

    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const {data:membership,error:membershipError}=await admin.from("company_memberships")
      .select("role").eq("company_id",companyId).eq("auth_user_id",userData.user.id).maybeSingle();
    if(membershipError)throw membershipError;
    if(!membership||!["admin","accountant"].includes(String(membership.role))){
      throw Object.assign(new Error("Du saknar behörighet att färdigställa fakturadokument."),{status:403,code:"ACCESS_DENIED"});
    }

    const calculatedDocumentSha=await sha256Hex(new TextEncoder().encode(stableJson(documentJson)));
    if(calculatedDocumentSha!==documentSha256){
      throw Object.assign(new Error("Fakturadokumentets SHA-256 stämmer inte."),{status:409,code:"DOCUMENT_HASH_MISMATCH"});
    }

    const folder=parts.slice(0,-1).join("/");
    const {data:list,error:listError}=await userClient.storage.from("lt-documents").list(folder,{limit:20,search:fileName});
    if(listError)throw listError;
    const objectInfo=(list||[]).find(item=>item.name===fileName);
    if(!objectInfo?.id)throw Object.assign(new Error("Den uppladdade PDF-filen hittades inte i privat Storage."),{status:409,code:"STORAGE_OBJECT_NOT_FOUND"});
    const metadata=(objectInfo.metadata||{}) as Record<string,unknown>;
    if(Number(metadata.size)!==expectedSize)throw Object.assign(new Error("PDF-storleken i Storage stämmer inte."),{status:409,code:"STORAGE_SIZE_MISMATCH"});
    if(clean(metadata.mimetype).toLowerCase()!=="application/pdf")throw Object.assign(new Error("Storage-objektet är inte en PDF."),{status:409,code:"STORAGE_MIME_MISMATCH"});

    const {data:fileBlob,error:downloadError}=await userClient.storage.from("lt-documents").download(objectPath);
    if(downloadError||!fileBlob)throw Object.assign(new Error("PDF-filen kunde inte verifieras från privat Storage."),{status:409,code:"STORAGE_DOWNLOAD_FAILED"});
    const bytes=new Uint8Array(await fileBlob.arrayBuffer());
    if(bytes.byteLength!==expectedSize||bytes.byteLength>MAX_PDF_BYTES)throw Object.assign(new Error("Den hämtade PDF-storleken stämmer inte."),{status:409,code:"PDF_SIZE_MISMATCH"});
    if(!isPdfMagic(bytes))throw Object.assign(new Error("Filen har inte giltig PDF-signatur."),{status:409,code:"INVALID_PDF_MAGIC"});
    const calculatedPdfSha=await sha256Hex(bytes);
    if(calculatedPdfSha!==pdfSha256)throw Object.assign(new Error("PDF-filens SHA-256 stämmer inte."),{status:409,code:"PDF_HASH_MISMATCH"});

    const {data:existing,error:existingError}=await admin.from("documents").select("id")
      .eq("company_id",companyId).eq("object_path",objectPath).limit(1);
    if(existingError)throw existingError;
    if((existing||[]).length)throw Object.assign(new Error("PDF-sökvägen är redan arkiverad."),{status:409,code:"DOCUMENT_ALREADY_ARCHIVED"});

    await admin.from("document_upload_verifications").delete()
      .eq("company_id",companyId).eq("auth_user_id",userData.user.id)
      .eq("request_id",requestId).eq("purpose",purpose);

    const expiresAt=new Date(Date.now()+5*60*1000).toISOString();
    const {data:verification,error:insertError}=await admin.from("document_upload_verifications").insert({
      company_id:companyId,
      auth_user_id:userData.user.id,
      request_id:requestId,
      purpose,
      storage_object_id:objectInfo.id,
      object_path:objectPath,
      file_name:fileName,
      document_json:documentJson,
      document_sha256:documentSha256,
      pdf_sha256:pdfSha256,
      size_bytes:expectedSize,
      expires_at:expiresAt
    }).select("id,expires_at").single();
    if(insertError||!verification)throw insertError||new Error("Verifieringsbiljetten kunde inte skapas.");

    return reply(req,200,{verified:true,verificationId:verification.id,expiresAt:verification.expires_at});
  }catch(error){
    const status=Number((error as any)?.status||500);
    const code=String((error as any)?.code||"DOCUMENT_VERIFY_ERROR");
    console.error("verify-customer-invoice-document",code);
    return reply(req,status>=500?500:status,status>=500
      ?{error:"PDF-verifieringen misslyckades på serversidan.",code}
      :{error:String((error as any)?.message||"PDF-verifieringen misslyckades."),code});
  }
});
