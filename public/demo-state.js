/* Startdata used when den statiska Sites-förhandsvisningen saknar lokal API-server. */
window.ROLLANDS_DEMO = {
  schemaVersion: 4,
  business: { name: 'Demo Handel AB', displayName: 'Demo Saluhall', orgNumber: '559999-0000', address: 'Exempelgatan 1, 411 00 Göteborg', phone: '031-000 00 00', email: 'kontakt@demo.example.invalid', vatNumber: 'SE559999000001', registeredOffice: 'Göteborg', invoiceContact: 'Demo Referens', paymentAccount: 'Demo bankkonto – ej betalning', sni: '47210 – Detaljhandel med frukt och grönsaker' },
  settings: { fiscalYear: '2026-01-01 – 2026-12-31', bankAccount: '1930 Företagskonto', emailInbox: 'fakturor@demo.example.invalid', aiAutoBookLimit: 0.92 },
  invoices: [
    { id:'demo_i1', number:'2026-1101', customerNumber:'K-2001', customer:'Västra Hamnen Logistik AB', address:'Hamngatan 4, 411 14 Göteborg', reference:'Företagsfrukt september', ourContact:'Demo Referens', date:'2026-09-04', dueDate:'2026-10-04', total:5000, net:4000, vat:1000, status:'Bokförd', paid:false, payments:[{id:'demo_p1',amount:2500,date:'2026-09-12',method:'Bank',reference:'HB-DEMO-1101',journalNumber:'A100'}] },
    { id:'demo_i2', number:'2026-1102', customerNumber:'K-2001', customer:'Västra Hamnen Logistik AB', address:'Hamngatan 4, 411 14 Göteborg', reference:'Korrigering av leverans', ourContact:'Demo Referens', date:'2026-09-10', dueDate:'2026-10-10', total:-800, net:-714, vat:-86, credit:true, status:'Kredit', paid:false, payments:[] },
    { id:'demo_i3', number:'2026-1103', customerNumber:'K-2002', customer:'Göteborgs Kontorsservice AB', address:'Södra Hamngatan 22, 411 14 Göteborg', reference:'Fruktkorgar vecka 37', date:'2026-09-06', dueDate:'2026-09-20', total:3200, net:2560, vat:640, status:'Betald', paid:true, payments:[{id:'demo_p2',amount:3200,date:'2026-09-18',method:'Bankgiro',reference:'BG-DEMO-1103',journalNumber:'A101'}] },
    { id:'demo_i4', number:'2026-1104', customerNumber:'K-2003', customer:'Kungsbacka Arkitekter AB', address:'Västergatan 18, 434 30 Kungsbacka', reference:'Frukt till kontoret', date:'2026-09-12', dueDate:'2026-09-27', total:1875, net:1500, vat:375, status:'Bokförd', paid:false, payments:[] },
    { id:'demo_i5', number:'2026-1105', customerNumber:'K-2004', customer:'Saltholmen Event', address:'Saltholmsgatan 44, 426 76 Västra Frölunda', reference:'Delibricka och catering', date:'2026-09-08', dueDate:'2026-09-22', total:4200, net:3360, vat:840, status:'Överbetald', paid:false, payments:[{id:'demo_p5',amount:4500,date:'2026-09-14',method:'Bank',reference:'HB-DEMO-1105',journalNumber:'A102'}] },
    { id:'demo_i6', number:'2026-1106', customerNumber:'K-2005', customer:'Testkund Norden AB', address:'Testgatan 1, 411 01 Göteborg', reference:'Testdata – öppen faktura', date:'2026-09-14', dueDate:'2026-09-24', total:950, net:760, vat:190, status:'Bokförd', paid:false, payments:[] }
  ],
  supplierInvoices: [
    { id:'demo_s1', supplier:'Västkustens Fruktgrossist AB', supplierNumber:'L-3001', invoiceNumber:'VF-91101', received:'2026-09-10', dueDate:'2026-09-17', total:12480, net:9984, vat:2496, suggestedAccount:'4010 Inköp av varor', status:'Bokförd', source:'E-post PDF', payments:[] },
    { id:'demo_s2', supplier:'Kungsbacka Energi', supplierNumber:'L-3002', invoiceNumber:'KE-55281', received:'2026-09-11', dueDate:'2026-09-16', total:1890, net:1512, vat:378, suggestedAccount:'5020 El för belysning', status:'Attest väntar', source:'E-post PDF', payments:[] },
    { id:'demo_s3', supplier:'Berglunds Bageri', supplierNumber:'L-3003', invoiceNumber:'BG-31001', received:'2026-09-12', dueDate:'2026-10-02', total:3260, net:2608, vat:652, suggestedAccount:'4010 Inköp av varor', status:'Bokförd', source:'E-post PDF', payments:[{id:'demo_sp3',amount:1000,date:'2026-09-13',method:'Bank',reference:'BG-DEMO-31001',journalNumber:'A104'}] },
    { id:'demo_s4', supplier:'Frukttransport Väst AB', supplierNumber:'L-3004', invoiceNumber:'FT-44101', received:'2026-09-14', dueDate:'2026-09-18', total:760, net:608, vat:152, suggestedAccount:'5710 Frakt och transport', status:'Attest väntar', source:'E-post PDF', payments:[] }
  ],
  bankTransactions: [
    {id:'demo_b1',date:'2026-09-12',amount:2500,text:'Västra Hamnen Logistik 2026-1101',reference:'2026-1101',transactionRef:'HB-DEMO-1101',status:'Matchad',proposal:'Matchad mot kundfaktura'},
    {id:'demo_b2',date:'2026-09-14',amount:4500,text:'Saltholmen Event överbetalning',reference:'2026-1105',transactionRef:'HB-DEMO-1105',status:'Matchad',proposal:'Överbetalning registrerad'},
    {id:'demo_b3',date:'2026-09-13',amount:-1000,text:'Berglunds Bageri BG-31001',reference:'BG-31001',transactionRef:'BG-DEMO-31001',status:'Matchad',proposal:'Delbetalning leverantör'},
    {id:'demo_b4',date:'2026-09-14',amount:-735,text:'OKÄND KORTTRANSAKTION',reference:'',transactionRef:'HB-DEMO-1104',status:'Granska',proposal:'Ingen säker konto- eller fakturaträff',reason:'Referens saknas'},
    {id:'demo_b5',date:'2026-09-14',amount:-1290,text:'Transporttjänst TESTDATA',reference:'',transactionRef:'HB-DEMO-1105',status:'Granska',proposal:'AI föreslår 5710 Frakt och transport',reason:'Kontera manuellt eller kontrollera underlag'},
    {id:'demo_b6',date:'2026-09-11',amount:3200,text:'Göteborgs Kontorsservice 2026-1103',reference:'2026-1103',transactionRef:'BG-DEMO-1103',status:'Matchad',proposal:'Matchad mot kundfaktura'}
  ],
  journal: [
    {id:'demo_v100',date:'2026-09-04',number:'A100',description:'Kundfaktura 2026-1101 – Västra Hamnen Logistik AB',source:'Kundfaktura',rows:[{account:'1510 Kundfordringar',debit:5000,credit:0},{account:'3052 Försäljning varor 12 %',debit:0,credit:4000},{account:'2621 Utgående moms 12 %',debit:0,credit:1000}]},
    {id:'demo_v101',date:'2026-09-06',number:'A101',description:'Kundfaktura 2026-1103 – Göteborgs Kontorsservice AB',source:'Kundfaktura',rows:[{account:'1510 Kundfordringar',debit:3200,credit:0},{account:'3052 Försäljning varor 12 %',debit:0,credit:2560},{account:'2621 Utgående moms 12 %',debit:0,credit:640}]},
    {id:'demo_v102',date:'2026-09-08',number:'A102',description:'Kundfaktura 2026-1105 – Saltholmen Event',source:'Kundfaktura',rows:[{account:'1510 Kundfordringar',debit:4200,credit:0},{account:'3052 Försäljning varor 12 %',debit:0,credit:3360},{account:'2621 Utgående moms 12 %',debit:0,credit:840}]},
    {id:'demo_v103',date:'2026-09-10',number:'A103',description:'Inköp Västkustens Fruktgrossist AB, VF-91101',source:'E-post PDF',rows:[{account:'4010 Inköp av varor',debit:9984,credit:0},{account:'2641 Ingående moms',debit:2496,credit:0},{account:'2440 Leverantörsskulder',debit:0,credit:12480}]},
    {id:'demo_v104',date:'2026-09-12',number:'A104',description:'Inköp Berglunds Bageri, BG-31001',source:'E-post PDF',rows:[{account:'4010 Inköp av varor',debit:2608,credit:0},{account:'2641 Ingående moms',debit:652,credit:0},{account:'2440 Leverantörsskulder',debit:0,credit:3260}]},
    {id:'demo_v105',date:'2026-09-12',number:'A105',description:'Inbetalning 2026-1101 · HB-DEMO-1101',source:'Bankavstämning',rows:[{account:'1930 Företagskonto',debit:2500,credit:0},{account:'1510 Kundfordringar',debit:0,credit:2500}]},
    {id:'demo_v106',date:'2026-09-13',number:'A106',description:'Utbetalning BG-31001 · BG-DEMO-31001',source:'Bankavstämning',rows:[{account:'2440 Leverantörsskulder',debit:1000,credit:0},{account:'1930 Företagskonto',debit:0,credit:1000}]},
    {id:'demo_v107',date:'2026-09-14',number:'A107',description:'Inbetalning 2026-1105 · HB-DEMO-1105',source:'Bankavstämning',rows:[{account:'1930 Företagskonto',debit:4500,credit:0},{account:'1510 Kundfordringar',debit:0,credit:4500}]}
  ],
  activity:[{time:'09:42',text:'2 bankhändelser behöver manuell bedömning.',kind:'warning'},{time:'09:35',text:'Kundöverbetalning 300 kr flaggad för kvittning eller återbetalning.',kind:'notice'},{time:'09:18',text:'Avstämningsdiff på kontrollkonto 1510 upptäckt.',kind:'warning'}]
};

