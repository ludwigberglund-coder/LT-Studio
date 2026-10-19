'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto}=require('node:crypto');
const {PDFDocument}=require('pdf-lib');
const pdfSafety=require('../apps/api/pdf-upload-security.js');

const rawEdge=fs.readFileSync(path.join(__dirname,'..','supabase','functions','archive-document-upload','index.ts'),'utf8');
const translated=stripTypeScriptTypes(rawEdge)
  .replace(/^import[^\n]*\n/gm,'')
  .replace(/Deno\.serve\(main\);\s*$/,'globalThis.handler=main;');
const origin='https://ludwigberglund-coder.github.io';
const company='synthetic-a',person='00000000-0000-4000-8000-000000008431';
const token='header.'+Buffer.from(JSON.stringify({aal:'aal2',sub:person})).toString('base64url')+'.synthetic';
const settle=()=>new Promise(resolve=>setImmediate(resolve));

async function passivePdf(active=false){
  const pdf=await PDFDocument.create();
  pdf.addPage([200,300]);
  if(active)pdf.addJavaScript('script','app.alert("not allowed")');
  return Buffer.from(await pdf.save({useObjectStreams:true}));
}
function sandboxFixture(overrides={}){
  const state={
    documents:[],objects:new Map(),uploads:0,removals:0,quotaCalls:0,
    members:0,authCalls:0,failRate:false,hasMember:true,failAfterWrite:false,
    tamperReadback:false,revokeAtFinalCheck:false,failCleanup:false,linkCompany:false,
    ...overrides
  };
  const currentUser={id:person};
  const from=(table)=>{
    const filters={};
    return {
      select(){return this;},
      eq(name,value){filters[name]=value;return this;},
      limit(){
        if(table!=='documents')throw Error('Unexpected limit '+table);
        const subset=state.documents.filter(row=>Object.entries(filters).every(([k,v])=>row[k]===v));
        return Promise.resolve({data:subset,error:null});
      },
      async maybeSingle(){
        if(table==='company_memberships'){
          state.members++;
          return {data:state.hasMember&&!(state.revokeAtFinalCheck&&state.members>=2)
            ?{role:'accountant'}:null,error:null};
        }
        if(table==='documents'){
          return {data:state.documents.find(row=>Object.entries(filters)
            .every(([k,v])=>row[k]===v))||null,error:null};
        }
        if(table==='supplier_invoices'){
          return {data:state.linkCompany?{id:filters.id}:null,error:null};
        }
        throw Error('Unexpected table '+table);
      },
      insert(row){
        if(table!=='documents')throw Error('Unexpected DB write '+table);
        return {select:()=>({single:async()=>{
          state.documents.push({...row});
          return state.failAfterWrite
            ?{data:null,error:new Error('synthetic ambiguous DB response')}
            :{data:{id:row.id},error:null};
        }})};
      }
    };
  };
  const storage={
    from(bucket){
      assert.equal(bucket,'lt-documents');
      return {
        async upload(objectPath,bytes,options){
          state.uploads++;
          assert.equal(options.upsert,false);
          assert.equal(options.contentType,'application/pdf');
          if(state.objects.has(objectPath))return {data:null,error:new Error('duplicate')};
          state.objects.set(objectPath,Buffer.from(bytes));
          return {data:{path:objectPath},error:null};
        },
        async download(objectPath){
          const bytes=state.objects.get(objectPath);
          if(!bytes)return {data:null,error:new Error('missing')};
          const body=state.tamperReadback?Buffer.from('tampered'):bytes;
          return {data:new Blob([body],{type:'application/pdf'}),error:null};
        },
        async remove(paths){
          state.removals++;
          if(state.failCleanup)return {data:null,error:new Error('cleanup failed')};
          for(const objectPath of paths)state.objects.delete(objectPath);
          return {data:[],error:null};
        }
      };
    }
  };
  const admin={
    from,storage,
    rpc:async(name,args)=>{
      assert.equal(name,'reserve_archive_pdf_upload');
      assert.equal(args.p_company_id,company);
      assert.equal(args.p_actor_id,person);
      state.quotaCalls++;
      return {data:!state.failRate,error:null};
    }
  };
  const user={
    auth:{getUser:async()=>{
      state.authCalls++;
      return {data:{user:currentUser},error:null};
    }}
  };
  const vars={
    SUPABASE_URL:'https://example.supabase.invalid',
    SUPABASE_ANON_KEY:'synthetic-public-key',
    SUPABASE_SERVICE_ROLE_KEY:'synthetic-admin-key'
  };
  const sandbox={
    createClient:(url,key)=>key==='synthetic-admin-key'?admin:user,
    MAX_PDF_BYTES:10*1024*1024,
    async assertSafePdfDeep(bytes,name){
      try{return await pdfSafety.assertSafePdfDeep(Buffer.from(bytes),{fileName:name});}
      catch(e){throw Object.assign(e,{status:e.statusCode||415});}
    },
    async sha256Hex(bytes){
      const digest=await webcrypto.subtle.digest('SHA-256',bytes);
      return Buffer.from(digest).toString('hex');
    },
    Deno:{env:{get:key=>vars[key]||null}},
    Blob,File,FormData,Request,Response,TextEncoder,TextDecoder,
    crypto:webcrypto,Uint8Array,ArrayBuffer,URL,URLSearchParams,
    atob,console:{error:()=>{}}
  };
  vm.createContext(sandbox);
  vm.runInContext(translated,sandbox,{filename:'archive-document-upload/index.ts'});
  assert.equal(typeof sandbox.handler,'function');
  return {state,handler:sandbox.handler};
}
function form(bytes,overrides={}){
  const f=new FormData();
  const fields={
    companyId:company,requestId:'synthetic-request-20261019-843-01',
    title:'Fiktivt testunderlag',category:'receipt',note:'',
    entityType:'',entityId:'',...overrides
  };
  for(const [k,v] of Object.entries(fields))if(k!=='fileName'&&k!=='mimeType')f.append(k,v);
  f.append('file',new Blob([bytes],{type:overrides.mimeType??'application/pdf'}),
    overrides.fileName||'fiktivt-underlag.pdf');
  return f;
}
async function send(fixture,body,{headers={}}={}){
  const request=new Request('https://example.supabase.invalid/functions/v1/archive-document-upload',{
    method:'POST',headers:{
      origin,authorization:'Bearer '+token,apikey:'synthetic-public-key',
      'x-lt-company-id':company,...headers
    },body
  });
  const response=await fixture.handler(request);
  return {status:response.status,body:await response.json()};
}

