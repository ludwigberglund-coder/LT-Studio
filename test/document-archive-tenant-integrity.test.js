'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash,webcrypto}=require('node:crypto');

const script=fs.readFileSync(path.join(__dirname,'..','apps','portal','documents.js'),'utf8');
const bytes=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n','latin1');
const sha256=createHash('sha256').update(bytes).digest('hex');
const error=/Dokumentarkivet kunde inte verifieras för valt företag/;
const openError=/Dokumentet kan inte öppnas säkert/;

function sample(overrides={}){
  return {id:'doc-a',company_id:'tenant-a',title:'Fiktiv faktura A',
    file_name:'invoice.pdf',mime_type:'application/pdf',size_bytes:bytes.length,
    sha256,category:'supplier-invoice',
    object_path:'tenant-a/documents/doc-a/invoice.pdf',
    created_at:'2026-10-15T09:00:00Z',...overrides};
}
function fixture({rows=[sample()],delayedRows=false,delayedDownload=false,downloadBytes=bytes}={}){
  let current={
    authenticated:true,accessToken:'synthetic-token-a',
    company:{id:'tenant-a',name:'Företag A'},
    authUser:{id:'person-a'},user:{displayName:'Testperson'}
  };
  let finishRows,finishDownload,reads=0,downloads=0,opens=0,objects=0,lastBlob=null;
  const app={innerHTML:''};
  const openUrls=[];
  const doc={
    getElementById:id=>id==='documents-app'?app:null,
    addEventListener:()=>{},
    querySelector:()=>null
  };
  const fakeUrl={
    createObjectURL(blob){objects++;lastBlob=blob;return 'blob:synthetic-verified-file';},
    revokeObjectURL:()=>{}
  };
  const sandbox={
    document:doc,
    window:{
      LTSupabaseUat:{context:async()=>current},
      LTSupabase:{
        from(table,token){
          assert.equal(table,'documents');
          assert.equal(token,'synthetic-token-a');
          return {select:async(columns,filter)=>{
            reads++;
            assert.equal(columns,'*');
            assert.match(filter,/company_id=eq.tenant-a/);
            return delayedRows?new Promise(resolve=>{finishRows=resolve;}):rows;
          }};
        },
        storage:{download:async(bucket,objectPath,token)=>{
          downloads++;
          assert.equal(bucket,'lt-documents');
          assert.equal(token,'synthetic-token-a');
          assert.equal(objectPath,'tenant-a/documents/doc-a/invoice.pdf');
          return delayedDownload?new Promise(resolve=>{finishDownload=resolve;}):
            new Blob([downloadBytes],{type:'application/pdf'});
        }}
      },
      open(url,mode,features){opens++;openUrls.push({url,mode,features});return {closed:false};}
    },
    location:{hostname:'ludwigberglund-coder.github.io',search:'',href:''},
    sessionStorage:{getItem:()=>''},
    URLSearchParams,URL:fakeUrl,Blob,
    crypto:webcrypto,
    Intl,Date,Number,Object,String,Array,Set,
    setTimeout:()=>{}
  };
  const context=vm.createContext(sandbox);
  vm.runInContext(script,context,{filename:'apps/portal/documents.js'});
  return {
    app,open:()=>vm.runInContext("openSupabaseDocument('doc-a')",context),
    reload:()=>vm.runInContext('loadSupabaseDocuments()',context),
    changeSession:patch=>{current={...current,...patch};},
    setRows:value=>{rows=value;},
    finishRows:value=>{assert.equal(typeof finishRows,'function');finishRows(value);},
    finishDownload:value=>{assert.equal(typeof finishDownload,'function');
      finishDownload(new Blob([value],{type:'application/pdf'}));},
    get reads(){return reads},
    get downloads(){return downloads},
    get opens(){return opens},
    get objects(){return objects},
    get lastBlob(){return lastBlob},
    openUrls,
    code:expr=>vm.runInContext(expr,context)
  };
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));

test('verified matching archive renders, stores company identity and keeps PDF metadata private',async()=>{
  const f=fixture();
  await settled();
  assert.match(f.app.innerHTML,/Fiktiv faktura A/);
  assert.equal(f.code('documents[0].companyId'),'tenant-a');
  assert.equal(f.reads,1);
  assert.equal(f.downloads,0);
});

