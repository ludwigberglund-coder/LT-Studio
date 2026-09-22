const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Finance = require('./public/finance.js');
const AccountPlan = require('./public/account-plan.js');
const Store = require('./lib/store.js');

const root = __dirname;
const publicDir = path.join(root, 'public');
const publicDirReal = fs.realpathSync(publicDir);
const dataDir = Store.resolveDataDir();
const dataFile = path.join(dataDir, 'store.json');
const port = Number(process.env.PORT || 4173);
const host = String(process.env.ROLLANDS_HOST || '127.0.0.1').trim();
const legacyProtectedMode = process.env.NODE_ENV === 'production' || ['staging','pilot','production'].includes(String(process.env.ROLLANDS_ENV || '').trim());
// This server is retained only for local legacy/demo development. It must never bypass the hardened private API runtime.
if (legacyProtectedMode) throw new Error('Legacy-servern får inte startas i staging, pilot eller produktion. Använd apps/api/server.js.');
if (!['127.0.0.1','localhost','::1'].includes(host)) throw new Error('Legacy-servern får bara bindas lokalt. Använd apps/api/server.js för nätverksdrift.');
const timeZone = String(process.env.ROLLANDS_TIME_ZONE || 'Europe/Stockholm').trim();
const demoDataEnabled = process.env.ROLLANDS_DEMO_DATA === '1';
const adminToken = String(process.env.ROLLANDS_ADMIN_TOKEN || '');
const secureCookie = process.env.ROLLANDS_SECURE_COOKIE === '1';
const configuredAllowedHosts = String(process.env.ROLLANDS_ALLOWED_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean);
const configuredMaxRequestBytes = Number(process.env.ROLLANDS_MAX_REQUEST_BYTES || 4_000_000);
const maxRequestBytes = Number.isSafeInteger(configuredMaxRequestBytes)
  ? Math.max(64 * 1024, Math.min(20 * 1024 * 1024, configuredMaxRequestBytes))
  : 4_000_000;
const sessions = new Map();
const loginAttempts = new Map();

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const {invoicePdf} = require('./invoice-pdf');
const InvoiceModel = require('./public/invoice-model');

function money(n) { return Math.round(Number(n || 0)); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function today() {
  return new Intl.DateTimeFormat('sv-SE', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
}
function currentFiscalYear() {
  const year = Number(today().slice(0, 4));
  return `${year}-01-01 – ${year}-12-31`;
}
function isoToSwedish(value) {
  if (!value) return today();
  const raw = value.trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw.slice(0, 10);
}
function decodeXml(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}
function xmlText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, '').trim()) : '';
}

function emptyState() {
  return {
    business: {
      name: 'Demo Handel AB',
      displayName: 'Demo Saluhall',
      orgNumber: '000000-0000',
      address: 'Exempelgatan 1, 411 00 Göteborg',
      phone: '031-000 00 00',
      email: 'kontakt@demo.example.invalid',
      sni: '47210 – Detaljhandel med frukt och grönsaker',
      vatNumber: 'SE000000000001'
    },
    settings: {
      fiscalYear: currentFiscalYear(),
      bankAccount: '1930 Företagskonto',
      aiAutoBookLimit: 0.92,
      emailInbox: 'fakturor@demo.example.invalid',
      attestResponsible: 'Ej angiven',
      attestSubstitute: 'Ej angiven',
      lastBankImport: '',
      lastInvoiceEmail: '',
      lockedPeriods: []
    },
    invoices: [],
    supplierInvoices: [],
    bankTransactions: [],
    journal: [],
    activity: [],
    auditLog: [],
    schemaVersion: 5
  };
}

function seedState() {
  return {
    business: {
      name: 'Demo Handel AB',
      displayName: 'Demo Saluhall',
      orgNumber: '000000-0000',
      address: 'Exempelgatan 1, 411 00 Göteborg',
      phone: '031-000 00 00',
      email: 'kontakt@demo.example.invalid',
      sni: '47210 – Detaljhandel med frukt och grönsaker',
      vatNumber: 'SE000000000001'
    },
    settings: {
      fiscalYear: '2026-01-01 – 2026-12-31',
      bankAccount: '1930 Företagskonto',
      aiAutoBookLimit: 0.92,
      emailInbox: 'fakturor@demo.example.invalid',
      attestResponsible: 'Demo Ansvarig',
      attestSubstitute: 'Demo Referens',
      lastBankImport: '2026-09-10',
      lastInvoiceEmail: '2026-09-09',
      lockedPeriods: []
    },
    invoices: [
      { id: 'inv_1005', number: '2026-1005', customerNumber: 'K-1001', customer: 'Västra Hamnen Logistik AB', reference: 'Företagsfrukt september', date: '2026-09-08', dueDate: '2026-09-28', total: 5000, vat: 1000, net: 4000, status: 'Skickad', channel: 'E-post', paid: false },
      { id: 'inv_1004', number: '2026-1004', customerNumber: 'K-1002', customer: 'Göteborgs Kontorsservice AB', reference: 'Fruktkorgar vecka 36', date: '2026-09-04', dueDate: '2026-09-24', total: 4375, vat: 875, net: 3500, status: 'Betald', channel: 'E-post', paid: true },
      { id: 'inv_1003', number: '2026-1003', customerNumber: 'K-1003', customer: 'Kungsbacka Arkitekter AB', reference: 'Företagsfrukt september', date: '2026-09-01', dueDate: '2026-09-21', total: 2875, vat: 575, net: 2300, status: 'Betald', channel: 'E-post', paid: true },
      { id: 'inv_1002', number: '2026-1002', customerNumber: 'K-1004', customer: 'Saltholmen Event', reference: 'Catering och delibricka', date: '2026-08-28', dueDate: '2026-09-17', total: 8625, vat: 1725, net: 6900, status: 'Betald', channel: 'E-post', paid: true }
    ],
    supplierInvoices: [
      { id: 'sup_112', supplier: 'Västkustens Fruktgrossist AB', invoiceNumber: 'VF-81194', received: '2026-09-09', dueDate: '2026-09-23', total: 12480, vat: 2496, net: 9984, suggestedAccount: '4010 Inköp av varor', status: 'Attest väntar', source: 'E-post PDF', confidence: 0.97 },
      { id: 'sup_111', supplier: 'Berglunds Bageri', invoiceNumber: 'BG-20918', received: '2026-09-07', dueDate: '2026-09-17', total: 3260, vat: 652, net: 2608, suggestedAccount: '4010 Inköp av varor', status: 'Bokförd', source: 'E-post PDF', confidence: 0.94 },
      { id: 'sup_110', supplier: 'Kungsbacka Energi', invoiceNumber: 'KE-442881', received: '2026-09-05', dueDate: '2026-09-25', total: 1890, vat: 378, net: 1512, suggestedAccount: '5020 El för belysning', status: 'Bokförd', source: 'E-post PDF', confidence: 0.99 }
    ],
    bankTransactions: [
      { id: 'bank_001', date: '2026-09-10', text: 'INBETALNING 2026-1004 GÖTEBORGS KONTORSSERVICE', amount: 4375, direction: 'in', reference: '2026-1004', status: 'Matchad', confidence: 0.99, proposal: 'Matcha kundfaktura 2026-1004', account: '1510 Kundfordringar', transactionRef: 'HB-20260910-001' },
      { id: 'bank_002', date: '2026-09-10', text: 'AUTOGIRO KUNGSBACKA ENERGI', amount: -1890, direction: 'out', reference: 'KE-442881', status: 'Matchad', confidence: 0.98, proposal: 'Matcha leverantörsfaktura KE-442881', account: '2440 Leverantörsskulder', transactionRef: 'HB-20260910-002' },
      { id: 'bank_003', date: '2026-09-09', text: 'SWISH 123 481 95 23 LUNCH', amount: 698, direction: 'in', reference: '', status: 'Granska', confidence: 0.63, proposal: 'Förslag: 3010 Försäljning varor, 12 % moms', account: '3010 Försäljning varor', transactionRef: 'HB-20260909-006', reason: 'Saknar fakturareferens och återkommande motpart.' },
      { id: 'bank_004', date: '2026-09-08', text: 'KORTKÖP MARKETPLACE', amount: -459, direction: 'out', reference: '', status: 'Granska', confidence: 0.38, proposal: 'Ingen säker bokning', account: '', transactionRef: 'HB-20260908-017', reason: 'Okänd leverantör. Behöver kvitto eller konto.' }
    ],
    journal: [
      { id: 'ver_A25', date: '2026-09-10', postingDate: '2026-09-10', series: 'A', number: 'A25', batchNumber: '1025', description: 'Inbetalning kundfaktura 2026-1004', rows: [{ account: '1930 Företagskonto', debit: 4375, credit: 0 }, { account: '1510 Kundfordringar', debit: 0, credit: 4375 }], source: 'Bankimport' },
      { id: 'ver_A24', date: '2026-09-10', postingDate: '2026-09-10', series: 'A', number: 'A24', batchNumber: '1024', description: 'Betalning KE-442881', rows: [{ account: '2440 Leverantörsskulder', debit: 1890, credit: 0 }, { account: '1930 Företagskonto', debit: 0, credit: 1890 }], source: 'Bankimport' },
      { id: 'ver_A23', date: '2026-09-09', postingDate: '2026-09-09', series: 'A', number: 'A23', batchNumber: '1023', description: 'Inköp Berglunds Bageri, BG-20918', rows: [{ account: '4010 Inköp av varor', debit: 2608, credit: 0 }, { account: '2641 Ingående moms', debit: 652, credit: 0 }, { account: '2440 Leverantörsskulder', debit: 0, credit: 3260 }], source: 'E-post PDF' }
    ],
    activity: [
      { time: '09:42', text: 'AI matchade inbetalning 4 375 kr mot faktura 2026-1004.', kind: 'success' },
      { time: '09:35', text: 'Ny leverantörsfaktura från Västkustens Fruktgrossist väntar på attest.', kind: 'notice' },
      { time: '09:18', text: 'Två bankhändelser behöver manuell bedömning.', kind: 'warning' }
    ],
    auditLog: []
  };
}