// Extra, tydligt märkt testdata så att den delade förhandsvisningen går att prova på alla sidor.
(() => {
  const s = window.ROLLANDS_DEMO;
  if (s.settings.testDataVersion >= 2) return;
  const customerSeed = [
    ['test_i01','310001','Kvarterskrogen Linné AB',4200,'2026-08-18','2026-09-17','Företagsfrukt augusti',12],
    ['test_i02','310002','Nordic Office Göteborg AB',7850,'2026-08-22','2026-09-21','Fruktkorgar och kaffe',25],
    ['test_i03','310003','Havsbris Konferens AB',12600,'2026-08-25','2026-09-24','Konferensleverans vecka 35',12],
    ['test_i04','310004','Majorna Fastigheter AB',2350,'2026-09-01','2026-10-01','Frukt på jobbet september',25],
    ['test_i05','310005','Lindholmen Tech AB',9900,'2026-09-03','2026-10-03','Kontorsfrukt och dryck',12],
    ['test_i06','310006','Änggårdens Förskola',1680,'2026-09-05','2026-10-05','Ekologisk frukt',12],
    ['test_i07','310007','Södra Hamnens Bygg AB',5440,'2026-09-07','2026-10-07','Leverans byggbodar',25],
    ['test_i08','310008','Demo Idrottsförening',-650,'2026-09-08','2026-10-08','Kredit för returpallar',12],
    ['test_i09','310009','Västkustens Media AB',3120,'2026-09-09','2026-10-09','Fruktavtal september',6],
    ['test_i10','310010','Kustnära Konsult AB',8750,'2026-09-11','2026-10-11','Kickoff och delibrickor',25],
    ['test_i11','310011','Göta Redovisning AB',2490,'2026-09-12','2026-10-12','Fruktleverans september',12],
    ['test_i12','310012','Älvstranden Design AB',6340,'2026-09-13','2026-10-13','Företagsfrukt september',25]
  ];
  const invoices = customerSeed.map((r, index) => {
    const [id, customerNumber, customer, total, date, dueDate, reference, vatRate] = r;
    const net = Math.round(total / (1 + vatRate / 100)), vat = total - net;
    const paid = index % 4 === 0 ? Math.max(0,total) : index % 4 === 1 ? Math.max(0,Math.round(total/2)) : 0;
    return {id,number:String(310001+index),ocr:String(310001+index),customerNumber,customer,address:`Testgatan ${10+index}, 411 50 Göteborg`,reference,ourContact:'Demo Referens',date,dueDate,total,net,vat,vatRate,credit:total<0,status:total<0?'Kredit':paid>=total?'Betald':paid?'Delbetald':'Bokförd',paid:paid>=total,payments:paid?[{id:`${id}_pay`,amount:paid,date:'2026-09-14',method:index%2?'Bankgiro':'Bank',reference:`TEST-HB-${String(index+1).padStart(3,'0')}`,journalNumber:`A${180+index}`}]:[]};
  });
  s.invoices.push(...invoices);
  s.supplierInvoices.push(
    {id:'test_s01',supplier:'Frukt & Grönt Grossisten Väst AB',supplierNumber:'L-4101',invoiceNumber:'FGV-60101',received:'2026-09-05',dueDate:'2026-09-19',total:4820,net:4304,vat:516,suggestedAccount:'4010 Inköp av varor',status:'Attest väntar',source:'E-post PDF',confidence:.78,payments:[]},
    {id:'test_s02',supplier:'Bergs Kaffe & Te AB',supplierNumber:'L-4102',invoiceNumber:'BKT-88412',received:'2026-09-07',dueDate:'2026-09-21',total:2140,net:1911,vat:229,suggestedAccount:'4010 Inköp av varor',status:'Bokförd',source:'E-post PDF',confidence:.96,payments:[{id:'test_s02_pay',amount:2140,date:'2026-09-14',method:'Bank',reference:'TEST-LEV-2',journalNumber:'A201'}]},
    {id:'test_s03',supplier:'Göteborgs Kylservice AB',supplierNumber:'L-4103',invoiceNumber:'GK-202609',received:'2026-09-08',dueDate:'2026-09-20',total:3380,net:3018,vat:362,suggestedAccount:'2020 Reparation och underhåll',status:'Attest väntar',source:'E-post PDF',confidence:.81,payments:[]},
    {id:'test_s04',supplier:'Västfrakt Logistik AB',supplierNumber:'L-4104',invoiceNumber:'VF-77102',received:'2026-09-09',dueDate:'2026-09-22',total:7650,net:6830,vat:820,suggestedAccount:'5710 Frakt och transport',status:'Bokförd',source:'E-post PDF',confidence:.96,payments:[]},
    {id:'test_s05',supplier:'Demo Kontorsmaterial AB',supplierNumber:'L-4105',invoiceNumber:'BK-44381',received:'2026-09-10',dueDate:'2026-09-23',total:1280,net:1143,vat:137,suggestedAccount:'5460 Förbrukningsmaterial',status:'Attest väntar',source:'E-post PDF',confidence:.74,payments:[]},
    {id:'test_s06',supplier:'Handelsbanken Företag',supplierNumber:'L-4106',invoiceNumber:'HB-09-2026',received:'2026-09-11',dueDate:'2026-09-24',total:920,net:821,vat:99,suggestedAccount:'6570 Bankkostnader',status:'Bokförd',source:'E-post PDF',confidence:.99,payments:[]},
    {id:'test_s07',supplier:'Ren Stad Göteborg AB',supplierNumber:'L-4107',invoiceNumber:'RS-99201',received:'2026-09-12',dueDate:'2026-09-25',total:1890,net:1688,vat:202,suggestedAccount:'5060 Städning',status:'Attest väntar',source:'E-post PDF',confidence:.86,payments:[]},
    {id:'test_s08',supplier:'Matgrossisten Väst AB',supplierNumber:'L-4108',invoiceNumber:'MG-77119',received:'2026-09-13',dueDate:'2026-09-26',total:6380,net:5696,vat:684,suggestedAccount:'4010 Inköp av varor',status:'Bokförd',source:'E-post PDF',confidence:.97,payments:[]}
  );
  s.bankTransactions.push(
    {id:'test_b01',date:'2026-09-14',amount:4200,text:'KVARTERSKROGEN LINNÉ 310001',reference:'310001',transactionRef:'TEST-BANK-001',status:'Matchad',proposal:'Matchad mot kundfaktura 310001',account:'1510 Kundfordringar'},
    {id:'test_b02',date:'2026-09-14',amount:3925,text:'NORDIC OFFICE DELBETALNING',reference:'310002',transactionRef:'TEST-BANK-002',status:'Matchad',proposal:'Delbetalning kundfaktura 310002',account:'1510 Kundfordringar'},
    {id:'test_b03',date:'2026-09-14',amount:-2140,text:'BERGS KAFFE BKT-88412',reference:'BKT-88412',transactionRef:'TEST-BANK-003',status:'Matchad',proposal:'Matchad leverantörsfaktura',account:'2440 Leverantörsskulder'},
    {id:'test_b04',date:'2026-09-13',amount:-815,text:'KORTKÖP FRUKT OCH EMBALLAGE',reference:'',transactionRef:'TEST-BANK-004',status:'Granska',proposal:'AI föreslår 5460 Förbrukningsmaterial',reason:'Saknar OCR och leverantörsreferens',confidence:.71},
    {id:'test_b05',date:'2026-09-12',amount:-2460,text:'OKÄND UTBETALNING',reference:'',transactionRef:'TEST-BANK-005',status:'Granska',proposal:'Ingen säker bokning',reason:'Beloppet kan inte kopplas till öppet underlag',confidence:.42},
    {id:'test_b06',date:'2026-09-11',amount:1250,text:'SWISH FÖRSÄLJNING TEST',reference:'',transactionRef:'TEST-BANK-006',status:'Granska',proposal:'AI föreslår 3052 Försäljning varor 12 %',reason:'Manuell kontroll av dagskassa krävs',confidence:.84},
    {id:'test_b07',date:'2026-09-10',amount:-920,text:'HANDELSBANKEN AVGIFT HB-09-2026',reference:'HB-09-2026',transactionRef:'TEST-BANK-007',status:'Bokförd',proposal:'Bokförd på 6570 Bankkostnader',account:'6570 Bankkostnader'},
    {id:'test_b08',date:'2026-09-09',amount:650,text:'ÖVERBETALNING DEMO IDROTTSFÖRENING',reference:'310008',transactionRef:'TEST-BANK-008',status:'Matchad',proposal:'Tillgodohavande på kreditfaktura',account:'1510 Kundfordringar'}
  );
  invoices.forEach((invoice,index) => s.journal.push({id:`test_v${String(index+1).padStart(2,'0')}`,date:invoice.date,series:'A',number:`A${180+index}`,description:`Kundfaktura ${invoice.number} – ${invoice.customer}`,source:'Kundfaktura',rows:[{account:'1510 Kundfordringar',debit:invoice.total>0?invoice.total:0,credit:invoice.total<0?Math.abs(invoice.total):0},{account:`3052 Försäljning varor ${invoice.vatRate} %`,debit:invoice.total<0?Math.abs(invoice.net):0,credit:invoice.total>0?invoice.net:0},{account:invoice.vatRate===25?'2611 Utgående moms 25 %':'2621 Utgående moms 12 %',debit:invoice.total<0?Math.abs(invoice.vat):0,credit:invoice.total>0?invoice.vat:0}]}));
  s.journal.push({id:'test_v_diff',date:'2026-09-14',series:'A',number:'A999',description:'TESTDATA – avstämningsdiff för manuell åtgärd',source:'Testdata',rows:[{account:'1930 Företagskonto',debit:1250,credit:0},{account:'6570 Bankkostnader',debit:0,credit:1200}]});
  s.journal.forEach((entry,index) => { entry.batchNumber = String(1000 + index).padStart(4,'0'); entry.postingDate ||= entry.date; });
  s.invoices.forEach(invoice => { const entry = s.journal.find(j => j.description.includes(invoice.number)); if (entry) { invoice.batchNumber = entry.batchNumber; invoice.postingDate ||= entry.postingDate; } });
  s.invoices.forEach(invoice => [...(invoice.payments || []), ...(invoice.payouts || []), ...(invoice.offsets || [])].forEach(item => { const entry = s.journal.find(j => j.number === item.journalNumber); if (entry) item.batch = entry.batchNumber; }));
  s.activity.unshift({time:'09:10',text:'Testdata v2: 12 kundfakturor, 8 leverantörsfakturor och 8 bankhändelser har lagts till.',kind:'notice'});
  s.settings.testDataVersion = 2;
})();