test('trusted Edge stores validated passive PDF bytes once with server-computed company path',async()=>{
  const bytes=await passivePdf(),fx=sandboxFixture();
  const result=await send(fx,form(bytes));
  assert.equal(result.status,201,JSON.stringify(result.body));
  assert.equal(result.body.saved,true);
  assert.match(result.body.id,/^doc_[a-f0-9]{32}$/);
  assert.equal(fx.state.quotaCalls,1);
  assert.equal(fx.state.uploads,1);
  assert.equal(fx.state.documents.length,1);
  assert.equal(fx.state.objects.size,1);
  const saved=fx.state.documents[0];
  assert.equal(saved.company_id,company);
  assert.equal(saved.uploaded_by,person);
  assert.ok(saved.object_path.startsWith(company+'/documents/'+result.body.id+'/'));
  assert.equal(saved.mime_type,'application/pdf');
  assert.ok(saved.sha256.match(/^[a-f0-9]{64}$/));
});

test('same user request is idempotent and different metadata on same request is rejected',async()=>{
  const bytes=await passivePdf(),fx=sandboxFixture();
  const first=await send(fx,form(bytes));
  assert.equal(first.status,201);
  const retry=await send(fx,form(bytes));
  assert.equal(retry.status,200);
  assert.equal(retry.body.id,first.body.id);
  assert.equal(retry.body.duplicate,true);
  assert.equal(fx.state.uploads,1);
  const changed=await send(fx,form(bytes,{title:'Nytt namn'}));
  assert.equal(changed.status,409);
  assert.equal(fx.state.documents.length,1);
});

