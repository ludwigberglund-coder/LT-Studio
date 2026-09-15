'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Automation=require('../packages/automation/proposals.js');

function base(overrides={}){
  return {
    companyId:'company-1',
    type:'bank-payment-match',
    sourceId:'bank-1',
    confidence:1,
    deterministic:true,
    reason:'OCR och exakt restbelopp matchar en enda faktura.',
    evidence:[
      {kind:'payment-reference',label:'OCR',value:'310001',sourceId:'bank-1'},
      {kind:'amount',label:'Belopp',value:'1250,00 SEK',sourceId:'bank-1'}
    ],
    suggestion:{invoiceId:'invoice-1',amountOre:125000},
    engine:{kind:'rules',name:'exact-payment-match',version:'1'},
    createdAt:'2026-09-15T10:00:00.000Z',
    ...overrides
  };
}

test('deterministisk entydig träff blir redo för godkännande men körs aldrig automatiskt',()=>{
  const proposal=Automation.createProposal(base());
  assert.equal(proposal.status,'ready-for-approval');
  assert.equal(proposal.confidence,1);
  assert.equal(proposal.deterministic,true);
  assert.equal(Automation.mayExecute(proposal),false);
});

test('AI-förslag med lägre säkerhet hamnar alltid i manuell granskning',()=>{
  const proposal=Automation.createProposal(base({
    type:'booking-account-suggestion',
    sourceId:'supplier-invoice-1',
    deterministic:false,
    confidence:.71,
    reason:'Leverantör och fakturatext liknar tidigare inköp.',
    evidence:[{kind:'invoice-text',label:'Fakturatext',value:'Frukt och grönt september',sourceId:'supplier-invoice-1'}],
    suggestion:{account:'4010',vatAccount:'2641'},
    engine:{kind:'ai',name:'future-model',version:'preview'}
  }));
  assert.equal(proposal.status,'manual-review');
  assert.equal(Automation.mayExecute(proposal),false);
});

test('även ett AI-förslag över 90 procent kräver personlig godkännare',()=>{
  const proposal=Automation.createProposal(base({deterministic:false,confidence:.96,engine:{kind:'ai',name:'future-model',version:'preview'}}));
  assert.equal(proposal.status,'ready-for-approval');
  assert.throws(()=>Automation.approveProposal(proposal,null),error=>error.code==='PERSONAL_IDENTITY_REQUIRED');
  const approved=Automation.approveProposal(proposal,{id:'user-1',name:'Anna Andersson'},{at:'2026-09-15T11:00:00.000Z'});
  assert.equal(approved.status,'approved');
  assert.equal(approved.approvedBy.id,'user-1');
  assert.equal(Automation.mayExecute(approved),false);
});

test('tvetydigt underlag går till manuell granskning oavsett säkerhetsvärde',()=>{
  const proposal=Automation.createProposal(base({ambiguous:true,confidence:.99}));
  assert.equal(proposal.status,'manual-review');
  assert.match(proposal.decisionReason,/flera möjliga/i);
});

test('förslag utan företag, bevis, förklaring eller strukturerad rekommendation stoppas',()=>{
  assert.throws(()=>Automation.createProposal(base({companyId:''})),error=>error.code==='MISSING_COMPANY');
  assert.throws(()=>Automation.createProposal(base({evidence:[]})),error=>error.code==='MISSING_EVIDENCE');
  assert.throws(()=>Automation.createProposal(base({reason:''})),error=>error.code==='MISSING_REASON');
  assert.throws(()=>Automation.createProposal(base({suggestion:null})),error=>error.code==='MISSING_SUGGESTION');
  assert.throws(()=>Automation.createProposal(base({confidence:1.2})),error=>error.code==='INVALID_CONFIDENCE');
});

test('avvisning bevarar personlig granskare och motivering',()=>{
  const proposal=Automation.createProposal(base({confidence:.4,deterministic:false}));
  const rejected=Automation.rejectProposal(proposal,{id:'user-2',name:'Erik Ek'},{reason:'Fel kund trots liknande referens.',at:'2026-09-15T12:00:00.000Z'});
  assert.equal(rejected.status,'rejected');
  assert.equal(rejected.rejectedBy.name,'Erik Ek');
  assert.equal(rejected.rejectionReason,'Fel kund trots liknande referens.');
});