test('cross-company response never displays private document metadata',async()=>{
  const f=fixture({rows:[sample({id:'doc-b',title:'Foreign customer secret',
    company_id:'tenant-b',object_path:'tenant-b/documents/doc-b/private.pdf'})]});
  await settled();
  assert.match(f.app.innerHTML,error);
  assert.doesNotMatch(f.app.innerHTML,/Foreign customer secret|doc-b|tenant-b/);
  assert.equal(f.code('documents.length'),0);
  assert.equal(f.downloads,0);
});

test('mixed local and foreign rows reject entire archive, not just the foreign row',async()=>{
  const f=fixture({rows:[sample(),sample({
    id:'doc-b',company_id:'tenant-b',title:'Foreign customer secret'
  })]});
  await settled();
  assert.match(f.app.innerHTML,error);
  assert.doesNotMatch(f.app.innerHTML,/Fiktiv faktura A|Foreign customer secret/);
  assert.equal(f.code('documents.length'),0);
});

test('missing tenant identity, missing rows and malformed response all fail closed',async()=>{
  for(const rows of [[sample({company_id:null})],[null],null,{},'not-array']){
    const f=fixture({rows});await settled();
    assert.match(f.app.innerHTML,error);
    assert.equal(f.code('documents.length'),0);
  }
});

test('company switch during archive loading rejects stale response',async()=>{
  const f=fixture({delayedRows:true});
  await settled();
  f.changeSession({company:{id:'tenant-b',name:'Företag B'},accessToken:'synthetic-token-b'});
  f.finishRows([sample()]);
  await settled();
  assert.match(f.app.innerHTML,error);
  assert.doesNotMatch(f.app.innerHTML,/Fiktiv faktura A|invoice.pdf/);
  assert.equal(f.code('documents.length'),0);
});

test('cannot open old company document after switch; no Storage request is made',async()=>{
  const f=fixture();await settled();
  f.changeSession({company:{id:'tenant-b',name:'Företag B'},accessToken:'synthetic-token-b'});
  await assert.rejects(f.open(),openError);
  assert.equal(f.downloads,0);
  assert.equal(f.opens,0);
});

test('hash mismatch never opens downloaded private PDF',async()=>{
  const f=fixture({downloadBytes:Buffer.from('PDF was replaced','utf8')});
  await settled();
  await assert.rejects(f.open(),openError);
  assert.equal(f.downloads,1);
  assert.equal(f.opens,0);
  assert.equal(f.objects,0);
});

test('original PDF SHA-256 is checked before opening a PDF-only blob',async()=>{
  const f=fixture();await settled();
  await f.open();
  assert.equal(f.downloads,1);
  assert.equal(f.opens,1);
  assert.equal(f.objects,1);
  assert.equal(f.lastBlob?.type,'application/pdf');
  assert.deepEqual(f.openUrls,[{
    url:'blob:synthetic-verified-file',mode:'_blank',features:'noopener'
  }]);
});

test('late Storage download after tenant switch cannot create a PDF URL',async()=>{
  const f=fixture({delayedDownload:true});await settled();
  const opening=f.open();await settled();
  f.changeSession({company:{id:'tenant-b',name:'Företag B'}});
  f.finishDownload(bytes);
  await assert.rejects(opening,openError);
  assert.equal(f.objects,0);
  assert.equal(f.opens,0);
});

test('a changed cached metadata digest invalidates an original before download',async()=>{
  const f=fixture();await settled();
  f.code("documents[0].sha256='not-valid'");
  await assert.rejects(f.open(),openError);
  assert.equal(f.downloads,0);
});

test('the archive still uses protected, read-only Supabase Storage for viewing',()=>{
  assert.match(script,/LTSupabase\.storage\.download\('lt-documents'/);
  assert.match(script,/crypto\.subtle\.digest\('SHA-256',bytes\)/);
  assert.match(script,/sameDocumentSession\(ctx,current\)/);
  assert.match(script,/rows\.some\(row=>!row\|\|String\(row\.company_id\|\|''\)!==companyId\)/);
});
