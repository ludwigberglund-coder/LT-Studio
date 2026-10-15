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
    const accounts=new Set(),seenDocs=new Map();
    for(const row of invoices){
      const account=eligibleInvoice(row,companyId,matches[0].id,facts.rate);
      if(!account)continue;
      const key=row.pdf_sha256.toLowerCase();
      if(seenDocs.has(key)){
        if(seenDocs.get(key)!==account)return no('conflicting-history');
        continue; // same original must never inflate evidence count
      }
      seenDocs.set(key,account);
      accounts.add(account);
      if(accounts.size>1)return no('conflicting-history');
    }
    if(seenDocs.size<3)return no('not-enough-approved-posted-history');
    const account=[...accounts][0];
    return Object.freeze({
      status:'suggested',account,accountName:ACCOUNTS[account],
      sampleCount:seenDocs.size,vatRate:facts.rate,
      reason:'Samma konto användes på minst tre tidigare attesterade och bokförda fakturor från exakt samma leverantör och med samma momssats.',
      requiresHumanApproval:true,posted:false,saved:false,aiGenerated:false
    });
  }
  const api=Object.freeze({recommend,normalizeName});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.LTStudioPostedHistory=api;
})(typeof window!=='undefined'?window:null);
