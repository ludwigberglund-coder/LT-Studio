'use strict';
// Read-only, tenant-scoped reuse of *posted and human-approved* supplier coding.
// This is case-based learning, not model training or an authorization to post.
// The caller must fetch rows through its authenticated RLS-scoped session.
(function(root){
  const ACCOUNTS=Object.freeze({'6110':'Kontorsmateriel','5460':'Förbrukningsmaterial','6540':'IT-tjänster'});
  const RATES=Object.freeze([0,6,12,25]);
  const SHA=/^[a-f0-9]{64}$/i;
  const MAX_HISTORY=200;
  function normalizeName(value){
    return typeof value==='string'&&value.length<=180?
      value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('sv-SE'):'';
  }
  function ore(value){return Number.isSafeInteger(value)&&value>=0&&value<=99999999999;}
  function rate(net,vat){
    if(!ore(net)||!ore(vat)||net===0)return null;
    const matches=RATES.filter(x=>Math.abs(vat*100-net*x)<=100);
    return matches.length===1?matches[0]:null;
  }
  function no(reason){return Object.freeze({status:'no-suggestion',reason,account:null,sampleCount:0});}
  function field(facts,name,kind){
    const item=facts?.fields?.[name];
    if(!item||item.verified!==false||typeof item.value!==kind)return null;
    return item.value;
  }
  function safeSource(facts){
    if(!facts||facts.source!=='local-pdf-text'||facts.status!=='needs-review'||
      facts.posted!==false||facts.documentType!=='supplier-invoice'||
      facts.checks?.amountBalance!==true||
      facts.checks.creditNote!==false||facts.checks.negativeSummary!==false||
      facts.checks.mixedVatRates!==false||
      !Array.isArray(facts.warnings)||
      facts.warnings.some(w=>typeof w!=='string'||/utländsk valuta|motstridiga/i.test(w)))return null;
    const supplier=field(facts,'supplier','string');
    const date=field(facts,'invoiceDate','string');
    const reference=field(facts,'reference','string');
    const net=field(facts,'netOre','number'),vat=field(facts,'vatOre','number'),gross=field(facts,'grossOre','number');
    const calculated=rate(net,vat);
    if(!normalizeName(supplier)||!reference||reference.length>64||
      !/^(?:19|20)\d{2}-\d{2}-\d{2}$/.test(date||'')||
      Number.isNaN(Date.parse(date+'T00:00:00Z'))||
      new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||
      !ore(gross)||gross===0||!ore(net)||!ore(vat)||net+vat!==gross||
      calculated===null||
      (facts.checks.declaredVatRate!==null&&facts.checks.declaredVatRate!==calculated))return null;
    return {supplier:normalizeName(supplier),rate:calculated};
  }
  function eligibleInvoice(invoice,companyId,supplierId,vatRate){
    if(!invoice||invoice.company_id!==companyId||invoice.supplier_id!==supplierId||
      !['approved','payment-prepared','paid'].includes(invoice.status)||
      typeof invoice.approved_by!=='string'||!invoice.approved_by||
      typeof invoice.approved_at!=='string'||!invoice.approved_at||
      typeof invoice.liability_accounting_entry_id!=='string'||!invoice.liability_accounting_entry_id||
      typeof invoice.liability_posted_at!=='string'||!invoice.liability_posted_at||
      !SHA.test(invoice.pdf_sha256||'')||!SHA.test(invoice.coding_sha256||'')||
      invoice.currency!=='SEK'||invoice.vat_treatment!=='se-domestic-full-input-vat'||
      !ore(invoice.total_ore)||invoice.total_ore===0||
      !ore(invoice.vat_ore)||!Array.isArray(invoice.coding_json))return null;
    const net=invoice.total_ore-invoice.vat_ore;
    if(rate(net,invoice.vat_ore)!==vatRate)return null;
    const rows=invoice.coding_json;
    if(rows.length!==(invoice.vat_ore===0?2:3))return null;
    if(rows.some(r=>!r||typeof r!=='object'||!ore(r.debitOre)||!ore(r.creditOre)||
      (r.debitOre>0&&r.creditOre>0)))return null;
    const expenses=rows.filter(r=>Object.hasOwn(ACCOUNTS,String(r.account))&&r.debitOre===net&&r.creditOre===0);
    const vat=rows.filter(r=>r.account==='2641'&&r.debitOre===invoice.vat_ore&&r.creditOre===0);
    const liability=rows.filter(r=>r.account==='2440'&&r.debitOre===0&&r.creditOre===invoice.total_ore);
    if(expenses.length!==1||vat.length!==(invoice.vat_ore===0?0:1)||liability.length!==1||
      rows.reduce((sum,r)=>sum+r.debitOre-r.creditOre,0)!==0)return null;
    return String(expenses[0].account);
  }
  function recommend({companyId,extraction,suppliers,invoices}={}){
    if(typeof companyId!=='string'||!companyId||companyId.length>100||
      !Array.isArray(suppliers)||!Array.isArray(invoices)||
      suppliers.length>MAX_HISTORY||invoices.length>MAX_HISTORY)return no('invalid-context');
    const facts=safeSource(extraction);
    if(!facts)return no('unsafe-document');
    // Exact name matching is deliberately conservative: no fuzzy match,
    // shared supplier defaults, model embeddings or cross-company memory.
    const matches=suppliers.filter(s=>s&&s.company_id===companyId&&
      typeof s.id==='string'&&s.id&&normalizeName(s.name)===facts.supplier);
    if(matches.length!==1)return no('supplier-not-unique');
    return postedHistoryForSupplier(companyId,matches[0].id,facts.rate,invoices);
  }
  function postedHistoryForSupplier(companyId,supplierId,vatRate,invoices){
    // Shared evidence engine: both uploaded-PDF preview and stored payables
    // use the same strict historical row checks, not two parallel predictors.
    const accounts=new Set(),seenDocs=new Map();
    for(const row of invoices){
      const account=eligibleInvoice(row,companyId,supplierId,vatRate);
      if(!account)continue;
      const key=row.pdf_sha256.toLowerCase();
      if(seenDocs.has(key)){
        if(seenDocs.get(key)!==account)return no('conflicting-history');
        continue;
      }
      seenDocs.set(key,account);
      accounts.add(account);
      if(accounts.size>1)return no('conflicting-history');
    }
    if(seenDocs.size<3)return no('not-enough-approved-posted-history');
    const account=[...accounts][0];
    return Object.freeze({
      status:'suggested',account,accountName:ACCOUNTS[account],
      sampleCount:seenDocs.size,vatRate,
      reason:'Samma konto användes på minst tre tidigare attesterade och bokförda fakturor från exakt samma leverantör och med samma momssats.',
      requiresHumanApproval:true,posted:false,saved:false,aiGenerated:false
    });
  }
  function normalizedReference(value){
    if(typeof value!=='string'||value.length<1||value.length>100||
        /[\u0000-\u001f\u007f]/u.test(value))return '';
    // Match the database's generated invoice_reference_key: NFKC,
    // uppercase and ALL internal whitespace removed. Keep punctuation.
    const key=value.normalize('NFKC').replace(/\s+/gu,'').toLocaleUpperCase('sv-SE');
    return key.length<=100?key:'';
  }
  function validDate(value){
    if(typeof value!=='string'||! /^(?:19|20)\d{2}-\d{2}-\d{2}$/.test(value))return false;
    const d=new Date(value+'T00:00:00.000Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
  }
  function safeStoredSource(source,document,companyId){
    // This data must come from authenticated, RLS-scoped Supabase reads. Even
    // when it looks valid, it is ONLY sufficient for a preview in the browser.
    if(!source||typeof source!=='object'||source.company_id!==companyId||
      typeof source.id!=='string'||!source.id||source.id.length>100||
      typeof source.supplier_id!=='string'||!source.supplier_id||
      !['registered','coding-review'].includes(source.status)||
      !SHA.test(source.pdf_sha256||'')||
      source.currency!=='SEK'||source.vat_treatment!=='se-domestic-full-input-vat'||
      !validDate(source.invoice_date)||!normalizedReference(source.supplier_invoice_number)||
      !Array.isArray(source.coding_json)||source.coding_json.length!==0||
      source.approved_at||source.approved_by||source.liability_accounting_entry_id||
      source.liability_posted_at||
      !ore(source.total_ore)||source.total_ore===0||
      !ore(source.vat_ore)||source.vat_ore>=source.total_ore)return null;
    const net=source.total_ore-source.vat_ore;
    const vatRate=rate(net,source.vat_ore);
    if(vatRate===null)return null;
    if(!document||document.company_id!==companyId||document.source_id!==source.id||
      document.source_type!=='supplier-invoice'||document.mime_type!=='application/pdf'||
      !SHA.test(document.sha256||'')||
      document.sha256.toLowerCase()!==source.pdf_sha256.toLowerCase()||
      typeof document.object_path!=='string'||!document.object_path||
      document.object_path.length>512||
      !Number.isSafeInteger(Number(document.size_bytes))||
      Number(document.size_bytes)<1||Number(document.size_bytes)>10485760)return null;
    return {supplierId:source.supplier_id,vatRate,reference:normalizedReference(source.supplier_invoice_number),sourceHash:source.pdf_sha256.toLowerCase()};
  }
  function recommendStoredInvoice({companyId,source,document,invoices}={}){
    if(typeof companyId!=='string'||!companyId||companyId.length>100||
      !Array.isArray(invoices)||invoices.length>=MAX_HISTORY)return no('history-incomplete');
    // The active payables page receives this collection through its own tenant
    // filter and Supabase RLS. Mixed-tenant results must fail closed.
    if(invoices.some(row=>!row||typeof row!=='object'||row.company_id!==companyId)){
      return no('tenant-mismatch');
    }
    const facts=safeStoredSource(source,document,companyId);
    if(!facts)return no('unsafe-document');
    if(hasStoredDuplicate(source,facts,invoices))return no('possible-duplicate');
    return postedHistoryForSupplier(companyId,facts.supplierId,facts.vatRate,invoices);
  }
  function hasStoredDuplicate(source,facts,invoices){
    return invoices.some(row=>row.id!==source.id&&(
      (SHA.test(row.pdf_sha256||'')&&row.pdf_sha256.toLowerCase()===facts.sourceHash)||
      (row.supplier_id===facts.supplierId&&
        normalizedReference(row.supplier_invoice_number)===facts.reference)
    ));
  }
  function buildStoredReview({companyId,source,document,invoices,expenseAccount}={}){
    const allowed=['4010','6110','5460','6540'];
    if(typeof companyId!=='string'||!companyId||companyId.length>100||
      !Array.isArray(invoices)||invoices.length>=MAX_HISTORY||
      invoices.some(row=>!row||typeof row!=='object'||row.company_id!==companyId)){
      return no('unsafe-history');
    }
    const facts=safeStoredSource(source,document,companyId);
    if(!facts)return no('unsafe-document');
    if(hasStoredDuplicate(source,facts,invoices))return no('possible-duplicate');
    if(!allowed.includes(expenseAccount))return no('manual-account-required');
    const net=source.total_ore-source.vat_ore,vat=source.vat_ore,gross=source.total_ore;
    const lines=[
      {account:expenseAccount,debitOre:net,creditOre:0,text:'Kontrollera inköp',vatCode:'INPUT_VAT'},
      ...(vat?[{account:'2641',debitOre:vat,creditOre:0,text:'Ingående moms',vatCode:'INPUT_VAT'}]:[]),
      {account:'2440',debitOre:0,creditOre:gross,text:'Leverantörsskuld',vatCode:''}
    ];
    return Object.freeze({
      status:'manual-review',lines:Object.freeze(lines.map(line=>Object.freeze(line))),
      vatRate:facts.vatRate,sourceHash:facts.sourceHash,
      requiresHumanApproval:true,posted:false,saved:false,aiGenerated:false
    });
  }
  const api=Object.freeze({recommend,recommendStoredInvoice,buildStoredReview,normalizeName});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.LTStudioPostedHistory=api;
})(typeof window!=='undefined'?window:null);
