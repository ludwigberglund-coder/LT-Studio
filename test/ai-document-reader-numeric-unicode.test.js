'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const zlib=require('node:zlib');
const reader=require('../apps/portal/ai-document-reader.js');
const {buildReview}=require('../apps/portal/ai-document-review.js');

function syntheticPdf(operands,{flate=false}={}){
  const source=Buffer.from(operands,'latin1');
  const bytes=flate?zlib.deflateSync(source):source;
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length '+bytes.length+
      (flate?' /Filter /FlateDecode':'')+' >>\nstream\n','latin1'),
    bytes,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n','latin1')
  ]);
}
function pdfFile(operands,options){
  const bytes=syntheticPdf(operands,options);
  return {name:'synthetic-invoice.pdf',type:'application/pdf',size:bytes.length,
    arrayBuffer:async()=>Uint8Array.from(bytes).buffer};
}
function utf16Hex(value,encoding='be'){
  const bytes=Buffer.from(value,'utf16le');
  if(encoding==='be'){
    for(let i=0;i<bytes.length;i+=2){
      const first=bytes[i];bytes[i]=bytes[i+1];bytes[i+1]=first;
    }
  }
  return '<'+(encoding==='be'?'FEFF':'FFFE')+bytes.toString('hex').toUpperCase()+'>';
}

test('accepts strictly grouped Swedish and international money without rounding',()=>{
  for(const [input,ore] of [
    ['1 234,56 kr',123456],
    ['1.234,56 SEK',123456],
    ['1,234.56',123456],
    ['1 234 567,89',123456789],
    ['1,234,567.89',123456789],
    ['1.234.567,89',123456789],
    ['1250',125000],
    ['1250,00',125000],
    ['0,00',0],
    ['12.34',1234]
  ])assert.equal(reader.moneyOre(input),ore,input);
});

test('rejects malformed, ambiguous or oversized amounts instead of removing punctuation',()=>{
  for(const input of [
    '1.2','1,2','12,34,56','1.234.56','1,234,56',
    '1 23,45','1.234,5678','1 234 56','1,234.5',
    '1,23,456','1.2.3','1 234,567','1234567890','1.234 56',
    '-12,50','12,34 EUR'
  ])assert.equal(reader.moneyOre(input),null,input);
});

test('malformed total on an invoice blocks accounting review rather than creating a false total',()=>{
  const result=reader.parseFacts([
    'Leverantör: Test AB','Fakturanummer: INV-17','Datum: 2026-10-15',
    'Netto: 100,00 kr','Moms: 25,00 kr','Totalt: 12,34,56 kr'
  ].join('\n'),'supplier-invoice');
  assert.equal(result.fields.grossOre,null);
  assert.ok(result.warnings.some(x=>x.includes('Totalt belopp')));
  const review=buildReview(result,{expenseAccount:'6110'});
  assert.equal(review.status,'blocked');
  assert.equal(review.rows.length,0);
  assert.equal(review.posted,false);
});

test('reads UTF-16BE BOM hex text from passive compressed Swedish PDF',async()=>{
  const lines=['Leverantör: ÅÄÖ Butik AB','Fakturanummer: UNI-17',
    'Fakturadatum: 2026-10-15','Netto: 100,00 kr',
    'Moms 25%: 25,00 kr','Totalt: 125,00 kr'];
  const content='BT /F1 12 Tf\n'+lines.map(line=>utf16Hex(line)+' Tj 0 -16 Td').join('\n')+'\nET';
  const result=await reader.readPdf(pdfFile(content,{flate:true}),'supplier-invoice');
  assert.equal(result.fields.supplier.value,'ÅÄÖ Butik AB');
  assert.equal(result.fields.reference.value,'UNI-17');
  assert.equal(result.fields.netOre.value,10000);
  assert.equal(result.fields.vatOre.value,2500);
  assert.equal(result.fields.grossOre.value,12500);
  assert.equal(result.checks.amountBalance,true);
  assert.equal(buildReview(result,{expenseAccount:'5460'}).status,'manual-review');
});

test('reads explicit UTF-16LE BOM hex text but never guesses unmarked CID glyph codes',async()=>{
  const content='BT /F1 12 Tf\n'+utf16Hex('Leverantör: Test AB','le')+' Tj\nET';
  const result=await reader.readPdf(pdfFile(content),'receipt');
  assert.equal(result.fields.supplier.value,'Test AB');
  const noBom=utf16Hex('Leverantör: Test AB').replace(/^<FEFF/,'<');
  await assert.rejects(reader.readPdf(pdfFile('BT /F1 12 Tf\n'+noBom+' Tj\nET'),'receipt'),
    {code:'PDF_NO_SELECTABLE_TEXT'});
});