test('embedded active JavaScript is rejected before Storage is touched',async()=>{
  const bytes=await passivePdf(true),fx=sandboxFixture();
  const result=await send(fx,form(bytes));
  assert.equal(result.status,415,JSON.stringify(result.body));
  assert.equal(fx.state.uploads,0);
  assert.equal(fx.state.documents.length,0);
});

test('disguised HTML/PDF double-extension is blocked',async()=>{
  const bytes=await passivePdf(),fx=sandboxFixture();
  const result=await send(fx,form(bytes,{fileName:'virus.html.pdf'}));
  assert.equal(result.status,415);
  assert.equal(fx.state.uploads,0);
});

test('normal multiline document comment survives server validation',async()=>{
  const bytes=await passivePdf(),fx=sandboxFixture();
  const result=await send(fx,form(bytes,{note:'Inköp till kontoret\nKontrollera kvittot'}));
  assert.equal(result.status,201,JSON.stringify(result.body));
  assert.equal(fx.state.documents[0].note,'Inköp till kontoret\nKontrollera kvittot');
});

test('company with no accounting/admin membership cannot upload',async()=>{
  const bytes=await passivePdf(),fx=sandboxFixture({hasMember:false});
  const result=await send(fx,form(bytes));
  assert.equal(result.status,403);
  assert.equal(fx.state.uploads,0);
  assert.equal(fx.state.quotaCalls,0);
});

test('untrusted cross-company body or object linkage fails before Storage write',async()=>{
  const bytes=await passivePdf(),fx=sandboxFixture();
  const foreign=await send(fx,form(bytes,{companyId:'synthetic-b'}));
  assert.equal(foreign.status,403);
  const foreignLink=await send(fx,form(bytes,{
    entityType:'supplier-invoice',entityId:'foreign-supplier-invoice'
  }));
  assert.equal(foreignLink.status,422);
  assert.equal(fx.state.uploads,0);
});

test('rate limit denies before PDF payload is decoded',async()=>{
  const bytes=await passivePdf(),fx=sandboxFixture({failRate:true});
  const result=await send(fx,form(bytes));
  assert.equal(result.status,429);
  assert.equal(fx.state.uploads,0);
  assert.equal(fx.state.documents.length,0);
});

test('PDF storage integrity mismatch is rejected and an orphan is cleaned up',async()=>{
  const bytes=await passivePdf(),fx=sandboxFixture({tamperReadback:true});
  const result=await send(fx,form(bytes));
  assert.equal(result.status,503);
  assert.equal(fx.state.uploads,1);
  assert.equal(fx.state.documents.length,0);
  assert.equal(fx.state.removals,1);
  assert.equal(fx.state.objects.size,0);
});

test('revoked company membership before final metadata insert prevents archiving',async()=>{
  const bytes=await passivePdf(),fx=sandboxFixture({revokeAtFinalCheck:true});
  const result=await send(fx,form(bytes));
  assert.equal(result.status,403);
  assert.equal(fx.state.documents.length,0);
  assert.equal(fx.state.removals,1);
});

test('ambiguous response after committed DB insert does NOT delete the original',async()=>{
  const bytes=await passivePdf(),fx=sandboxFixture({failAfterWrite:true});
  const result=await send(fx,form(bytes));
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.duplicate,true);
  assert.equal(fx.state.documents.length,1);
  assert.equal(fx.state.objects.size,1);
  assert.equal(fx.state.removals,0);
});

test('wrong origin and missing JWT never read or store original bytes',async()=>{
  const bytes=await passivePdf(),fx=sandboxFixture();
  const badOrigin=await send(fx,form(bytes),{headers:{origin:'https://forged.invalid'}});
  assert.equal(badOrigin.status,403);
  const missingJwt=await send(fx,form(bytes),{headers:{authorization:''}});
  assert.equal(missingJwt.status,401);
  assert.equal(fx.state.quotaCalls,0);
  assert.equal(fx.state.uploads,0);
});
