(function(){
  'use strict';

  const VERSION='2026-09-16-uat-v1';
  const STORAGE_KEY='rollands-integrated-demo-state-v1';
  const AS_OF_DATE='2026-09-16';

  const initialState={
    version:VERSION,
    asOfDate:AS_OF_DATE,
    customerInvoices:[
      {id:'demo-i1',kind:'customer',customerNumber:'K-1001',customerName:'Västra Hamnen Logistik AB',invoiceNumber:'310001',ocr:'310001',invoiceDate:'2026-08-18',postingDate:'2026-08-18',dueDate:'2026-09-10',totalOre:420000,remainingOre:420000,vatOre:84000,status:'Förfallen',paymentMethod:'Bankgiro',paymentAccount:'BG 123-4567',invoiceAccount:'1510',batchNumber:'1028',journalNumber:'A28',customerType:'business',reminderFeeAgreed:true,commentCount:1,transactions:[],reminders:[{id:'demo-r1',sentAt:'2026-09-15T09:00:00.000Z',kind:'payment-reminder'}]},
      {id:'demo-i2',kind:'customer',customerNumber:'K-1002',customerName:'Nordic Office Göteborg AB',invoiceNumber:'310002',ocr:'310002',invoiceDate:'2026-08-22',postingDate:'2026-08-22',dueDate:'2026-09-21',totalOre:785000,remainingOre:392500,vatOre:157000,status:'Delbetald',paymentMethod:'Bankgiro',paymentAccount:'BG 123-4567',invoiceAccount:'1510',batchNumber:'1029',journalNumber:'A29',customerType:'business',reminderFeeAgreed:true,commentCount:0,reminders:[],transactions:[{id:'demo-t1',transactionType:'payment',paymentMethod:'Bankgiro',paymentDate:'2026-09-10',postingDate:'2026-09-10',batchNumber:'1041',journalNumber:'A41',amountOre:-392500,approved:true,account:'1930'}]},
      {id:'demo-i3',kind:'customer',customerNumber:'K-1003',customerName:'Havsbris Konferens AB',invoiceNumber:'310003',ocr:'310003',invoiceDate:'2026-09-02',postingDate:'2026-09-02',dueDate:'2026-10-02',totalOre:1260000,remainingOre:1260000,vatOre:252000,status:'Bokförd',paymentMethod:'Bankgiro',paymentAccount:'BG 123-4567',invoiceAccount:'1510',batchNumber:'1030',journalNumber:'A30',customerType:'business',reminderFeeAgreed:false,commentCount:0,transactions:[],reminders:[]},
      {id:'demo-i4',kind:'customer',customerNumber:'K-1004',customerName:'Majorna Fastigheter AB',invoiceNumber:'310004',ocr:'310004',invoiceDate:'2026-09-05',postingDate:'2026-09-05',dueDate:'2026-09-12',totalOre:235000,remainingOre:0,vatOre:47000,status:'Betald',paymentMethod:'Bankgiro',paymentAccount:'BG 123-4567',invoiceAccount:'1510',batchNumber:'1031',journalNumber:'A31',customerType:'business',reminderFeeAgreed:true,commentCount:0,reminders:[],transactions:[{id:'demo-t2',transactionType:'payment',paymentMethod:'Bankgiro',paymentDate:'2026-09-12',postingDate:'2026-09-12',batchNumber:'1042',journalNumber:'A42',amountOre:-235000,approved:true,account:'1930'}]}
    ],
    customers:[
      {id:'demo-c1',customerNumber:'K-1001',name:'Västra Hamnen Logistik AB',orgNumber:'559000-1001',email:'ekonomi@vastrahamnen.example.invalid',address:'Testhamnsgatan 10, 411 00 Göteborg',paymentTermsDays:30,reminderFeeAgreed:true},
      {id:'demo-c2',customerNumber:'K-1002',name:'Nordic Office Göteborg AB',orgNumber:'559000-1002',email:'faktura@nordicoffice.example.invalid',address:'Testallén 22, 412 00 Göteborg',paymentTermsDays:30,reminderFeeAgreed:true},
      {id:'demo-c3',customerNumber:'K-1003',name:'Havsbris Konferens AB',orgNumber:'559000-1003',email:'ekonomi@havsbris.example.invalid',address:'Demovägen 3, 413 00 Göteborg',paymentTermsDays:30,reminderFeeAgreed:false},
      {id:'demo-c4',customerNumber:'K-1004',name:'Majorna Fastigheter AB',orgNumber:'559000-1004',email:'faktura@majorna.example.invalid',address:'Exempelgatan 4, 414 00 Göteborg',paymentTermsDays:30,reminderFeeAgreed:true}
    ],
    bankPayments:[
      {id:'bank-demo-1',externalId:'BG-20260916-1001',bookingDate:AS_OF_DATE,valueDate:AS_OF_DATE,amountOre:420000,currency:'SEK',reference:'310001',message:'Faktura 310001',payerName:'Västra Hamnen Logistik AB',payerAccount:'SE12••••1234',status:'unmatched'},
      {id:'bank-demo-2',externalId:'BG-20260916-1002',bookingDate:AS_OF_DATE,valueDate:AS_OF_DATE,amountOre:392500,currency:'SEK',reference:'310002',message:'Slutbetalning faktura 310002',payerName:'Nordic Office Göteborg AB',payerAccount:'SE34••••8821',status:'proposal-created'},
      {id:'bank-demo-3',externalId:'BG-20260916-1003',bookingDate:AS_OF_DATE,valueDate:AS_OF_DATE,amountOre:235000,currency:'SEK',reference:'Betalning september',message:'Tack',payerName:'Okänd betalare',payerAccount:'SE55••••9911',status:'unmatched'}
    ],
    suppliers:[
      {id:'s1',supplierNumber:'L-100',name:'Grön Grossist AB',orgNumber:'559100-1001',email:'ekonomi@grongrossist.example',bankgiro:'555-1234',plusgiro:'',defaultCostAccount:'4010'},
      {id:'s2',supplierNumber:'L-120',name:'Kustens Emballage AB',orgNumber:'559100-1209',email:'faktura@kustemballage.example',bankgiro:'777-4400',plusgiro:'',defaultCostAccount:'5460'},
      {id:'s3',supplierNumber:'L-144',name:'Demo Kyla & Service AB',orgNumber:'559100-1449',email:'faktura@billdalkyla.example',bankgiro:'333-4411',plusgiro:'',defaultCostAccount:'5510'},
      {id:'s4',supplierNumber:'L-101',name:'Göteborg Fruktlager AB',orgNumber:'559100-1019',email:'ekonomi@fruktlager.example',bankgiro:'444-8821',plusgiro:'',defaultCostAccount:'4010'}
    ],
    supplierPendingChanges:[
      {id:'chg-demo-1',supplierId:'s2',supplierName:'Kustens Emballage AB',supplierNumber:'L-120',kind:'payment-details',status:'pending',requestedBy:'demo-accountant',requestedAt:'2026-09-16T07:45:00.000Z',changes:{bankgiro:'777-4499',plusgiro:''}}
    ],
    supplierHistory:{
      s1:[{id:'h1',changeType:'profile',changedBy:'demo-accountant',changedAt:'2026-09-15T08:20:00.000Z',before:{defaultCostAccount:'4000'},after:{defaultCostAccount:'4010'}}]
    },
    supplierInvoices:[
      {id:'sinv-demo-1',supplierId:'s1',supplierName:'Grön Grossist AB',supplierNumber:'L-100',supplierInvoiceNumber:'GG-4401',invoiceDate:'2026-09-10',dueDate:AS_OF_DATE,totalOre:125000,vatOre:25000,currency:'SEK',status:'coded',registeredBy:'demo-registrar',approvedBy:null,hasDocument:true,coding:[{account:'4010',debitOre:100000,creditOre:0,text:'Varuinköp',vatCode:'INPUT_VAT'},{account:'2641',debitOre:25000,creditOre:0,text:'Ingående moms',vatCode:'INPUT_VAT'},{account:'2440',debitOre:0,creditOre:125000,text:'Leverantörsskuld',vatCode:''}]},
      {id:'sinv-demo-2',supplierId:'s2',supplierName:'Kustens Emballage AB',supplierNumber:'L-120',supplierInvoiceNumber:'KE-2088',invoiceDate:'2026-09-12',dueDate:'2026-09-20',totalOre:58900,vatOre:11780,currency:'SEK',status:'registered',registeredBy:'demo-registrar',approvedBy:null,hasDocument:true,coding:[]},
      {id:'sinv-demo-3',supplierId:'s3',supplierName:'Demo Kyla & Service AB',supplierNumber:'L-144',supplierInvoiceNumber:'BKS-771',invoiceDate:'2026-09-08',dueDate:'2026-09-14',totalOre:437500,vatOre:87500,currency:'SEK',status:'approved',registeredBy:'demo-registrar',approvedBy:'demo-approver',hasDocument:true,coding:[{account:'5510',debitOre:350000,creditOre:0,text:'Reparation och underhåll',vatCode:'INPUT_VAT'},{account:'2641',debitOre:87500,creditOre:0,text:'Ingående moms',vatCode:'INPUT_VAT'},{account:'2440',debitOre:0,creditOre:437500,text:'Leverantörsskuld',vatCode:''}]},
      {id:'sinv-demo-4',supplierId:'s4',supplierName:'Göteborg Fruktlager AB',supplierNumber:'L-101',supplierInvoiceNumber:'GF-8821',invoiceDate:'2026-09-05',dueDate:'2026-09-12',totalOre:84600,vatOre:16920,currency:'SEK',status:'paid',registeredBy:'demo-registrar',approvedBy:'demo-approver',hasDocument:true,coding:[{account:'4010',debitOre:67680,creditOre:0,text:'Varuinköp',vatCode:'INPUT_VAT'},{account:'2641',debitOre:16920,creditOre:0,text:'Ingående moms',vatCode:'INPUT_VAT'},{account:'2440',debitOre:0,creditOre:84600,text:'Leverantörsskuld',vatCode:''}]}
    ],
    supplierPayments:[
      {id:'spay-demo-paid-1',supplierInvoiceId:'sinv-demo-4',paymentDate:'2026-09-12',supplierName:'Göteborg Fruktlager AB',supplierInvoiceNumber:'GF-8821',amountOre:84600,status:'paid',preparedBy:'demo-accountant',releasedBy:'demo-approver',confirmationReference:'DEMO-GF-8821'}
    ],
    documents:[
      {id:'doc-demo-1',title:'Leverantörsfaktura GF-8821',fileName:'GF-8821.pdf',mimeType:'application/pdf',category:'supplier-invoice',sha256:'8f48f53a8d1f61473a09882c66a72f131364157b4c0133c7ce3f4452f46d1911',sizeBytes:184220,uploadedBy:'demo-accountant',createdAt:'2026-09-08T08:20:00Z',links:[{entityType:'supplier-invoice',entityId:'sinv-demo-4',label:'Original'}]},
      {id:'doc-demo-2',title:'Kvitto emballage',fileName:'kvitto-emballage.png',mimeType:'image/png',category:'receipt',sha256:'3b8f2a0d3fbc59790641529f44c2a937144a691816986782084534e9e18c1337',sizeBytes:92840,uploadedBy:'demo-inventory',createdAt:'2026-09-12T13:45:00Z',links:[{entityType:'supplier-invoice',entityId:'sinv-demo-2',label:'Kompletterande underlag'}]},
      {id:'doc-demo-3',title:'Bankunderlag 16 september',fileName:'bank-2026-09-16.pdf',mimeType:'application/pdf',category:'bank',sha256:'36e2156d594ccf4e57bb500fd477e60ab729151254ac69e3ca9e316118cc79f4',sizeBytes:242110,uploadedBy:'demo-accountant',createdAt:'2026-09-16T07:10:00Z',links:[{entityType:'bank-import',entityId:'bank-import-2026-09-16',label:'Importunderlag'}]}
    ],
    accountingEntries:[
      {id:'e1',number:'A41',postingDate:'2026-09-10',description:'Delinbetalning kundfaktura 310002',sourceType:'bank-payment',sourceId:'bank-history-310002-1',lines:[{account:'1930',text:'Företagskonto / bank',debitOre:392500,creditOre:0},{account:'1510',text:'Kundfordringar',debitOre:0,creditOre:392500}]},
      {id:'e2',number:'A42',postingDate:'2026-09-12',description:'Kundinbetalning 310004',sourceType:'bank-payment',sourceId:'bank-history-310004-1',lines:[{account:'1930',text:'Företagskonto / bank',debitOre:235000,creditOre:0},{account:'1510',text:'Kundfordringar',debitOre:0,creditOre:235000}]},
      {id:'e3',number:'B18',postingDate:'2026-09-12',description:'Betalning leverantörsfaktura GF-8821',sourceType:'supplier-payment',sourceId:'spay-demo-paid-1',lines:[{account:'2440',text:'Leverantörsskulder',debitOre:84600,creditOre:0},{account:'1930',text:'Företagskonto / bank',debitOre:0,creditOre:84600}]},
      {id:'e4',number:'L1',postingDate:'2026-09-25',description:'Lönejournal 2026-09 – Demo lönesystem',sourceType:'payroll-run',sourceId:'pay-demo-1',lines:[{account:'7010',text:'Löner',debitOre:3000000,creditOre:0},{account:'2710',text:'Personalskatt',debitOre:0,creditOre:900000},{account:'2910',text:'Löneskuld',debitOre:0,creditOre:2100000}]}
    ],
    accountingPeriods:[
      {period:'2026-08',status:'locked',lockedBy:'demo-controller',lockedAt:'2026-09-05T10:00:00Z'},
      {period:'2026-09',status:'open',lockedBy:null,lockedAt:null}
    ],
    accountingUnlockRequests:[
      {id:'u1',period:'2026-08',reason:'Efterkontroll av felaktigt kostnadskonto',status:'pending',requestedBy:'demo-accountant',requestedAt:'2026-09-16T08:15:00Z'}
    ],
    automationProposals:[
      {id:'demo-p1',type:'bank-payment-match',sourceId:'bank-demo-2',status:'ready-for-approval',confidence:1,deterministic:true,ambiguous:false,reason:'OCR 310002 och exakt restbelopp 3 925,00 kr matchar en enda kundfaktura.',decisionReason:'Deterministiska regler gav en entydig träff. En behörig person ska fortfarande godkänna åtgärden.',evidence:[{kind:'payment-reference',label:'OCR / referens',value:'310002',sourceId:'bank-demo-2'},{kind:'amount',label:'Belopp',value:'3 925,00 kr',sourceId:'bank-demo-2'}],suggestion:{action:'match-customer-payment',bankPaymentId:'bank-demo-2',invoiceId:'demo-i2',invoiceNumber:'310002',customerName:'Nordic Office Göteborg AB',amountOre:392500,bookingDate:AS_OF_DATE,bankAccount:'1930',receivableAccount:'1510'},context:{payerName:'Nordic Office Göteborg AB',reference:'310002',invoiceOptions:[{id:'demo-i2',invoiceNumber:'310002',customerName:'Nordic Office Göteborg AB',remainingOre:392500,dueDate:'2026-09-21'}]},review:{actionKind:'bank-payment-match',actionLabel:'Omför inbetalning till kundfaktura/avi',actionDescription:'Koppla inbetalningen på 3 925,00 kr till kundfaktura/avi 310002 och föreslå bokföring av bank mot kundfordran.',target:{invoiceId:'demo-i2',invoiceNumber:'310002',bankPaymentId:'bank-demo-2'},amountOre:392500,bookingDate:AS_OF_DATE,accountingLines:[{account:'1930',accountName:'Företagskonto / bank',debitOre:392500,creditOre:0,label:'Inbetalning till bank',editable:true},{account:'1510',accountName:'Kundfordringar',debitOre:0,creditOre:392500,label:'Minska kundfordran',editable:true}],editable:{accounts:true,targetInvoice:true}},engine:{kind:'rules',name:'incoming-payment-matcher',version:'2'},createdAt:'2026-09-16T07:20:00.000Z'},
      {id:'demo-p2',type:'supplier-invoice-coding',sourceId:'sinv-demo-2',status:'manual-review',confidence:.78,deterministic:false,ambiguous:true,reason:'Leverantören har standardkonto 5460 men fakturatexten innehåller både emballage och service.',decisionReason:'Underlaget är användbart men behöver mänsklig kontroll av kostnadskontot.',evidence:[{kind:'supplier-default',label:'Leverantörens standardkonto',value:'5460 Förbrukningsmaterial',sourceId:'s2'},{kind:'invoice',label:'Leverantörsfaktura',value:'KE-2088 · 589,00 kr',sourceId:'sinv-demo-2'}],suggestion:{invoiceId:'sinv-demo-2',supplierInvoiceId:'sinv-demo-2',totalOre:58900,vatOre:11780,lines:[{account:'5460',debitOre:47120,creditOre:0,text:'Förbrukningsmaterial'},{account:'2641',debitOre:11780,creditOre:0,text:'Ingående moms'},{account:'2440',debitOre:0,creditOre:58900,text:'Leverantörsskuld'}]},context:{invoiceNumber:'KE-2088',supplierName:'Kustens Emballage AB'},review:{actionKind:'supplier-invoice-coding',actionLabel:'Kontera leverantörsfaktura',actionDescription:'Fördela leverantörsfaktura KE-2088 på kostnad, ingående moms och leverantörsskuld. Kontona kan ändras innan godkännande.',target:{supplierInvoiceId:'sinv-demo-2'},amountOre:58900,bookingDate:'',accountingLines:[{account:'5460',accountName:'Förbrukningsmaterial',debitOre:47120,creditOre:0,label:'Kostnad/inköp',editable:true},{account:'2641',accountName:'Ingående moms',debitOre:11780,creditOre:0,label:'Ingående moms',editable:true},{account:'2440',accountName:'Leverantörsskulder',debitOre:0,creditOre:58900,label:'Leverantörsskuld',editable:true}],editable:{accounts:true,targetInvoice:false}},engine:{kind:'rules',name:'supplier-coding-history',version:'1'},createdAt:'2026-09-16T07:25:00.000Z'},
      {id:'demo-p3',type:'supplier-payment-preparation',sourceId:'sinv-demo-3',status:'ready-for-approval',confidence:.95,deterministic:false,ambiguous:false,reason:'Leverantörsfaktura BKS-771 är attesterad och har verifierade betalningsuppgifter.',decisionReason:'Förslaget får förbereda nästa steg men kan inte skicka pengar till banken.',evidence:[{kind:'invoice',label:'Leverantörsfaktura',value:'Demo Kyla & Service AB · BKS-771',sourceId:'sinv-demo-3'}],suggestion:{paymentId:'payment-proposal-bks-771',supplierInvoiceId:'sinv-demo-3',amountOre:437500,paymentDate:AS_OF_DATE,liabilityAccount:'2440',bankAccount:'1930'},context:{supplierName:'Demo Kyla & Service AB',invoiceNumber:'BKS-771'},review:{actionKind:'supplier-payment-preparation',actionLabel:'Förbered utbetalning',actionDescription:'Förbered utbetalning 4 375,00 kr för BKS-771. Godkännande här skickar inte pengar till banken.',target:{paymentId:'payment-proposal-bks-771',supplierInvoiceId:'sinv-demo-3'},amountOre:437500,bookingDate:AS_OF_DATE,accountingLines:[{account:'2440',accountName:'Leverantörsskulder',debitOre:437500,creditOre:0,label:'Minska leverantörsskuld',editable:true},{account:'1930',accountName:'Företagskonto / bank',debitOre:0,creditOre:437500,label:'Utbetalning från bank',editable:true}],editable:{accounts:true,targetInvoice:false}},engine:{kind:'rules',name:'supplier-payment-preparation',version:'1'},createdAt:'2026-09-16T07:30:00.000Z'}
    ]
  };

  const clone=value=>structuredClone(value);
  function state(){
    try{
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
      if(saved&&saved.version===VERSION)return saved;
    }catch{}
    const fresh=clone(initialState);
    localStorage.setItem(STORAGE_KEY,JSON.stringify(fresh));
    return fresh;
  }
  function save(next){const value=clone(next);value.version=VERSION;localStorage.setItem(STORAGE_KEY,JSON.stringify(value));return value}
  function reset(){localStorage.removeItem(STORAGE_KEY);return state()}
  function section(name){return clone(state()[name]??null)}
  function patch(mutator){const next=state();mutator(next);return save(next)}
  function bankMatchProposal(paymentId){
    const current=state();
    const payment=current.bankPayments.find(row=>row.id===paymentId);
    if(!payment)return null;
    const invoice=current.customerInvoices.find(row=>row.remainingOre===payment.amountOre&&(row.ocr===payment.reference||row.invoiceNumber===payment.reference));
    if(!invoice)return null;
    const id=`demo-bank-match-${payment.id}`;
    return {id,type:'bank-payment-match',sourceId:payment.id,status:'ready-for-approval',confidence:1,deterministic:true,ambiguous:false,reason:`Referens ${payment.reference} och exakt restbelopp matchar ${invoice.invoiceNumber}.`,decisionReason:'Deterministiska regler gav en entydig träff. En person ska fortfarande granska förslaget.',evidence:[{kind:'payment-reference',label:'Referens',value:payment.reference,sourceId:payment.id},{kind:'amount',label:'Belopp',value:`${(payment.amountOre/100).toLocaleString('sv-SE',{minimumFractionDigits:2})} kr`,sourceId:payment.id}],suggestion:{action:'match-customer-payment',bankPaymentId:payment.id,invoiceId:invoice.id,invoiceNumber:invoice.invoiceNumber,customerName:invoice.customerName,amountOre:payment.amountOre,bookingDate:payment.bookingDate,bankAccount:'1930',receivableAccount:'1510'},context:{payerName:payment.payerName,reference:payment.reference,invoiceOptions:[{id:invoice.id,invoiceNumber:invoice.invoiceNumber,customerName:invoice.customerName,remainingOre:invoice.remainingOre,dueDate:invoice.dueDate}]},review:{actionKind:'bank-payment-match',actionLabel:'Omför inbetalning till kundfaktura/avi',actionDescription:`Koppla inbetalningen till kundfaktura/avi ${invoice.invoiceNumber} och föreslå bokföring av bank mot kundfordran.`,target:{invoiceId:invoice.id,invoiceNumber:invoice.invoiceNumber,bankPaymentId:payment.id},amountOre:payment.amountOre,bookingDate:payment.bookingDate,accountingLines:[{account:'1930',accountName:'Företagskonto / bank',debitOre:payment.amountOre,creditOre:0,label:'Inbetalning till bank',editable:true},{account:'1510',accountName:'Kundfordringar',debitOre:0,creditOre:payment.amountOre,label:'Minska kundfordran',editable:true}],editable:{accounts:true,targetInvoice:true}},engine:{kind:'rules',name:'incoming-payment-matcher',version:'2'},createdAt:new Date().toISOString()};
  }

  globalThis.RollandsDemoScenario=Object.freeze({VERSION,STORAGE_KEY,AS_OF_DATE,initialState:clone(initialState),state,save,reset,section,patch,bankMatchProposal});
})();
