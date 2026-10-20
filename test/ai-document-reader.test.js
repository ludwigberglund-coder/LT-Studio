'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const reader=require('../apps/portal/ai-document-reader.js');
const root=path.join(__dirname,'..');
const portal=fs.readFileSync(path.join(root,'apps/portal/ai-bookkeeping.js'),'utf8');
const html=fs.readFileSync(path.join(root,'apps/portal/ai-bookkeeping.html'),'utf8');
const css=fs.readFileSync(path.join(root,'apps/portal/ai-bookkeeping.css'),'utf8');

function pdf(text,{flate=false,additional=''}={}){
  const bytes=Buffer.from(text,'latin1');
  const payload=flate?zlib.deflateSync(bytes):bytes;
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length '+payload.length+(flate?' /Filter /FlateDecode':'')+' >>\nstream\n','latin1'),
    payload,
    Buffer.from('\nendstream\nendobj\n'+additional+'\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n','latin1')
  ]);
}
function file(buffer,name='synthetic-invoice.pdf',type='application/pdf'){
  const blob=new Blob([buffer],{type});
  return {name,type,size:blob.size,arrayBuffer:()=>blob.arrayBuffer()};
}
const invoice=[
  'BT /F1 12 Tf',
  '(Leverant\\366r: Exempel Kontor AB) Tj 0 -18 Td',
  '(Fakturanummer: INV-123) Tj 0 -18 Td',
  '(Fakturadatum: 2026-10-14) Tj 0 -18 Td',
  '(F\\366rfallodatum: 2026-11-14) Tj 0 -18 Td',
  '(Netto: 1 000,00 kr) Tj 0 -18 Td',
  '(Moms 25%: 250,00 kr) Tj 0 -18 Td',
  '(Att betala: 1 250,00 kr) Tj',
  'ET'
].join('\n');
const receipt=[
  'BT /F1 12 Tf',
  '(Butik: Testbutiken AB) Tj 0 -16 Td',
  '(Kvittonummer: K-8) Tj 0 -16 Td',
  '(K\\366pdatum: 2026-10-15) Tj 0 -16 Td',
  '(Totalt: 125,00 kr) Tj 0 -16 Td',
  '(Varav moms: 25,00 kr) Tj',
  'ET'
].join('\n');