function addExpandedTestData(store) {
  if (Number(store.settings?.testDataVersion || 0) >= 2) return false;
  const customers = [
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
  const invoiceRows = customers.map((row, index) => {
    const [idValue, customerNumber, customer, total, date, dueDate, reference, vatRate] = row;
    const net = Math.round(total / (1 + vatRate / 100));
    const vat = total - net;
    const paid = index % 4 === 0 ? Math.max(0, total) : index % 4 === 1 ? Math.max(0, Math.round(total / 2)) : 0;
    const payments = paid ? [{ id: `${idValue}_pay`, amount: paid, date: '2026-09-14', method: index % 2 ? 'Bankgiro' : 'Bank', reference: `TEST-HB-${String(index + 1).padStart(3, '0')}`, journalNumber: `A${180 + index}` }] : [];
    return { id: idValue, number: String(310001 + index), ocr: String(310001 + index), customerNumber, customer, address: `Testgatan ${10 + index}, 4${11 + index} 50 Göteborg`, reference, ourContact: 'Demo Referens', date, dueDate, total, net, vat, vatRate, status: total < 0 ? 'Kredit' : paid >= total ? 'Betald' : paid ? 'Delbetald' : 'Bokförd', paid: paid >= total, payments };
  });
  const suppliers = [
    ['test_s01','L-4101','Frukt & Grönt Grossisten Väst AB','FGV-60101',4820,'2026-09-05','2026-09-19','4010 Inköp av varor','Attest väntar'],
    ['test_s02','L-4102','Bergs Kaffe & Te AB','BKT-88412',2140,'2026-09-07','2026-09-21','4010 Inköp av varor','Bokförd'],
    ['test_s03','L-4103','Göteborgs Kylservice AB','GK-202609',3380,'2026-09-08','2026-09-22','5500 Reparation och underhåll','Attest väntar'],
    ['test_s04','L-4104','Västfrakt Logistik AB','VF-77102',7650,'2026-09-09','2026-09-23','5710 Frakter och transporter','Bokförd'],
    ['test_s05','L-4105','Demo Kontorsmaterial AB','BK-44381',1280,'2026-09-10','2026-09-24','5460 Förbrukningsmaterial','Attest väntar'],
    ['test_s06','L-4106','Handelsbanken Företag','HB-09-2026',920,'2026-09-11','2026-09-25','6570 Bankkostnader','Bokförd'],
    ['test_s07','L-4107','Ren Stad Göteborg AB','RS-99201',1890,'2026-09-12','2026-09-26','5060 Städning och renhållning','Attest väntar'],
    ['test_s08','L-4108','Matgrossisten Väst AB','MG-77119',6380,'2026-09-13','2026-09-27','4010 Inköp av varor','Bokförd']
  ];
  const supplierRows = suppliers.map(([idValue, supplierNumber, supplier, invoiceNumber, total, received, dueDate, suggestedAccount, status], index) => ({ id:idValue, supplierNumber, supplier, invoiceNumber, received, dueDate, total, net:Math.round(total/1.12), vat:total-Math.round(total/1.12), suggestedAccount, status, source:'E-post PDF', confidence: index % 3 === 0 ? .78 : .96, payments: status === 'Bokförd' && index % 2 === 1 ? [{id:`${idValue}_pay`, amount:total, date:'2026-09-14', method:'Bank', reference:`TEST-LEV-${index+1}`, journalNumber:`A${200+index}`}] : [] }));
  const bank = [
    {id:'test_b01',date:'2026-09-14',amount:4200,text:'KVARTERSKROGEN LINNÉ 310001',reference:'310001',transactionRef:'TEST-BANK-001',status:'Matchad',proposal:'Matchad mot kundfaktura 310001',account:'1510 Kundfordringar'},
    {id:'test_b02',date:'2026-09-14',amount:3925,text:'NORDIC OFFICE DELBETALNING',reference:'310002',transactionRef:'TEST-BANK-002',status:'Matchad',proposal:'Delbetalning kundfaktura 310002',account:'1510 Kundfordringar'},
    {id:'test_b03',date:'2026-09-14',amount:-2140,text:'BERGS KAFFE BKT-88412',reference:'BKT-88412',transactionRef:'TEST-BANK-003',status:'Matchad',proposal:'Matchad leverantörsfaktura',account:'2440 Leverantörsskulder'},
    {id:'test_b04',date:'2026-09-13',amount:-815,text:'KORTKÖP FRUKT OCH EMBALLAGE',reference:'',transactionRef:'TEST-BANK-004',status:'Granska',proposal:'AI föreslår 5460 Förbrukningsmaterial',reason:'Saknar OCR och leverantörsreferens',confidence:.71},
    {id:'test_b05',date:'2026-09-12',amount:-2460,text:'OKÄND UTBETALNING',reference:'',transactionRef:'TEST-BANK-005',status:'Granska',proposal:'Ingen säker bokning',reason:'Beloppet kan inte kopplas till öppet underlag',confidence:.42},
    {id:'test_b06',date:'2026-09-11',amount:1250,text:'SWISH FÖRSÄLJNING TEST',reference:'',transactionRef:'TEST-BANK-006',status:'Granska',proposal:'AI föreslår 3052 Försäljning varor 12 %',reason:'Manuell kontroll av dagskassa krävs',confidence:.84},
    {id:'test_b07',date:'2026-09-10',amount:-920,text:'HANDELSBANKEN AVGIFT HB-09-2026',reference:'HB-09-2026',transactionRef:'TEST-BANK-007',status:'Bokförd',proposal:'Bokförd på 6570 Bankkostnader',account:'6570 Bankkostnader'},
    {id:'test_b08',date:'2026-09-09',amount:650,text:'ÖVERBETALNING DEMO IDROTTSFÖRENING',reference:'310008',transactionRef:'TEST-BANK-008',status:'Matchad',proposal:'Tillgodohavande på kreditfaktura',account:'1510 Kundfordringar'}
  ];
  const journals = invoiceRows.map((invoice, index) => ({id:`test_v${String(index+1).padStart(2,'0')}`,date:invoice.date,series:'A',number:`A${180+index}`,description:`Kundfaktura ${invoice.number} – ${invoice.customer}`,source:'Kundfaktura',rows:[{account:'1510 Kundfordringar',debit:invoice.total > 0 ? invoice.total : 0,credit:invoice.total < 0 ? Math.abs(invoice.total) : 0},{account:`3052 Försäljning varor ${invoice.vatRate} %`,debit:invoice.total < 0 ? Math.abs(invoice.net) : 0,credit:invoice.total > 0 ? invoice.net : 0},{account:invoice.vatRate===25?'2611 Utgående moms 25 %':'2621 Utgående moms 12 %',debit:invoice.total < 0 ? Math.abs(invoice.vat) : 0,credit:invoice.total > 0 ? invoice.vat : 0}]}));
  store.invoices.push(...invoiceRows);
  store.supplierInvoices.push(...supplierRows);
  store.bankTransactions.push(...bank);
  store.journal.push(...journals);
  store.activity.unshift({time:'09:10',text:'Testdata v2: 12 kundfakturor, 8 leverantörsfakturor och 8 bankhändelser har lagts till.',kind:'notice'});
  store.settings.testDataVersion = 2;
  return true;
}
function ensureBatchNumbers(store) {
  let changed = false;
  for (const entry of store.journal || []) {
    if (!/^\d{4}$/.test(String(entry.batchNumber || ''))) { entry.batchNumber = nextBatchNumber(store); changed = true; }
    entry.postingDate ||= entry.date;
  }
  const journals = new Map((store.journal || []).map(entry => [entry.number, entry]));
  for (const tx of store.bankTransactions || []) {
    const matches = (store.journal || []).filter(j => j.source === 'Bankavstämning' && tx.transactionRef && String(j.description || '').includes(tx.transactionRef));
    const entry = journals.get(tx.journalNumber) || (matches.length === 1 ? matches[0] : null);
    if (entry && !tx.batch) { tx.batch = entry.batchNumber; tx.journalNumber ||= entry.number; changed = true; }
  }
  for (const invoice of [...(store.invoices || []), ...(store.supplierInvoices || [])]) {
    const entry = journals.get(invoice.journalNumber);
    if (entry && !invoice.batchNumber) { invoice.batchNumber = entry.batchNumber; changed = true; }
    for (const payment of [...(invoice.payments || []), ...(invoice.payouts || []), ...(invoice.offsets || [])]) {
      const paymentEntry = journals.get(payment.journalNumber);
      if (paymentEntry && !payment.batch) { payment.batch = paymentEntry.batchNumber; changed = true; }
    }
  }
  return changed;
}

function ensureStore() {
  fs.mkdirSync(dataDir, {recursive: true, mode: 0o700});
  if (!fs.existsSync(dataFile) && !fs.existsSync(`${dataFile}.bak`)) Store.atomicWriteJson(dataFile, demoDataEnabled ? seedState() : emptyState());
}
function readStore({allowInvalid = false} = {}) {
  ensureStore();
  const loaded = Store.loadJsonWithBackup(dataFile);
  const store = loaded.data;
  const expanded = demoDataEnabled ? addExpandedTestData(store) : false;
  const migrate = store.schemaVersion !== 5;
  Finance.normalize(store);
  const batches = ensureBatchNumbers(store);
  let auditBackfilled = false;
  if (!store.auditLog.length && store.journal?.length) {
    store.auditLog = [];
    for (const entry of [...store.journal].reverse()) {
      Store.appendAudit(store, {id: id('audit'), at: `${entry.date}T12:00:00.000Z`, actor: 'Systemimport', action: 'VERIFIKATION_IMPORTERAD', details: `${entry.number}: ${entry.description}`});
    }
    auditBackfilled = true;
  }
  const auditChained = Store.ensureAuditChain(store);
  let recovered = false;
  if (loaded.recovered) {
    recovered = true;
    const corruptFile = `${dataFile}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    if (fs.existsSync(dataFile)) fs.renameSync(dataFile, corruptFile);
    Store.appendAudit(store, {id: id('audit'), at: new Date().toISOString(), actor: 'System', action: 'DATALAGER_ÅTERSTÄLLT', details: `Primärfilen kunde inte läsas. Återställd från ${path.basename(loaded.source)}.`});
  }
  const report = Store.validateStore(store);
  if (!report.ok && !allowInvalid) {
    const error = new Store.IntegrityError(`Datalagret är spärrat: ${report.errors[0]}`, report);
    error.statusCode = 503;
    throw error;
  }
  if ((migrate || auditBackfilled || expanded || batches || auditChained || recovered) && report.ok) writeStore(store);
  return store;
}
function writeStore(data) { return Store.atomicWriteJson(dataFile, data); }
const baseSecurityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};
function responseHeaders(extra = {}) {
  return {...baseSecurityHeaders, ...(secureCookie ? {'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'} : {}), ...extra};
}
function send(res, status, body, type = 'application/json; charset=utf-8', extraHeaders = {}) {
  if (res.writableEnded) return;
  const content = type.includes('json') ? JSON.stringify(body) : body;
  res.writeHead(status, responseHeaders({'Content-Type': type, ...extraHeaders}));
  if (res.req?.method === 'HEAD') return res.end();
  res.end(content);
}
function appendActivity(store, text, kind = 'notice') {
  const time = new Intl.DateTimeFormat('sv-SE', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  store.activity.unshift({ time, text, kind });
  store.activity = store.activity.slice(0, 12);
}
function isPeriodLocked(store, dateValue) {
  const period = String(dateValue || today()).slice(0, 7);
  return (store.settings?.lockedPeriods || []).includes(period);
}
function assertOpenPeriod(store, dateValue) {
  if (isPeriodLocked(store, dateValue)) throw new Error(`Bokföringsperioden ${String(dateValue).slice(0, 7)} är låst. Skapa en motverifikation i en öppen period.`);
}
function appendAudit(store, action, details, actor = 'Administratör') {
  return Store.appendAudit(store, {id: id('audit'), at: new Date().toISOString(), actor, action, details});
}
function nextInvoiceNumber(store) {
  const used = new Set();
  const max = store.invoices.reduce((current, invoice) => {
    const digits = String(invoice.number || '').replace(/\D/g, '');
    const value = digits.length === 6 ? Number(digits) : 0;
    if (value >= 100000 && value <= 999999) used.add(String(value));
    return Math.max(current, Number.isFinite(value) ? value : 0);
  }, 100000);
  for (let value = Math.max(100000, max + 1); value <= 999999; value += 1) {
    const candidate = String(value).padStart(6, '0');
    if (!used.has(candidate)) return candidate;
  }
  for (let value = 100000; value <= max && value <= 999999; value += 1) {
    const candidate = String(value).padStart(6, '0');
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Alla sexsiffriga fakturanummer är upptagna. Lägg till en ny nummerserie.');
}
function nextBatchNumber(store) {
  const used = new Set((store.journal || []).map(entry => String(entry.batchNumber || entry.batch || '').match(/^\d{4}$/)?.[0]).filter(Boolean));
  let highest = Math.max(999, ...[...used].map(Number));
  for (let i = 0; i < 10000; i += 1) {
    highest = highest >= 9999 ? 1000 : highest + 1;
    const candidate = String(highest).padStart(4, '0');
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Alla fyrsiffriga buntnummer är upptagna. Lägg till en ny nummerserie.');
}
function addJournal(store, { date, description, rows, source = 'Manuell bokning' }) {
  assertOpenPeriod(store, date || today());
  if (rows.some(r => !Number.isFinite(r.debit) || !Number.isFinite(r.credit) || r.debit < 0 || r.credit < 0) ||
      rows.reduce((n,r) => n + Finance.cents(r.debit) - Finance.cents(r.credit), 0) !== 0) throw new Error('Verifikationen måste balansera.');
  const next = store.journal.reduce((highest, entry) => Math.max(highest, Number((entry.number || 'A0').slice(1)) || 0), 0) + 1;
  const entry = { id: id('ver'), date: date || today(), postingDate: date || today(), series: 'A', number: `A${next}`, batchNumber: nextBatchNumber(store), description, rows, source };
  store.journal.unshift(entry);
  appendAudit(store, 'VERIFIKATION_SKAPAD', `${entry.number}: ${description}`);
  return entry;
}
function registerPayment(store, kind, invoice, payload, transaction = null) {
  if (transaction && ((transaction.amount > 0) !== (kind === 'customer') || Finance.cents(Math.abs(transaction.amount)) !== Finance.cents(payload.amount))) throw new Error('Bankbelopp och betalningsriktning måste stämma med fakturan.');
  const key = String(payload.idempotencyKey || '');
  if (key && (invoice.payments || []).some(p => p.idempotencyKey === key)) return invoice.payments.find(p => p.idempotencyKey === key);
  Finance.validatePayment(invoice, kind, payload);
  const reference = String(payload.reference).trim();
  if ([...store.invoices, ...store.supplierInvoices].some(i => (i.payments || []).some(p => p.reference === reference))) throw new Error('Bankreferensen har redan registrerats. Granska betalningen i reskontran.');
  const amount = money(payload.amount);
  const account = kind === 'customer' ? '1510 Kundfordringar' : '2440 Leverantörsskulder';
  const incoming = kind === 'customer';
  const entry = addJournal(store, {
    date: payload.date, description: `${incoming ? 'Inbetalning' : 'Utbetalning'} ${Finance.invoiceNumber(invoice)} · ${reference}`,
    rows: incoming ? [{ account: '1930 Företagskonto', debit: amount, credit: 0 }, { account, debit: 0, credit: amount }] :
      [{ account, debit: amount, credit: 0 }, { account: '1930 Företagskonto', debit: 0, credit: amount }],
    source: transaction ? 'Bankavstämning' : 'Registrerad betalning'
  });
  const payment = { id: id('pay'), amount, date: payload.date, method: payload.method, reference, batch: entry.batchNumber, journalNumber: entry.number, bankId: transaction?.id || null, idempotencyKey: key, source: entry.source };
  invoice.payments ||= [];
  invoice.payments.push(payment);
  Finance.updateStatus(invoice, kind);
  if (transaction) {
    transaction.status = 'Matchad'; transaction.invoiceId = invoice.id; transaction.invoiceKind = kind;
    transaction.account = account; transaction.journalNumber = entry.number; transaction.batch = entry.batchNumber;
    transaction.proposal = `Bokförd betalning · ${Finance.invoiceNumber(invoice)}`;
  }
  return payment;
}
function reversePayment(store, kind, invoice, payload) {
  const entryType = payload.entryType === 'payout' ? 'payouts' : 'payments';
  const list = invoice[entryType] || [];
  const payment = list.find(item => item.id === payload.paymentId);
  if (!payment) throw new Error('Betalningen hittades inte på fakturan.');
  if (payment.reversed) throw new Error('Betalningen är redan återförd.');
  if (payment.reclassified || payment.reclassifiedFrom) throw new Error('Betalningen har omförts. Granska omföringsbunten innan återföring.');
  const date = String(payload.date || today()).slice(0, 10);
  if (!Finance.validDate(date) || date > today()) throw new Error('Motverifikationsdatumet måste vara giltigt och får inte ligga framåt i tiden.');
  assertOpenPeriod(store, date);
  const original = store.journal.find(entry => entry.number === payment.journalNumber);
  const amount = money(payment.amount);
  const account = kind === 'customer' ? '1510 Kundfordringar' : '2440 Leverantörsskulder';
  const rows = original ? original.rows.map(row => ({ account: row.account, debit: money(row.credit), credit: money(row.debit) })) :
    (entryType === 'payout' ? [{ account, debit: 0, credit: amount }, { account: '1930 Företagskonto', debit: amount, credit: 0 }] :
      (kind === 'customer' ? [{ account: '1930 Företagskonto', debit: 0, credit: amount }, { account, debit: amount, credit: 0 }] : [{ account, debit: 0, credit: amount }, { account: '1930 Företagskonto', debit: amount, credit: 0 }]));
  const entry = addJournal(store, { date, description: `Motverifikation ${payment.journalNumber || payment.reference || payment.id} – ${payload.reason || 'Felregistrerad betalning'}`, rows, source: 'Motverifikation betalning' });
  payment.reversed = true; payment.reversedDate = date; payment.reversalJournalNumber = entry.number; payment.reversalReason = String(payload.reason || '').trim() || 'Felregistrerad betalning';
  if (entryType === 'payout') invoice.payoutAmount = money(Math.max(0, (invoice.payoutAmount || 0) - amount));
  Finance.updateStatus(invoice, kind);
  if (kind === 'customer' && !invoice.credit) {
    const remaining = Finance.remaining(invoice);
    const activePaid = (invoice.payments || []).filter(item => !item.reversed).reduce((sum, item) => sum + money(item.amount), 0);
    invoice.status = remaining === 0 ? 'Betald' : remaining < 0 ? 'Överbetald' : activePaid > 0 ? 'Delbetald' : 'Bokförd';
  }
  return { payment, entry };
}
function registerPayout(store, kind, invoice, payload) {
  Finance.validatePayout(invoice, kind, payload);
  const reference = String(payload.reference || '').trim();
  const allRefs = [...store.invoices, ...store.supplierInvoices].flatMap(i => [ ...(i.payments || []), ...(i.payouts || []) ]).map(p => p.reference).filter(Boolean);
  if (allRefs.includes(reference)) throw new Error('Betalningsreferensen har redan registrerats.');
  const amount = money(payload.amount);
  const account = kind === 'customer' ? '1510 Kundfordringar' : '2440 Leverantörsskulder';
  const entry = addJournal(store, {
    date: payload.date,
    description: `${kind === 'customer' ? 'Återbetalning' : 'Utbetalning'} ${Finance.invoiceNumber(invoice)} · ${reference}`,
    rows: [{ account, debit: amount, credit: 0 }, { account: '1930 Företagskonto', debit: 0, credit: amount }],
    source: kind === 'customer' ? 'Återbetalning till kund' : 'Registrerad utbetalning'
  });
  const payout = { id: id('payout'), amount, date: payload.date, method: payload.method, reference, batch: entry.batchNumber, reason: String(payload.reason || '').trim(), journalNumber: entry.number, source: entry.source };
  invoice.payouts ||= [];
  invoice.payouts.push(payout);
  invoice.payoutAmount = money((invoice.payoutAmount || 0) + amount);
  Finance.updateStatus(invoice, kind);
  if (Finance.remaining(invoice) === 0) invoice.status = kind === 'customer' ? (invoice.payoutAmount > 0 ? 'Återbetald' : 'Betald') : 'Betald';
  return payout;
}
function applyOffset(store, credit, invoice, amountValue) {
  const amount = money(amountValue);
  if (Finance.remaining(credit)>=0) throw new Error('Källposten måste ha ett disponibelt kreditbelopp.');
  if (invoice.credit || invoice.total <= 0) throw new Error('Målposten måste vara en öppen vanlig kundfaktura.');
  if (credit.id===invoice.id || credit.customerNumber!==invoice.customerNumber || credit.customer!==invoice.customer) throw new Error('Kreditbeloppet och fakturan måste tillhöra samma kund.');
  if (!Number.isFinite(amount) || amount <= 0 || Finance.cents(amount) > Finance.cents(Math.abs(Finance.remaining(credit))) || Finance.cents(amount) > Finance.cents(Finance.remaining(invoice))) throw new Error('Kvittningsbeloppet överstiger något av restbeloppen.');
  const entry = addJournal(store, { date: today(), description: `Kvittning ${credit.number} mot ${invoice.number}`, rows: [{ account: '1510 Kundfordringar', debit: amount, credit: 0 }, { account: '1510 Kundfordringar', debit: 0, credit: amount }], source: 'Kvittning kreditfaktura' });
  const record = { id: id('offset'), amount, date: entry.date, journalNumber: entry.number, creditInvoiceId: credit.id, invoiceId: invoice.id, batch: entry.batchNumber };
  credit.offsets ||= []; invoice.offsets ||= [];
  credit.offsets.push(record); invoice.offsets.push(record);
  if(credit.credit) credit.offsetAmount = money((credit.offsetAmount || 0) + amount);
  else credit.creditUsed=money((credit.creditUsed || 0)+amount);
  invoice.offsetAmount = money((invoice.offsetAmount || 0) + amount);
  if (Finance.remaining(credit) === 0) credit.status = 'Kvittad';
  if (Finance.remaining(invoice) === 0) { invoice.status = 'Kvittad'; invoice.paid = true; }
  return record;
}
function reclassifyPayment(store, payload) {
  return require('./public/receivables-tools.js').execute(store, 'reclassify', payload, entry => addJournal(store, entry), () => id('res'));
}
function writeOff(store, kind, invoice, reason, account) {
  const remaining = Math.abs(Finance.remaining(invoice));
  if (Finance.remaining(invoice)<=0 || invoice.status === 'Attest väntar') throw new Error('Posten kan inte bokas ut i nuvarande läge.');
  const target = canonicalAccount(account || (kind === 'customer' ? '6351' : '6990'), /^[3-8]\d{3}(?=\s|$)/);
  if (!target) throw new Error('Välj ett giltigt resultatkonto ur kontoplanen för utbokningen.');
  const rows = kind === 'customer' ? [{ account: target, debit: remaining, credit: 0 }, { account: '1510 Kundfordringar', debit: 0, credit: remaining }] : [{ account: '2440 Leverantörsskulder', debit: remaining, credit: 0 }, { account: target, debit: 0, credit: remaining }];
  const entry = addJournal(store, { date: today(), description: `Utbokning ${Finance.invoiceNumber(invoice)} – ${reason || 'Korrigering'}`, rows, source: 'Manuell utbokning' });
  invoice.writeOffAmount = money((invoice.writeOffAmount || 0) + remaining); invoice.writeOffDate = entry.date; invoice.writeOffJournalNumber = entry.number; invoice.writeOffReason = reason || 'Korrigering'; invoice.status = 'Avskriven'; invoice.paid = true;
  return entry;
}
function safeCandidate(store, transaction) {
  const kind = transaction.amount > 0 ? 'customer' : 'supplier';
  const invoices = kind === 'customer' ? store.invoices : store.supplierInvoices;
  const reference = `${transaction.reference || ''} ${transaction.text || ''}`;
  const candidates = invoices.filter(i => {
    const references = [Finance.invoiceNumber(i), i.ocr].filter(Boolean).map(value=>String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return (kind === 'customer' || i.status !== 'Attest väntar') &&
      Finance.remaining(i) > 0 && Finance.cents(Finance.remaining(i)) === Finance.cents(Math.abs(transaction.amount)) &&
      references.some(number=>new RegExp('(^|[^\\p{L}\\p{N}])' + number + '($|[^\\p{L}\\p{N}])', 'u').test(reference));
  });
  return candidates.length === 1 ? { kind, invoice: candidates[0] } : null;
}
function parseCamt(xml, store) {
  const entries = xml.match(/<Ntry(?:\s[^>]*)?>[\s\S]*?<\/Ntry>/gi) || [];
  const existingRefs = new Set(store.bankTransactions.map(item => item.transactionRef));
  const imported = [];
  for (const entry of entries) {
    const amountMatch = entry.match(/<Amt(?:\s+[^>]*)?\sCcy=["']([^"']+)["'][^>]*>([\s\S]*?)<\/Amt>/i) || entry.match(/<Amt[^>]*>([\s\S]*?)<\/Amt>/i);
    const rawAmount = amountMatch ? Number(String(amountMatch[2] || amountMatch[1]).replace(',', '.')) : 0;
    if (!Number.isFinite(rawAmount) || rawAmount === 0) continue;
    const creditDebit = xmlText(entry, 'CdtDbtInd').toUpperCase();
    const amount = creditDebit === 'DBIT' ? -Math.abs(rawAmount) : Math.abs(rawAmount);
    const reference = xmlText(entry, 'EndToEndId') || xmlText(entry, 'UETR') || xmlText(entry, 'NtryRef') || xmlText(entry, 'AcctSvcrRef');
    const transactionRef = xmlText(entry, 'AcctSvcrRef') || xmlText(entry, 'NtryRef') || `CAMT-${crypto.createHash('sha1').update(entry).digest('hex').slice(0, 12)}`;
    if (existingRefs.has(transactionRef)) continue;
    const text = [xmlText(entry, 'Ustrd'), xmlText(entry, 'Ref'), xmlText(entry, 'AddtlNtryInf'), xmlText(entry, 'Nm')].filter(Boolean).join(' ').trim() || 'Banktransaktion från CAMT.054';
    const date = isoToSwedish(xmlText(entry, 'BookgDt') || xmlText(entry, 'ValDt') || today());
    const invoice = store.invoices.find(inv => !inv.paid && (reference.includes(inv.number) || text.includes(inv.number) || Math.abs(inv.total - Math.abs(amount)) < 0.01));
    const supplier = store.supplierInvoices.find(inv => inv.status !== 'Betald' && (reference.includes(inv.invoiceNumber) || text.includes(inv.invoiceNumber) || Math.abs(inv.total - Math.abs(amount)) < 0.01));
    let transaction;
    if (amount > 0 && invoice) {
      transaction = { id: id('bank'), date, text, amount, direction: 'in', reference, status: 'Matchad', confidence: 0.97, proposal: `Matcha kundfaktura ${invoice.number}`, account: '1510 Kundfordringar', transactionRef };
    } else if (amount < 0 && supplier) {
      transaction = { id: id('bank'), date, text, amount, direction: 'out', reference, status: 'Matchad', confidence: 0.96, proposal: `Matcha leverantörsfaktura ${supplier.invoiceNumber}`, account: '2440 Leverantörsskulder', transactionRef };
    } else {
      const commonExpense = /(BAGERI|GROSSIST|FRUKT|LIVS|MAT)/i.test(text);
      transaction = { id: id('bank'), date, text, amount, direction: amount > 0 ? 'in' : 'out', reference, status: 'Granska', confidence: commonExpense ? 0.68 : 0.35, proposal: commonExpense ? 'Förslag: 4010 Inköp av varor' : 'Ingen säker bokning', account: commonExpense ? '4010 Inköp av varor' : '', transactionRef, reason: 'Ingen tillräckligt säker matchning mot faktura eller tidigare bokning.' };
    }
    transaction.currency = amountMatch?.[2] ? amountMatch[1] : 'SEK';
    imported.push(transaction);
    existingRefs.add(transactionRef);
  }
  store.bankTransactions.unshift(...imported);
  return imported;
}
function parseBam(text, store) {
  // The lightweight BAM import accepts the common export shape: datum;beskrivning;belopp.
  // Production deployments should map the exact bank-specific BAM layout before enabling it.
  const imported = [];
  const existingRefs = new Set(store.bankTransactions.map(item => item.transactionRef));
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  lines.forEach((line, index) => {
    const cells = line.split(/[;\t]/).map(cell => cell.trim());
    if (cells.length < 3 || !/\d/.test(cells[0])) return;
    const parsedAmount = Number(cells.at(-1).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) return;
    const date = isoToSwedish(cells[0]);
    const textValue = cells.slice(1, -1).join(' ') || 'Banktransaktion från BAM';
    const transactionRef = `BAM-${date.replace(/-/g, '')}-${crypto.createHash('sha256').update(line).digest('hex').slice(0, 20)}`;
    if (existingRefs.has(transactionRef)) return;
    const invoice = store.invoices.find(inv => !inv.paid && (textValue.includes(inv.number) || Math.abs(inv.total - Math.abs(parsedAmount)) < 0.01));
    const supplier = store.supplierInvoices.find(inv => inv.status !== 'Betald' && (textValue.includes(inv.invoiceNumber) || Math.abs(inv.total - Math.abs(parsedAmount)) < 0.01));
    const matched = invoice || supplier;
    imported.push({
      id: id('bank'), date, text: textValue, amount: parsedAmount, direction: parsedAmount > 0 ? 'in' : 'out', reference: invoice?.number || supplier?.invoiceNumber || '', transactionRef,
      status: matched ? 'Matchad' : 'Granska', confidence: matched ? .96 : .42,
      proposal: invoice ? `Matcha kundfaktura ${invoice.number}` : supplier ? `Matcha leverantörsfaktura ${supplier.invoiceNumber}` : 'Ingen säker bokning',
      account: invoice ? '1510 Kundfordringar' : supplier ? '2440 Leverantörsskulder' : '',
      ...(matched ? {} : { reason: 'BAM-raden saknar en säker fakturamatchning eller tidigare bokningsregel.' })
    });
    existingRefs.add(transactionRef);
  });
  store.bankTransactions.unshift(...imported);
  return imported;
}
function autoBookMatches(store, transactions) {
  const booked = [];
  transactions.forEach(tx => {
    const candidate = safeCandidate(store, tx);
    tx.status = 'Granska'; tx.confidence = 0;
    tx.proposal = 'Manuell fakturamatchning behövs';
    tx.reason = 'Referens och restbelopp ger ingen entydig matchning.';
    if (tx.currency && tx.currency !== 'SEK') { tx.reason = 'Annan valuta än SEK kräver manuell valutahantering.'; return; }
    if (!candidate) return;
    try {
      registerPayment(store, candidate.kind, candidate.invoice, { amount: Math.abs(tx.amount), date: tx.date, method: 'Bank', reference: tx.transactionRef }, tx);
      tx.autoBooked = true; tx.confidence = 1; tx.reason = '';
      booked.push(tx);
    } catch (error) { tx.reason = error.message; }
  });
  return booked;
}
function matches(value, query) { return String(value || '').toLowerCase().includes(String(query || '').toLowerCase()); }
function normalizeHostname(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!raw) return '';
  if (raw === '::' || raw === '::1') return raw;
  try { return new URL(`http://${raw}`).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, ''); }
  catch { return raw.replace(/^\[|\]$/g, '').split(':')[0]; }
}
function isLoopbackHost(value) {
  return ['127.0.0.1', 'localhost', '::1'].includes(normalizeHostname(value));
}
function requestHostAllowed(req) {
  const requested = normalizeHostname(req.headers.host);
  if (!requested) return false;
  if (isLoopbackHost(requested)) return true;
  const allowed = new Set(configuredAllowedHosts.map(normalizeHostname).filter(Boolean));
  const bound = normalizeHostname(host);
  if (!['0.0.0.0', '::'].includes(bound)) allowed.add(bound);
  return allowed.has(requested);
}
function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';').map(value => value.trim()).filter(Boolean)) {
    const index = part.indexOf('=');
    const key = index < 0 ? part : part.slice(0, index);
    try { cookies[key] = index < 0 ? '' : decodeURIComponent(part.slice(index + 1)); }
    catch { cookies[key] = ''; }
  }
  return cookies;
}
function cleanSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions) if (session.expiresAt <= now) sessions.delete(sessionId);
  for (const [address, attempt] of loginAttempts) if (attempt.resetAt <= now) loginAttempts.delete(address);
}
function bearerToken(req) {
  const authorization = String(req.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : String(req.headers['x-rollands-token'] || '').trim();
}
function isAuthenticated(req) {
  if (!adminToken) return true;
  cleanSessions();
  if (safeEqual(bearerToken(req), adminToken)) return true;
  const sessionId = parseCookies(req).rollands_session;
  const session = sessionId && sessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) return false;
  session.expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  return true;
}
function recordLoginFailure(req) {
  const address = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = loginAttempts.get(address);
  const attempt = !current || current.resetAt <= now ? {count: 0, resetAt: now + 15 * 60 * 1000} : current;
  attempt.count += 1;
  loginAttempts.set(address, attempt);
  return attempt;
}
function loginBlocked(req) {
  cleanSessions();
  const attempt = loginAttempts.get(req.socket.remoteAddress || 'unknown');
  return attempt && attempt.count >= 5 && attempt.resetAt > Date.now();
}
function sessionCookie(value, maxAge = 8 * 60 * 60) {
  return `rollands_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
}
function handleSession(req, res, payload) {
  if (req.method === 'GET') return send(res, 200, {required: Boolean(adminToken), authenticated: isAuthenticated(req)});
  if (req.method !== 'POST') return send(res, 405, {error: 'Metoden stöds inte.'}, 'application/json; charset=utf-8', {Allow: 'GET, POST'});
  if (!adminToken) return send(res, 200, {required: false, authenticated: true});
  if (loginBlocked(req)) return send(res, 429, {error: 'För många felaktiga försök. Vänta 15 minuter och försök igen.'}, 'application/json; charset=utf-8', {'Retry-After': '900'});
  if (!safeEqual(payload.token, adminToken)) {
    recordLoginFailure(req);
    return send(res, 401, {error: 'Administratörsnyckeln är felaktig.'}, 'application/json; charset=utf-8', {'WWW-Authenticate': 'Bearer realm="Rollands Ekonomi"'});
  }
  loginAttempts.delete(req.socket.remoteAddress || 'unknown');
  const sessionId = crypto.randomBytes(32).toString('base64url');
  sessions.set(sessionId, {createdAt: Date.now(), expiresAt: Date.now() + 8 * 60 * 60 * 1000});
  return send(res, 200, {required: true, authenticated: true}, 'application/json; charset=utf-8', {'Set-Cookie': sessionCookie(sessionId)});
}
function requireAuthentication(req, res) {
  if (isAuthenticated(req)) return true;
  send(res, 401, {error: 'Autentisering krävs.'}, 'application/json; charset=utf-8', {'WWW-Authenticate': 'Bearer realm="Rollands Ekonomi"'});
  return false;
}
function canonicalAccount(value, pattern) {
  const code = String(value || '').trim().match(pattern)?.[0];
  const selected = code && AccountPlan.byCode[code];
  return selected ? `${selected.code} ${selected.name}` : '';
}
function safeFilename(value, fallback) {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return cleaned || fallback;
}
function sendError(res, error) {
  if (res.writableEnded) return;
  if (error?.code === 'STORE_INTEGRITY_ERROR') return send(res, error.statusCode || 409, {error: error.message, integrity: error.report});
  if (error?.code === 'STORE_READ_ERROR') return send(res, 503, {error: 'Datalagret kan inte läsas. Kontrollera säkerhetskopian innan fler ändringar görs.'});
  const status = error?.statusCode || 400;
  return send(res, status, {error: status >= 500 ? 'Ett internt fel uppstod.' : String(error?.message || 'Begäran kunde inte behandlas.')});
}
async function handleApi(req, res, url, payload) {
  if (url.pathname === '/api/session') return handleSession(req, res, payload);
  if (url.pathname === '/api/health' && !isAuthenticated(req)) return send(res, 200, {ok: true, authenticated: false, authenticationRequired: Boolean(adminToken), demoMode: demoDataEnabled});
  if (!requireAuthentication(req, res)) return;
  const healthRequest = req.method === 'GET' && url.pathname === '/api/health';
  let store = readStore({allowInvalid: healthRequest});
  if (healthRequest) {
    const integrity = Store.validateStore(store);
    return send(res, integrity.ok ? 200 : 503, {ok: integrity.ok, authenticated: true, authenticationRequired: Boolean(adminToken), demoMode: demoDataEnabled, integrity});
  }
  if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, store);
  if (req.method === 'GET' && url.pathname === '/api/export/reskontra') {
    const kind = url.searchParams.get('kind');
    if (!['customer', 'supplier'].includes(kind)) return send(res, 422, { error: 'Välj reskontratyp.' });
    const filters = Object.fromEntries(url.searchParams.entries());
    return send(res, 200, Finance.csv(Finance.items(store, kind, filters)), 'text/csv; charset=utf-8', {'Content-Disposition': `attachment; filename="rollands-${kind === 'customer' ? 'kund' : 'leverantors'}reskontra.csv"`});
  }
  if (req.method === 'GET' && url.pathname === '/api/export/excel') {
    const header = ['Datum', 'Verifikation', 'Beskrivning', 'Konto', 'Debet', 'Kredit', 'Källa'].map(Finance.csvCell).join(';');
    const rows = store.journal.flatMap(entry => entry.rows.map(row => [entry.date, entry.number, entry.description, row.account, row.debit || '', row.credit || '', entry.source].map(Finance.csvCell).join(';')));
    return send(res, 200, '\uFEFF' + [header, ...rows].join('\r\n'), 'text/csv; charset=utf-8', {'Content-Disposition': 'attachment; filename="rollands-bokforing.csv"'});
  }
  const pdfMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/pdf$/);
  if (req.method === 'GET' && pdfMatch) {
    const invoice = store.invoices.find(item => item.id === pdfMatch[1]);
    if (!invoice) return send(res, 404, 'Fakturan hittades inte.', 'text/plain; charset=utf-8');
    const pdf = invoice.pdfBase64 && invoice.pdfLayoutVersion===2 ? Buffer.from(invoice.pdfBase64,'base64') : await invoicePdf(invoice, invoice.seller || store.business);
    const filename = safeFilename(invoice.number, 'faktura');
    return send(res, 200, pdf, 'application/pdf', {'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="rollands-${filename}.pdf"`});
  }
  if (req.method !== 'POST') return send(res, 404, { error: 'Hittades inte' });

  if (url.pathname === '/api/payments') {
    const kind = payload.kind;
    if (!['customer', 'supplier'].includes(kind)) return send(res, 422, { error: 'Välj kund eller leverantör.' });
    const invoice = (kind === 'customer' ? store.invoices : store.supplierInvoices).find(i => i.id === payload.invoiceId);
    if (!invoice) return send(res, 404, { error: 'Fakturan hittades inte.' });
    const existing = invoice.payments.find(p => p.idempotencyKey && p.idempotencyKey === payload.idempotencyKey);
    if (existing) return send(res, 200, { payment: existing, store });
    if (store.bankTransactions.some(t => t.transactionRef === payload.reference)) return send(res, 409, { error: 'Bankraden finns redan. Matcha den via Bank & avstämning för att undvika dubbelbokning.' });
    const payment = registerPayment(store, kind, invoice, payload);
    appendActivity(store, `Betalning ${money(payload.amount)} kr registrerad mot ${Finance.invoiceNumber(invoice)}. Rest ${Finance.remaining(invoice)} kr.`, 'success');
    writeStore(store);
    return send(res, 201, { payment, store });
  }
  if (url.pathname === '/api/payments/reverse') {
    const kind = payload.kind;
    if (!['customer', 'supplier'].includes(kind)) return send(res, 422, { error: 'Välj kund eller leverantör.' });
    const invoice = (kind === 'customer' ? store.invoices : store.supplierInvoices).find(i => i.id === payload.invoiceId);
    if (!invoice) return send(res, 404, { error: 'Fakturan hittades inte.' });
    if (!String(payload.reason || '').trim()) return send(res, 422, { error: 'Ange en orsak till motverifikationen.' });
    const reversal = reversePayment(store, kind, invoice, payload);
    appendActivity(store, `Betalning på ${Finance.invoiceNumber(invoice)} återfördes med ${reversal.entry.number}.`, 'warning');
    writeStore(store);
    return send(res, 201, { reversal, store });
  }
  if (url.pathname === '/api/payouts') {
    const kind = payload.kind;
    if (!['customer', 'supplier'].includes(kind)) return send(res, 422, { error: 'Välj kund eller leverantör.' });
    const invoice = (kind === 'customer' ? store.invoices : store.supplierInvoices).find(i => i.id === payload.invoiceId);
    if (!invoice) return send(res, 404, { error: 'Fakturan hittades inte.' });
    const payout = registerPayout(store, kind, invoice, payload);
    appendActivity(store, `${kind === 'customer' ? 'Återbetalning' : 'Utbetalning'} ${money(payload.amount)} kr registrerad mot ${Finance.invoiceNumber(invoice)}.`, 'success');
    writeStore(store);
    return send(res, 201, { payout, store });
  }
  if (url.pathname === '/api/invoices/offset') {
    const credit = store.invoices.find(i => i.id === payload.creditInvoiceId);
    const invoice = store.invoices.find(i => i.id === payload.invoiceId);
    if (!credit || !invoice) return send(res, 404, { error: 'Fakturan hittades inte.' });
    const offset = applyOffset(store, credit, invoice, payload.amount);
    appendActivity(store, `Kreditfaktura ${credit.number} kvittades mot ${invoice.number}.`, 'success'); writeStore(store);
    return send(res, 200, { offset, store });
  }
  if (url.pathname === '/api/receivables/reclassify') {
    const result = reclassifyPayment(store, payload);
    if (!result.duplicate) appendActivity(store, `${result.entry.description} · bunt ${result.entry.batchNumber}.`, 'success');
    writeStore(store);
    return send(res, 200, { reclassification: result, store });
  }
  if (url.pathname === '/api/receivables/offset') {
    const result = require('./public/receivables-tools.js').execute(store, 'offset', payload, entry => addJournal(store, entry), () => id('offset'));
    if (!result.duplicate) appendActivity(store, `${result.entry.description} · bunt ${result.entry.batchNumber}.`, 'success');
    writeStore(store);
    return send(res, 200, { reclassification: result, store });
  }
  if (url.pathname === '/api/invoices/writeoff') {
    const kind = payload.kind === 'supplier' ? 'supplier' : 'customer';
    const list = kind === 'customer' ? store.invoices : store.supplierInvoices;
    const invoice = list.find(i => i.id === payload.invoiceId);
    if (!invoice) return send(res, 404, { error: 'Posten hittades inte.' });
    const entry = writeOff(store, kind, invoice, payload.reason, payload.account);
    appendActivity(store, `${Finance.invoiceNumber(invoice)} bokades ut med verifikation ${entry.number}.`, 'warning'); writeStore(store);
    return send(res, 200, { entry, store });
  }

  if (url.pathname === '/api/invoice-settings') {
    const fields = ['invoiceContact','registeredOffice','paymentAccount','vatNumber'];
    for (const key of fields) {
      const value = String(payload[key] || '').trim();
      if (!value || value.length > 120) return send(res,422,{error:'Fyll i kontakt, säte, momsregistreringsnummer och betalningskonto (högst 120 tecken).'});
      store.business[key]=value;
    }
    writeStore(store); return send(res,200,{store});
  }
  if (url.pathname === '/api/settings') {
    const fields = ['attestResponsible', 'attestSubstitute', 'emailInbox'];
    for (const key of fields) {
      const value = String(payload[key] || '').trim();
      if (!value || value.length > 160) return send(res, 422, { error: 'Fyll i attestansvarig, ersättare och fakturamejl.' });
      store.settings[key] = value;
    }
    appendAudit(store, 'INSTÄLLNINGAR_UPPDATERADE', `Attestansvarig: ${store.settings.attestResponsible}; ersättare: ${store.settings.attestSubstitute}`);
    writeStore(store); return send(res, 200, { store });
  }
  if (url.pathname === '/api/period-locks') {
    const period = String(payload.period || '').trim();
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) return send(res, 422, { error: 'Ange en giltig period i formatet ÅÅÅÅ-MM.' });
    store.settings.lockedPeriods ||= [];
    if (payload.action === 'unlock') store.settings.lockedPeriods = store.settings.lockedPeriods.filter(item => item !== period);
    else if (payload.action === 'lock') store.settings.lockedPeriods = [...new Set([...store.settings.lockedPeriods, period])].sort();
    else return send(res, 422, { error: 'Välj lås eller lås upp.' });
    appendAudit(store, payload.action === 'lock' ? 'PERIOD_LÅST' : 'PERIOD_UPPLÅST', period);
    appendActivity(store, `${payload.action === 'lock' ? 'Period låst' : 'Period upplåst'}: ${period}.`, payload.action === 'lock' ? 'warning' : 'notice');
    writeStore(store); return send(res, 200, { store });
  }
  if (url.pathname === '/api/invoices') {
    const requestKey = String(payload.idempotencyKey || '');
    if(requestKey) {
      const previous=store.invoices.find(i=>i.idempotencyKey===requestKey);
      if(previous) return send(res,200,{invoice:previous,store});
    }
    const modern = Array.isArray(payload.lines);
    const credit = payload.invoiceType === 'credit';
    const input = modern ? payload.lines : [{description:payload.reference || 'Varor och tjänster',amount:payload.net,account:'3010',vatRate:payload.vatRate ?? 25}];
    const calc=InvoiceModel.calculate(input,credit);
    const customer=String(payload.customer || '').trim();
    const address=String(payload.address || '').trim();
    const ourContact=String(payload.ourContact || store.business.invoiceContact || '').trim();
    const reference=String(payload.reference || '').trim();
    const paymentTerms=Number(payload.paymentTerms ?? 30);
    const postingDate=String(payload.postingDate || payload.date || today()).slice(0,10);
    if(!customer || customer.length>160 || address.length>500 || reference.length>200 || ourContact.length>120)
      return send(res,422,{error:'Kontrollera kundnamn, adress, referens och kontakt.'});
    if(!Number.isInteger(paymentTerms) || paymentTerms<0 || paymentTerms>365) return send(res,422,{error:'Betalningsvillkor ska vara 0–365 dagar.'});
    if(modern && (!address || !ourContact || !store.business.paymentAccount || !store.business.registeredOffice || !store.business.vatNumber))
      return send(res,422,{error:'Fyll i kundadress och vår kontakt samt spara fakturainställningarna före fakturering.'});
    const date=payload.date || Finance.localToday(), dueDate=payload.dueDate || InvoiceModel.dueDate(date,paymentTerms);
    if(!Finance.validDate(date) || !Finance.validDate(dueDate) || dueDate<date || !Finance.validDate(postingDate) || postingDate>today()) return send(res,422,{error:'Kontrollera faktura-, bokförings- och förfallodatum.'});
    let customerNumber=String(payload.customerNumber || '').trim();
    if(customerNumber.length>40) return send(res,422,{error:'Kundnummer får vara högst 40 tecken.'});
    const same=store.invoices.find(i=>i.customer.toLocaleLowerCase('sv')===customer.toLocaleLowerCase('sv'));
    if(!customerNumber) customerNumber=same?.customerNumber || 'K-'+(Math.max(1000,...store.invoices.map(i=>Number((i.customerNumber || '').replace(/^K-/,'')) || 0))+1);
    if(store.invoices.some(i=>i.customerNumber===customerNumber && i.customer.toLocaleLowerCase('sv')!==customer.toLocaleLowerCase('sv')))
      return send(res,422,{error:'Kundnumret används redan av ett annat bolag.'});
    const invoice = {
      id:id('inv'), number:nextInvoiceNumber(store), customerNumber,customer,address,reference,ourContact,paymentTerms,date,postingDate,dueDate,
      ...calc, credit, pdfReady:true, status:credit?'Kredit':'Bokförd',channel:'Ej skickad',paid:false,payments:[], idempotencyKey:requestKey,
      seller:{...store.business}, interestText:InvoiceModel.interestText
    };
    invoice.ocr=InvoiceModel.ocr(invoice.number);
    // Render before committing: invalid content cannot create a booked invoice without a PDF.
    const pdf=await invoicePdf(invoice,invoice.seller);
    invoice.pdfBase64=pdf.toString('base64'); invoice.pdfLayoutVersion=2;
    const entry=addJournal(store,{date:postingDate,description:`${credit?'Kreditfaktura':'Kundfaktura'} ${invoice.number} – ${customer}`,rows:calc.rows,source:credit?'Kreditfaktura':'Kundfaktura'});
    invoice.journalNumber=entry.number; invoice.bookedDate=entry.date; invoice.postingDate=entry.postingDate; invoice.batchNumber=entry.batchNumber;
    store.invoices.unshift(invoice);
    appendActivity(store,`Faktura ${invoice.number} skapades med PDF och verifikation ${entry.number}.`,'success');
    writeStore(store);
    return send(res,201,{invoice,store});
  }
  if (url.pathname === '/api/supplier-invoices') {
    const supplier = String(payload.supplier || '').trim();
    const invoiceNumber = String(payload.invoiceNumber || '').trim();
    const source = String(payload.source || 'Manuell registrering').trim();
    const net = money(payload.net || 0);
    const vatPercent = Number(payload.vatRate ?? 25);
    const suggestedAccount = canonicalAccount(payload.account || '4010', /^(?:[4-7]\d{3}|84\d{2})(?=\s|$)/);
    if (!supplier || supplier.length > 200 || !invoiceNumber || invoiceNumber.length > 100 || !Number.isSafeInteger(net) || net <= 0 || net > 100_000_000 || ![0,6,12,25].includes(vatPercent) || !suggestedAccount) return send(res, 422, { error: 'Ange leverantör, fakturanummer, heltalsbelopp, giltig moms och kostnadskonto.' });
    const vat = money(net * vatPercent / 100);
    const invoice = {id: id('sup'), supplier, invoiceNumber, received: String(payload.received || today()).slice(0, 10), dueDate: String(payload.dueDate || today()).slice(0, 10), net, vat, total: net + vat, suggestedAccount, status: 'Attest väntar', source: source.slice(0, 240), confidence: Math.max(0, Math.min(1, Number(payload.confidence ?? 0) || 0)), payments: []};
    if (!Finance.validDate(invoice.received) || !Finance.validDate(invoice.dueDate) || invoice.dueDate < invoice.received || invoice.received > today()) return send(res, 422, { error: 'Kontrollera faktura- och förfallodatum.' });
    if (store.supplierInvoices.some(i => i.supplier.toLocaleLowerCase('sv') === invoice.supplier.toLocaleLowerCase('sv') && String(i.invoiceNumber).toLocaleLowerCase('sv') === invoice.invoiceNumber.toLocaleLowerCase('sv'))) return send(res, 409, { error: 'Leverantörens fakturanummer finns redan.' });
    store.supplierInvoices.unshift(invoice);
    if (/e-post|email/i.test(invoice.source)) store.settings.lastInvoiceEmail = invoice.received;
    appendActivity(store, `Leverantörsfaktura ${invoice.invoiceNumber} lades i attestflödet.`, 'notice');
    appendAudit(store, 'LEVERANTÖRSFAKTURA_REGISTRERAD', `${invoice.invoiceNumber}: ${invoice.supplier}, ${invoice.total} kr.`);
    writeStore(store);
    return send(res, 201, { invoice, store });
  }
  if (url.pathname === '/api/import/camt054') {
    if (!payload.xml) return send(res, 422, { error: 'Filen saknar läsbart bankinnehåll.' });
    const imported = /<Ntry(?:\s|>)/i.test(payload.xml) ? parseCamt(payload.xml, store) : parseBam(payload.xml, store);
    const batch = 'BANK-' + new Date().toISOString().replace(/[^0-9]/g,'');
    imported.forEach(t => t.batch = batch);
    const autoBooked = autoBookMatches(store, imported);
    if (imported.length) store.settings.lastBankImport = imported.reduce((latest, item) => item.date > latest ? item.date : latest, imported[0].date);
    appendActivity(store, `${imported.length} banktransaktioner importerades från ${payload.filename || 'bankfil'}${autoBooked.length ? `; ${autoBooked.length} bokfördes automatiskt efter säker matchning` : ''}.`, imported.length ? 'success' : 'notice');
    writeStore(store);
    return send(res, 201, { imported, autoBooked, store });
  }
  if (url.pathname === '/api/bank/resolve') {
    const tx = store.bankTransactions.find(item => item.id === payload.id);
    if (!tx) return send(res, 404, { error: 'Banktransaktionen hittades inte.' });
    if (tx.status !== 'Granska') return send(res, 409, { error: 'Banktransaktionen är redan hanterad och har en verifikation.' });
    if (tx.currency && tx.currency !== 'SEK') return send(res, 422, { error: 'Valutahantering måste ställas in innan transaktionen kan bokföras.' });
    if (payload.action === 'match') {
      const kind = tx.amount > 0 ? 'customer' : 'supplier';
      const candidates = (kind === 'customer' ? store.invoices : store.supplierInvoices).filter(i => payload.invoiceId ? i.id === payload.invoiceId : Finance.invoiceNumber(i) === payload.invoiceNumber);
      if (candidates.length !== 1) return send(res, 422, { error: 'Välj en entydig faktura med rätt betalningsriktning.' });
      registerPayment(store, kind, candidates[0], { amount: Math.abs(tx.amount), date: tx.date, method: 'Bank', reference: tx.transactionRef }, tx);
      appendActivity(store, `Bankhändelsen kopplades till ${Finance.invoiceNumber(candidates[0])} och reskontran uppdaterades.`, 'success');
      writeStore(store);
      return send(res, 200, { transaction: tx, store });
    }
    if (payload.action !== 'book') return send(res, 422, { error: 'Välj fakturamatchning eller kontobokning.' });
    const pattern = tx.amount > 0 ? /^3\d{3}(?=\s|$)/ : /^(?:[4-7]\d{3}|84\d{2})(?=\s|$)/;
    const account = canonicalAccount(payload.account, pattern);
    if (!account) return send(res, 422, { error: tx.amount > 0 ? 'Välj ett intäktskonto ur kontoplanen för inbetalningen.' : 'Välj ett kostnadskonto ur kontoplanen för utbetalningen.' });
    tx.status = 'Bokförd'; tx.proposal = `Manuellt bokförd på ${account}`; tx.account = account;
    const isIncoming = tx.amount > 0;
    const entry = addJournal(store, { date: tx.date, description: `${tx.text} (${tx.transactionRef})`, rows: isIncoming ? [{ account: '1930 Företagskonto', debit: tx.amount, credit: 0 }, { account, debit: 0, credit: tx.amount }] : [{ account, debit: Math.abs(tx.amount), credit: 0 }, { account: '1930 Företagskonto', debit: 0, credit: Math.abs(tx.amount) }], source: 'Bankavstämning' });
    tx.journalNumber = entry.number; tx.batch = entry.batchNumber;
    appendActivity(store, `Banktransaktion ${tx.transactionRef} bokfördes på ${account}.`, 'success');
    writeStore(store);
    return send(res, 200, { transaction: tx, store });
  }
  if (url.pathname === '/api/supplier-invoices/approve') {
    const invoice = store.supplierInvoices.find(item => item.id === payload.id);
    if (!invoice) return send(res, 404, { error: 'Fakturan hittades inte.' });
    if (invoice.status !== 'Attest väntar') return send(res, 409, { error: 'Fakturan är redan attesterad.' });
    const postingDate = String(payload.postingDate || today()).slice(0,10);
    if (!Finance.validDate(postingDate) || postingDate > today()) return send(res, 422, { error: 'Bokföringsdagen måste vara giltig och får inte ligga framåt i tiden.' });
    const expenseAccount = canonicalAccount(invoice.suggestedAccount, /^(?:[4-7]\d{3}|84\d{2})(?=\s|$)/);
    if (!expenseAccount) return send(res, 422, {error: 'Fakturans kostnadskonto finns inte i kontoplanen.'});
    invoice.suggestedAccount = expenseAccount;
    invoice.status = 'Bokförd';
    const rows = [{account: expenseAccount, debit: invoice.net, credit: 0}];
    if (invoice.vat) rows.push({account: '2641 Ingående moms', debit: invoice.vat, credit: 0});
    rows.push({account: '2440 Leverantörsskulder', debit: 0, credit: invoice.total});
    const entry = addJournal(store, {date: postingDate, description: `Inköp ${invoice.supplier}, ${invoice.invoiceNumber}`, rows, source: invoice.source});
    invoice.journalNumber = entry.number; invoice.bookedDate = entry.date; invoice.postingDate = entry.postingDate; invoice.batchNumber = entry.batchNumber;
    appendActivity(store, `Leverantörsfaktura ${invoice.invoiceNumber} attesterades och bokfördes.`, 'success');
    writeStore(store);
    return send(res, 200, { invoice, store });
  }
  return send(res, 404, { error: 'Hittades inte' });
}

