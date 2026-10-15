'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const reader=require('../apps/portal/ai-document-reader.js');
const review=require('../apps/portal/ai-document-review.js');

const invoice=[
  'Leverantör: Testkontor AB',
  'Fakturanummer: INV-44',
  'Fakturadatum: 2026-10-15',
  'Förfallodatum: 2026-11-15',
  'Netto: 100,00 kr',
  'Moms 25%: 25,00 kr',
  'Totalt: 125,00 kr'
];
const receipt=[
  'Butik: Testbutiken AB',
  'Kvittonummer: K-55',
  'Datum: 2026-10-15',
  'Totalt: 125,00 kr',
  'Varav moms 25%: 25,00 kr'
];
const extract=(lines,type='supplier-invoice')=>reader.parseFacts(lines.join('\n'),type);
const proposal=(result,type='supplier-invoice')=>review.buildReview(result,{
  expenseAccount:'6110',...(type==='receipt'?{paymentAccount:'1930'}:{})
});
function assertBlocked(lines,type='supplier-invoice'){
  const result=extract(lines,type);
  const p=proposal(result,type);
  assert.equal(p.status,'blocked');
  assert.equal(p.posted,false);
  assert.equal(p.saved,false);
  assert.equal(p.rows.length,0);
  assert.equal(p.requiresHumanApproval,true);
  return {result,p};
}
function pdf(rows){
  const body='BT /F1 12 Tf\n'+rows.map((line,index)=>
    '('+line.replace(/\\/g,'\\\\').replace(/[()]/g,match=>'\\'+match)+') Tj'+
    (index<rows.length-1?' 0 -18 Td':'')).join('\n')+'\nET';
  const bytes=Buffer.from(body,'latin1');
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length '+bytes.length+' >>\nstream\n','latin1'),
    bytes,Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n','latin1')
  ]);
}
test('ordinary Swedish supplier invoices and receipts still yield balanced manual previews',()=>{
  const a=extract(invoice);
  assert.equal(a.checks.creditNote,false);
  assert.equal(a.checks.negativeSummary,false);
  assert.equal(a.checks.mixedVatRates,false);
  assert.equal(a.checks.declaredVatRate,25);
  const first=proposal(a);
  assert.equal(first.status,'manual-review');
  assert.equal(first.rows.reduce((n,row)=>n+row.debitOre-row.creditOre,0),0);
  const b=extract(receipt,'receipt');
  assert.equal(b.checks.declaredVatRate,25);
  assert.equal(proposal(b,'receipt').status,'manual-review');
  const zero=extract(invoice.map(line=>
    line.startsWith('Moms ') ? 'Moms 0%: 0,00 kr':
    line.startsWith('Totalt:')?'Totalt: 100,00 kr':line));
  assert.equal(zero.checks.declaredVatRate,0);
  assert.equal(proposal(zero).status,'manual-review');
});
test('positive-valued credit invoices are not mistaken for ordinary expenses',()=>{
  for(const heading of ['KREDITFAKTURA','Kreditnota','Credit note','Fakturatyp: Kredit']){
    const {result,p}=assertBlocked([heading,...invoice]);
    assert.equal(result.checks.creditNote,true,heading);
    assert.equal(result.checks.amountBalance,true,heading);
    assert.ok(p.blockers.some(x=>x.includes('Kreditfaktura')),heading);
    assert.ok(result.warnings.some(x=>x.includes('Kreditfaktura')),heading);
  }
});
test('refund receipts with positive totals are blocked too',()=>{
  const {result,p}=assertBlocked(['RETURKVITTO',...receipt],'receipt');
  assert.equal(result.checks.creditNote,true);
  assert.ok(p.blockers.some(x=>x.includes('returkvitto')));
});
test('negative total summary blocks even when a positive alternative is present',()=>{
  const {result,p}=assertBlocked([...invoice,'Att betala: -125,00 kr']);
  assert.equal(result.fields.grossOre.value,12500);
  assert.equal(result.checks.negativeSummary,true);
  assert.ok(p.blockers.some(x=>x.includes('Negativt')));
  const unicode=extract([...invoice,'Totalt: −125,00 kr']);
  assert.equal(unicode.checks.negativeSummary,true);
  assert.equal(proposal(unicode).status,'blocked');
  const parens=extract([...invoice,'Moms: (25,00 kr)']);
  assert.equal(parens.checks.negativeSummary,true);
  assert.equal(proposal(parens).status,'blocked');
});
test('a negative discount line alone does not turn a normal invoice into a credit note',()=>{
  const result=extract([...invoice,'Rabatt: -10,00 kr']);
  assert.equal(result.checks.negativeSummary,false);
  assert.equal(result.checks.creditNote,false);
  assert.equal(proposal(result).status,'manual-review');
});
test('mixed declared VAT rates block a single-account posting preview',()=>{
  const {result,p}=assertBlocked([...invoice,'Momssats: 12%']);
  assert.equal(result.checks.mixedVatRates,true);
  assert.equal(result.checks.declaredVatRate,null);
  assert.ok(p.blockers.some(x=>x.includes('Flera momssatser')));
});
test('declared VAT rate must agree with the arithmetic, not just balance',()=>{
  const lines=invoice.map(line=>
    line.startsWith('Moms ') ? 'Moms: 12,00 kr':
    line.startsWith('Totalt:')?'Totalt: 112,00 kr':line);
  const {result,p}=assertBlocked([...lines,'Momssats: 25%']);
  assert.equal(result.checks.amountBalance,true);
  assert.equal(result.checks.declaredVatRate,25);
  assert.ok(p.blockers.some(x=>x.includes('Angiven momssats')));
  const unsupported=assertBlocked([...lines,'Momssats: 19%']);
  assert.equal(unsupported.result.checks.declaredVatRate,19);
  assert.ok(unsupported.p.blockers.some(x=>x.includes('stöds inte')));
});
test('more foreign currency codes require manual handling',()=>{
  for(const currency of ['NOK','DKK','CHF','PLN','CAD','AUD']){
    const {result,p}=assertBlocked([...invoice,'Valuta: '+currency]);
    assert.ok(result.warnings.some(x=>x.includes('utländsk valuta')),currency);
    assert.ok(p.blockers.some(x=>x.includes('utländsk valuta')),currency);
  }
});
test('untrusted or missing PDF risk flags cannot bypass the review gate',()=>{
  const result=extract(invoice);
  delete result.checks.creditNote;
  assert.throws(()=>proposal(result),{code:'UNTRUSTED_PDF_RESULT'});
  const forged=extract(invoice);
  forged.checks.mixedVatRates='false';
  assert.throws(()=>proposal(forged),{code:'UNTRUSTED_PDF_RESULT'});
  const fakeRate=extract(invoice);
  fakeRate.checks.declaredVatRate=1000;
  assert.throws(()=>proposal(fakeRate),{code:'UNTRUSTED_PDF_RESULT'});
  const extra=extract(invoice);
  extra.checks.approved=true;
  assert.throws(()=>proposal(extra),{code:'UNTRUSTED_PDF_RESULT'});
});
test('passive PDF with a positive credit note is blocked through the actual local PDF reader',async()=>{
  const bytes=pdf(['KREDITFAKTURA',...invoice]);
  const file={name:'credit.pdf',type:'application/pdf',size:bytes.length,
    arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  const extracted=await reader.readPdf(file,'supplier-invoice');
  assert.equal(extracted.fields.grossOre.value,12500);
  assert.equal(extracted.checks.creditNote,true);
  assert.equal(proposal(extracted).status,'blocked');
});
test('both AI tab and private document archive use the same fail-closed review module',()=>{
  const root=path.join(__dirname,'..','apps','portal');
  const aiHtml=fs.readFileSync(path.join(root,'ai-bookkeeping.html'),'utf8');
  const docsHtml=fs.readFileSync(path.join(root,'documents.html'),'utf8');
  const docsJs=fs.readFileSync(path.join(root,'documents.js'),'utf8');
  for(const html of [aiHtml,docsHtml]){
    assert.match(html,/ai-document-reader\.js/);
    assert.match(html,/ai-document-review\.js/);
  }
  assert.match(docsJs,/LTStudioDocumentReview\.buildReview/);
  assert.doesNotMatch(docsJs,/data-(?:save|post|approve)-document/);
});