test('reads passive Swedish digital supplier invoice PDF and reconciles amounts without external services',async()=>{
  const result=await reader.readPdf(file(pdf(invoice)),'supplier-invoice');
  assert.equal(result.status,'needs-review');
  assert.equal(result.posted,false);
  assert.equal(result.source,'local-pdf-text');
  assert.equal(result.fields.supplier.value,'Exempel Kontor AB');
  assert.equal(result.fields.reference.value,'INV-123');
  assert.equal(result.fields.invoiceDate.value,'2026-10-14');
  assert.equal(result.fields.dueDate.value,'2026-11-14');
  assert.equal(result.fields.netOre.value,100000);
  assert.equal(result.fields.vatOre.value,25000);
  assert.equal(result.fields.grossOre.value,125000);
  assert.equal(result.checks.amountBalance,true);
  assert.equal(result.warnings.length,0);
  assert.equal(result.fields.netOre.verified,false);
});
test('reads FlateDecode compressed text-based PDF receipt without OCR or model',async()=>{
  const result=await reader.readPdf(file(pdf(receipt,{flate:true}),'synthetic-receipt.pdf'),'receipt');
  assert.equal(result.documentType,'receipt');
  assert.equal(result.fields.supplier.value,'Testbutiken AB');
  assert.equal(result.fields.reference.value,'K-8');
  assert.equal(result.fields.grossOre.value,12500);
  assert.equal(result.fields.vatOre.value,2500);
  assert.equal(result.checks.amountBalance,null);
  assert.ok(result.warnings.some(x=>x.includes('stämmas av')));
});
test('does not silently choose between contradictory totals',()=>{
  const result=reader.parseFacts('Totalt: 100,00 kr\nTotalt: 200,00 kr\nDatum: 2026-10-15','receipt');
  assert.equal(result.fields.grossOre,null);
  assert.ok(result.warnings.some(x=>x.includes('Motstridiga')));
});
test('flags inconsistent amounts, unsupported currencies and invalid dates',()=>{
  const result=reader.parseFacts('Netto: 100,00 kr\nMoms: 25,00 kr\nTotalt: 140,00 kr\nDatum: 2026-02-30\nValuta EUR','supplier-invoice');
  assert.equal(result.checks.amountBalance,false);
  assert.equal(result.fields.invoiceDate,null);
  assert.ok(result.warnings.some(x=>x.includes('stämmer inte')));
  assert.ok(result.warnings.some(x=>x.includes('utländsk valuta')));
});
test('rejects non-PDF, active content, missing EOF and textless scanned PDF',async()=>{
  await assert.rejects(reader.readPdf(file(pdf(invoice),'evil.png','image/png'),'receipt'),{code:'PDF_ONLY'});
  await assert.rejects(reader.readPdf(file(pdf(invoice,{additional:'2 0 obj << /OpenAction 4 0 R >> endobj'})),'receipt'),{code:'PDF_ACTIVE_CONTENT'});
  const noEof=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'.repeat(4),'latin1');
  await assert.rejects(reader.readPdf(file(noEof),'receipt'),{code:'PDF_INVALID'});
  await assert.rejects(reader.readPdf(file(pdf('BT /F1 12 Tf ET')),'receipt'),{code:'PDF_NO_SELECTABLE_TEXT'});
});
test('rejects dangerous escaped PDF names and invalid document category',async()=>{
  await assert.rejects(reader.readPdf(file(pdf(invoice,{additional:'2 0 obj << /J#61vaScript true >> endobj'})),'receipt'),{code:'PDF_ACTIVE_CONTENT'});
  await assert.rejects(reader.readPdf(file(pdf(invoice)),'unknown'),{code:'INVALID_DOCUMENT_TYPE'});
});
test('normalizes Swedish money and dates without floating point rounding',()=>{
  assert.equal(reader.moneyOre('1 250,00 kr'),125000);
  assert.equal(reader.moneyOre('1.250,00 SEK'),125000);
  assert.equal(reader.moneyOre('1250.00'),125000);
  assert.equal(reader.moneyOre('-1250,00'),null);
  assert.equal(reader.isoDate('15.10.2026'),'2026-10-15');
  assert.equal(reader.isoDate('2026-02-30'),null);
});
test('UI uses local reader and never unlocks Cloudflare pilot or auto-posting',()=>{
  assert.match(html,/ai-document-reader\.js/);
  assert.match(portal,/data-ai-action="read-pdf"/);
  assert.match(portal,/Läs PDF lokalt/);
  assert.match(portal,/Ingen OCR av skannade bilder ännu/);
  assert.match(portal,/LTStudioDocumentReader\.readPdf\(file,localPdfType\)/);
  assert.match(portal,/const AI_PILOT_RELEASED = false;/);
  assert.doesNotMatch(reader.readPdf.toString(),/\bfetch\s*\(|\.functions\.invoke\s*\(|\.storage\.upload\s*\(/);
  assert.match(css,/\.ai-pdf-fields/);
  assert.match(css,/html\[data-lt-theme="dark"\] \.ai-pdf-reader/);
});

test('existing private document archive checks tenant path and SHA-256 before local reading',()=>{
  const docs=fs.readFileSync(path.join(root,'apps/portal/documents.js'),'utf8');
  const docsHtml=fs.readFileSync(path.join(root,'apps/portal/documents.html'),'utf8');
  assert.match(docsHtml,/ai-document-reader\.js/);
  assert.match(docs,/data-read-document/);
  assert.match(docs,/\['supplier-invoice','receipt'\]\.includes\(doc\.category\)/);
  assert.match(docs,/validArchivePath\(doc,ctx\.company\.id\)/);
  assert.match(docs,/crypto\.subtle\.digest\('SHA-256',bytes\)/);
  assert.match(docs,/actual!==doc\.sha256\.toLowerCase\(\)/);
  assert.match(docs,/LTStudioDocumentReader\.readPdf\(file,doc\.category\)/);
  assert.doesNotMatch(docs,/CLOUDFLARE_AI_TOKEN|SUPABASE_SERVICE_ROLE_KEY/);
});

test('PDF preview renders real extracted fields and escapes untrusted PDF text without AI calls',async()=>{
  const vm=require('node:vm');
  const handlers={};
  const app={innerHTML:''};
  const selected=file(pdf(invoice));
  let readCount=0;
  const sandbox={
    document:{getElementById:id=>id==='ai-bookkeeping-app'?app:
      id==='ai-pdf-file'?{files:[selected]}:null,
      addEventListener:(name,fn)=>{handlers[name]=fn}},
    window:{LTStudioDocumentReader:{readPdf:async(input,type)=>{
      readCount++;
      assert.equal(input,selected);
      assert.equal(type,'supplier-invoice');
      const result=await reader.readPdf(input,type);
      result.fields.supplier={value:'<script>alert(1)</script>',evidence:'<b>untrusted</b>',verified:false};
      return result;
    }}},
    location:{search:'?demo=1',hostname:'ludwigberglund-coder.github.io'},
    URLSearchParams,Intl,Set,Number,Object,Error,String,Array,
    crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'}
  };
  vm.runInNewContext(portal,sandbox);
  assert.match(app.innerHTML,/Läs PDF lokalt/);
  handlers.click({target:{closest:selector=>selector==='[data-ai-action]'?
    {disabled:false,dataset:{aiAction:'read-pdf'}}:null}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(readCount,1);
  assert.match(app.innerHTML,/1250|1\s*250/);
  assert.match(app.innerHTML,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(app.innerHTML,/<script>alert\(1\)<\/script>/);
  assert.match(app.innerHTML,/INTE AI/);
  assert.match(app.innerHTML,/Ej bokfört/);
});


test('PDF stream length prevents embedded endstream/endobj bytes from truncating invoices',async()=>{
  const embedded=invoice.replace('Exempel Kontor AB','endstream endobj Kontor AB');
  for(const flate of [false,true]){
    const bytes=flate?zlib.deflateSync(Buffer.from(embedded,'latin1'),{level:0}):
      Buffer.from(embedded,'latin1');
    const input=Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length '+bytes.length+
        (flate?' /Filter /FlateDecode':'')+' >>\nstream\n','latin1'),
      bytes,
      Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n','latin1')
    ]);
    assert.ok(input.includes(Buffer.from('endstream endobj')),'synthetic stream includes confusing markers');
    const result=await reader.readPdf(file(input),'supplier-invoice');
    assert.equal(result.fields.supplier.value,'endstream endobj Kontor AB');
    assert.equal(result.fields.grossOre.value,125000);
    assert.equal(result.checks.amountBalance,true);
  }
});

test('FlateDecode payload ending in a literal newline is never silently trimmed',async()=>{
  const source=Buffer.from(invoice,'latin1');
  let payload=null;
  for(let i=0;i<256;i++){
    const candidate=zlib.deflateSync(Buffer.concat([source,Buffer.from([i])]),{level:0});
    if(candidate[candidate.length-1]===10){payload=candidate;break;}
  }
  assert.ok(payload,'test fixture has a compressed stream ending in newline');
  const bytes=Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length '+payload.length+' /Filter /FlateDecode >>\nstream\n','latin1'),
    payload,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n','latin1')
  ]);
  const result=await reader.readPdf(file(bytes),'supplier-invoice');
  assert.equal(result.fields.grossOre.value,125000);
  assert.equal(result.checks.amountBalance,true);
});

test('accepts an unambiguous indirect PDF stream length and refuses contradictory length metadata',async()=>{
  const payload=Buffer.from(invoice,'latin1');
  const indirect=Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 2 0 R >>\nstream\n','latin1'),
    payload,
    Buffer.from('\nendstream\nendobj\n2 0 obj\n'+payload.length+
      '\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n','latin1')
  ]);
  const parsed=await reader.readPdf(file(indirect),'supplier-invoice');
  assert.equal(parsed.fields.grossOre.value,125000);
  const shorter=Buffer.from(pdf(invoice).toString('latin1').replace(
    /\/Length (\d+)/,(_,count)=>'/Length '+(Number(count)-3)),'latin1');
  await assert.rejects(reader.readPdf(file(shorter),'supplier-invoice'),{code:'PDF_INVALID'});
  const duplicate=Buffer.from(indirect.toString('latin1').replace(
    '\n2 0 obj\n'+payload.length+'\nendobj',
    '\n2 0 obj\n'+payload.length+'\nendobj\n2 0 obj\n'+payload.length+'\nendobj'),'latin1');
  await assert.rejects(reader.readPdf(file(duplicate),'supplier-invoice'),
    {code:'PDF_UNSUPPORTED_STREAM'});
  const noLength=Buffer.from(pdf(invoice).toString('latin1').replace(
    /\/Length \d+/,''),'latin1');
  await assert.rejects(reader.readPdf(file(noLength),'supplier-invoice'),
    {code:'PDF_UNSUPPORTED_STREAM'});
});