let mutationQueue = Promise.resolve();
function queueMutation(task) {
  const operation = mutationQueue.then(task);
  mutationQueue = operation.catch(() => undefined);
  return operation;
}
function readJsonRequest(req, res, callback) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    send(res, 415, {error: 'API-anrop som ändrar data måste använda application/json.'});
    req.resume();
    return;
  }
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    send(res, 413, {error: `Begäran är för stor. Max ${maxRequestBytes} byte.`});
    req.resume();
    return;
  }
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > maxRequestBytes) {
      tooLarge = true;
      chunks.length = 0;
      if (!res.writableEnded) send(res, 413, {error: `Begäran är för stor. Max ${maxRequestBytes} byte.`});
      return;
    }
    if (!tooLarge) chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooLarge || res.writableEnded) return;
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      const payload = raw ? JSON.parse(raw) : {};
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, {error: 'JSON-innehållet måste vara ett objekt.'});
      callback(payload);
    } catch (error) {
      send(res, 400, {error: `Kunde inte läsa begäran: ${error.message}`});
    }
  });
  req.on('error', error => sendError(res, error));
}
function resolveStaticPath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = path.resolve(publicDir, relative);
  return candidate === publicDir || candidate.startsWith(publicDir + path.sep) ? candidate : null;
}

const server = http.createServer((req, res) => {
  const requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  if (!requestHostAllowed(req)) return send(res, 421, {error: 'Värdnamnet är inte tillåtet. Kontrollera ROLLANDS_ALLOWED_HOSTS.'});
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { return send(res, 400, {error: 'Ogiltig adress.'}); }

  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET') return handleApi(req, res, url, {}).catch(error => sendError(res, error));
    if (req.method !== 'POST') return send(res, 405, {error: 'Metoden stöds inte.'}, 'application/json; charset=utf-8', {Allow: 'GET, POST'});
    return readJsonRequest(req, res, payload => {
      queueMutation(() => handleApi(req, res, url, payload)).catch(error => sendError(res, error));
    });
  }

  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Metoden stöds inte.', 'text/plain; charset=utf-8', {Allow: 'GET, HEAD'});
  const safePath = resolveStaticPath(url.pathname);
  if (!safePath) return send(res, 403, 'Åtkomst nekad', 'text/plain; charset=utf-8');
  fs.realpath(safePath, (realPathError, realPath) => {
    if (realPathError || !(realPath === publicDirReal || realPath.startsWith(publicDirReal + path.sep))) return send(res, 404, 'Sidan hittades inte', 'text/plain; charset=utf-8');
    fs.stat(realPath, (statError, stat) => {
      if (statError || !stat.isFile()) return send(res, 404, 'Sidan hittades inte', 'text/plain; charset=utf-8');
      fs.readFile(realPath, (error, content) => {
        if (error) return send(res, 404, 'Sidan hittades inte', 'text/plain; charset=utf-8');
        send(res, 200, content, mime[path.extname(realPath)] || 'application/octet-stream');
      });
    });
  });
});

let lockDescriptor = null;
const lockFile = path.join(dataDir, 'server.lock');
function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function acquireDataLock() {
  fs.mkdirSync(dataDir, {recursive: true, mode: 0o700});
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lockDescriptor = fs.openSync(lockFile, 'wx', 0o600);
      try {
        fs.writeFileSync(lockDescriptor, JSON.stringify({pid: process.pid, startedAt: new Date().toISOString(), host}));
        fs.fsyncSync(lockDescriptor);
        return;
      } catch (error) {
        try { fs.closeSync(lockDescriptor); } catch {}
        lockDescriptor = null;
        fs.rmSync(lockFile, {force: true});
        throw error;
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let current = null;
      let ageMs = 0;
      try {
        current = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        ageMs = Date.now() - fs.statSync(lockFile).mtimeMs;
      } catch {
        try { ageMs = Date.now() - fs.statSync(lockFile).mtimeMs; } catch {}
      }
      if (processExists(Number(current?.pid))) throw new Error(`En annan Rollands-server använder redan datakatalogen (process ${current.pid}).`);
      if (!current?.pid && ageMs < 30_000) throw new Error('Datalagrets låsfil håller på att skapas av en annan process. Försök igen när den processen har avslutats.');
      if (attempt === 0) {
        fs.rmSync(lockFile, {force: true});
        continue;
      }
      throw new Error('Datalagrets låsfil kunde inte tas över på ett säkert sätt.');
    }
  }
}
function releaseDataLock() {
  if (lockDescriptor !== null) {
    try { fs.closeSync(lockDescriptor); } catch {}
    lockDescriptor = null;
  }
  try {
    const current = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (Number(current.pid) === process.pid) fs.rmSync(lockFile, {force: true});
  } catch {}
}

if (require.main === module) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT måste vara ett heltal mellan 1 och 65535.');
  if (!isLoopbackHost(host) && adminToken.length < 24) throw new Error('ROLLANDS_ADMIN_TOKEN måste vara minst 24 tecken innan servern får lyssna utanför den lokala datorn.');
  if (['0.0.0.0', '::'].includes(normalizeHostname(host)) && !configuredAllowedHosts.length) throw new Error('ROLLANDS_ALLOWED_HOSTS måste anges när ROLLANDS_HOST är en jokeradress.');
  ensureStore();
  acquireDataLock();
  process.once('exit', releaseDataLock);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { releaseDataLock(); process.exit(0); }));
  server.listen(port, host, () => console.log(`Rollands Ekonomi körs på http://${host}:${port}`));
}
module.exports = {server, emptyState, seedState, readStore, writeStore, today, dataFile, registerPayment, registerPayout, autoBookMatches, applyOffset, reclassifyPayment};
