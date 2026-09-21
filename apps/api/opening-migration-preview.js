'use strict';

const Accounting=require('./accounting-store.js');

function previewError(message,code='OPENING_MIGRATION_PREVIEW_ERROR',statusCode=422){
  const error=new Error(message);error.code=code;error.statusCode=statusCode;return error;
}
function text(value){return String(value??'').trim()}
function validYear(value){return /^(19|20|21)\d{2}$/.test(text(value))}
function validDate(value){return Accounting.validDate(text(value))}
function safePositiveOre(value){return Number.isSafeInteger(value)&&value>0}
function normalizeSupplierInvoiceNumber(value){
  return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function blocker(code,message,scope='package',reference=''){return Object.freeze({code,message,scope,reference:text(reference)||null})}

function rawLineTotals(lines){
  let debit=0n,credit=0n,account1510=0n,account2440=0n;
  for(const line of Array.isArray(lines)?lines:[]){
    const account=text(line?.account),d=line?.debitOre,c=line?.creditOre;
    if(!Number.isSafeInteger(d)||!Number.isSafeInteger(c)||d<0||c<0)continue;
    debit+=BigInt(d);credit+=BigInt(c);
    if(account==='1510')account1510+=BigInt(d)-BigInt(c);
    if(account==='2440')account2440+=BigInt(c)-BigInt(d);
  }
  const max=BigInt(Number.MAX_SAFE_INTEGER);
  const number=value=>value>max||value<-max?null:Number(value);
  return{debitOre:number(debit),creditOre:number(credit),account1510Ore:number(account1510),account2440Ore:number(account2440)};
}

function validateOpeningLines(lines,blockers){
  if(!Array.isArray(lines)){
    blockers.push(blocker('OPENING_LINES_REQUIRED','Ingående balans måste skickas som en lista.','opening-balance'));
    return null;
  }
  for(const [index,line] of lines.entries()){
    const account=text(line?.account);
    if(account&&!/^[12]\d{3}$/.test(account)){
      blockers.push(blocker('OPENING_BALANCE_ACCOUNT_NOT_ALLOWED',`Rad ${index+1}: migrationspaketet får endast använda balanskonton i klass 1–2.`,'opening-balance',account));
    }
  }
  try{return Accounting.validateLines(lines)}
  catch(error){
    blockers.push(blocker(error.code||'INVALID_OPENING_BALANCE',String(error.message||'Ingående balans är ogiltig.'),'opening-balance'));
    return null;
  }
}

function validateReceivables(db,companyId,items,postingDate,blockers){
  if(!Array.isArray(items)){
    blockers.push(blocker('RECEIVABLES_REQUIRED','Öppna kundposter måste skickas som en lista.','receivables'));
    return{count:0,totalOre:0,missingCustomerNumbers:[]};
  }
  if(items.length>2000)throw previewError('För många kundposter i samma preview. Dela upp underlaget.','OPENING_MIGRATION_TOO_LARGE',413);
  const seen=new Set(),missingCustomers=new Set();
  let total=0n;
  for(const [index,item] of items.entries()){
    const ref=`kundpost ${index+1}`,customerNumber=text(item?.customerNumber),invoiceNumber=text(item?.invoiceNumber);
    const invoiceDate=text(item?.invoiceDate),dueDate=text(item?.dueDate);
    const totalOre=item?.totalOre,remainingOre=item?.remainingOre;
    if(!customerNumber)blockers.push(blocker('CUSTOMER_NUMBER_REQUIRED',`${ref}: kundnummer saknas.`,'receivables',invoiceNumber));
    if(!invoiceNumber||invoiceNumber.length>100)blockers.push(blocker('CUSTOMER_INVOICE_NUMBER_INVALID',`${ref}: fakturanummer saknas eller är för långt.`,'receivables',invoiceNumber));
    if(invoiceNumber){
      if(seen.has(invoiceNumber))blockers.push(blocker('DUPLICATE_CUSTOMER_INVOICE_IN_PACKAGE',`${ref}: fakturanummer ${invoiceNumber} förekommer flera gånger i migrationspaketet.`,'receivables',invoiceNumber));
      seen.add(invoiceNumber);
      if(db.prepare('SELECT 1 FROM invoices WHERE company_id=? AND invoice_number=?').get(companyId,invoiceNumber)){
        blockers.push(blocker('CUSTOMER_INVOICE_ALREADY_EXISTS',`${ref}: fakturanummer ${invoiceNumber} finns redan i företaget.`,'receivables',invoiceNumber));
      }
    }
    if(!validDate(invoiceDate)||invoiceDate>=postingDate)blockers.push(blocker('OPEN_RECEIVABLE_INVOICE_DATE_INVALID',`${ref}: fakturadatum måste vara ett giltigt datum före systemstarten ${postingDate}.`,'receivables',invoiceNumber));
    if(!validDate(dueDate)||validDate(invoiceDate)&&dueDate<invoiceDate)blockers.push(blocker('OPEN_RECEIVABLE_DUE_DATE_INVALID',`${ref}: förfallodatum är ogiltigt eller tidigare än fakturadatum.`,'receivables',invoiceNumber));
    if(!safePositiveOre(totalOre)||!safePositiveOre(remainingOre)||remainingOre>totalOre){
      blockers.push(blocker('OPEN_RECEIVABLE_AMOUNT_INVALID',`${ref}: totalbelopp och öppet belopp måste vara positiva heltalsören och öppet belopp får inte överstiga totalbeloppet.`,'receivables',invoiceNumber));
    }else total+=BigInt(remainingOre);
    if(customerNumber&&!db.prepare('SELECT 1 FROM customers WHERE company_id=? AND customer_number=?').get(companyId,customerNumber))missingCustomers.add(customerNumber);
  }
  for(const number of [...missingCustomers].sort((a,b)=>a.localeCompare(b,'sv'))){
    blockers.push(blocker('CUSTOMER_MASTERDATA_MISSING',`Kundnummer ${number} finns inte i det inloggade företaget.`,'receivables',number));
  }
  if(total>BigInt(Number.MAX_SAFE_INTEGER))blockers.push(blocker('RECEIVABLE_TOTAL_TOO_LARGE','Summan av öppna kundposter är för stor för säker öresberäkning.','receivables'));
  return{count:items.length,totalOre:total>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(total),missingCustomerNumbers:[...missingCustomers].sort((a,b)=>a.localeCompare(b,'sv'))};
}

function validatePayables(db,companyId,items,postingDate,blockers){
  if(!Array.isArray(items)){
    blockers.push(blocker('PAYABLES_REQUIRED','Öppna leverantörsposter måste skickas som en lista.','payables'));
    return{count:0,totalOre:0,missingSupplierNumbers:[]};
  }
  if(items.length>2000)throw previewError('För många leverantörsposter i samma preview. Dela upp underlaget.','OPENING_MIGRATION_TOO_LARGE',413);
  const seen=new Set(),missingSuppliers=new Set();
  let total=0n;
  for(const [index,item] of items.entries()){
    const ref=`leverantörspost ${index+1}`,supplierNumber=text(item?.supplierNumber),invoiceNumber=text(item?.invoiceNumber);
    const normalized=normalizeSupplierInvoiceNumber(invoiceNumber),invoiceDate=text(item?.invoiceDate),dueDate=text(item?.dueDate);
    const totalOre=item?.totalOre,remainingOre=item?.remainingOre;
    if(!supplierNumber)blockers.push(blocker('SUPPLIER_NUMBER_REQUIRED',`${ref}: leverantörsnummer saknas.`,'payables',invoiceNumber));
    if(!invoiceNumber||invoiceNumber.length>100||!normalized)blockers.push(blocker('SUPPLIER_INVOICE_NUMBER_INVALID',`${ref}: fakturanummer saknas eller är ogiltigt.`,'payables',invoiceNumber));
    const key=`${supplierNumber}\u0000${normalized}`;
    if(supplierNumber&&normalized){
      if(seen.has(key))blockers.push(blocker('DUPLICATE_SUPPLIER_INVOICE_IN_PACKAGE',`${ref}: leverantörens fakturanummer ${invoiceNumber} förekommer flera gånger i migrationspaketet.`,'payables',invoiceNumber));
      seen.add(key);
    }
    const supplier=supplierNumber?db.prepare('SELECT id FROM suppliers WHERE company_id=? AND supplier_number=?').get(companyId,supplierNumber):null;
    if(supplierNumber&&!supplier)missingSuppliers.add(supplierNumber);
    if(supplier&&normalized){
      const existing=db.prepare('SELECT supplier_invoice_number AS invoiceNumber FROM supplier_invoices WHERE company_id=? AND supplier_id=?').all(companyId,supplier.id);
      if(existing.some(row=>normalizeSupplierInvoiceNumber(row.invoiceNumber)===normalized)){
        blockers.push(blocker('SUPPLIER_INVOICE_ALREADY_EXISTS',`${ref}: leverantörsfaktura ${invoiceNumber} finns redan i företaget.`,'payables',invoiceNumber));
      }
    }
    if(!validDate(invoiceDate)||invoiceDate>=postingDate)blockers.push(blocker('OPEN_PAYABLE_INVOICE_DATE_INVALID',`${ref}: fakturadatum måste vara ett giltigt datum före systemstarten ${postingDate}.`,'payables',invoiceNumber));
    if(!validDate(dueDate)||validDate(invoiceDate)&&dueDate<invoiceDate)blockers.push(blocker('OPEN_PAYABLE_DUE_DATE_INVALID',`${ref}: förfallodatum är ogiltigt eller tidigare än fakturadatum.`,'payables',invoiceNumber));
    if(!safePositiveOre(totalOre)||!safePositiveOre(remainingOre)||remainingOre>totalOre){
      blockers.push(blocker('OPEN_PAYABLE_AMOUNT_INVALID',`${ref}: totalbelopp och öppet belopp måste vara positiva heltalsören och öppet belopp får inte överstiga totalbeloppet.`,'payables',invoiceNumber));
    }else total+=BigInt(remainingOre);
  }
  for(const number of [...missingSuppliers].sort((a,b)=>a.localeCompare(b,'sv'))){
    blockers.push(blocker('SUPPLIER_MASTERDATA_MISSING',`Leverantörsnummer ${number} finns inte i det inloggade företaget.`,'payables',number));
  }
  if(total>BigInt(Number.MAX_SAFE_INTEGER))blockers.push(blocker('PAYABLE_TOTAL_TOO_LARGE','Summan av öppna leverantörsposter är för stor för säker öresberäkning.','payables'));
  return{count:items.length,totalOre:total>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(total),missingSupplierNumbers:[...missingSuppliers].sort((a,b)=>a.localeCompare(b,'sv'))};
}

function previewOpeningMigration(db,{companyId,year,postingDate,lines,receivables=[],payables=[]}={}){
  if(!db||typeof db.prepare!=='function')throw previewError('Databas krävs för migrationspreview.','OPENING_MIGRATION_DATABASE_REQUIRED',500);
  const company=text(companyId),fiscalYear=text(year),date=text(postingDate);
  if(!company)throw previewError('Företag saknas för migrationspreview.','OPENING_MIGRATION_COMPANY_REQUIRED',500);
  const blockers=[];
  if(!validYear(fiscalYear))blockers.push(blocker('OPENING_MIGRATION_YEAR_INVALID','Räkenskapsåret måste anges med fyra siffror.','package',fiscalYear));
  const expectedDate=validYear(fiscalYear)?`${fiscalYear}-01-01`:'';
  if(!validDate(date)||!expectedDate||date!==expectedDate)blockers.push(blocker('OPENING_MIGRATION_DATE_INVALID',`Systemstarten måste vara 1 januari för valt år${expectedDate?`: ${expectedDate}`:''}.`,'package',date));

  const validatedLines=validateOpeningLines(lines,blockers);
  const raw=rawLineTotals(lines);
  const receivableCheck=validateReceivables(db,company,receivables,date||expectedDate,blockers);
  const payableCheck=validatePayables(db,company,payables,date||expectedDate,blockers);

  const account1510Ore=raw.account1510Ore;
  const account2440Ore=raw.account2440Ore;
  const receivableDifferenceOre=account1510Ore===null||receivableCheck.totalOre===null?null:account1510Ore-receivableCheck.totalOre;
  const payableDifferenceOre=account2440Ore===null||payableCheck.totalOre===null?null:account2440Ore-payableCheck.totalOre;
  if(receivableDifferenceOre!==0)blockers.push(blocker('RECEIVABLE_CONTROL_MISMATCH',`Konto 1510 avviker från öppna kundposter med ${receivableDifferenceOre===null?'okänt belopp':receivableDifferenceOre+' öre'}.`,'control','1510'));
  if(payableDifferenceOre!==0)blockers.push(blocker('PAYABLE_CONTROL_MISMATCH',`Konto 2440 avviker från öppna leverantörsposter med ${payableDifferenceOre===null?'okänt belopp':payableDifferenceOre+' öre'}.`,'control','2440'));

  const existingOpening=validYear(fiscalYear)?db.prepare(`SELECT id FROM accounting_entries WHERE company_id=? AND source_type='opening-balance' AND source_id=?`).get(company,fiscalYear):null;
  if(existingOpening)blockers.push(blocker('OPENING_BALANCE_ALREADY_EXISTS',`Det finns redan en ingående balans för ${fiscalYear}.`,'database',fiscalYear));
  if(validYear(fiscalYear)&&!existingOpening){
    const existingYearEntry=db.prepare('SELECT id FROM accounting_entries WHERE company_id=? AND fiscal_year=? LIMIT 1').get(company,fiscalYear);
    if(existingYearEntry)blockers.push(blocker('OPENING_MIGRATION_REQUIRES_EMPTY_YEAR','Systembytespaketet måste behandlas innan årets övriga verifikationer finns.','database',fiscalYear));
  }

  return Object.freeze({
    mode:'preview-only',
    executionSupported:false,
    status:blockers.length?'blocked':'pass',
    year:fiscalYear,
    postingDate:date,
    counts:Object.freeze({openingLines:Array.isArray(lines)?lines.length:0,receivables:receivableCheck.count,payables:payableCheck.count}),
    controls:Object.freeze({
      openingBalance:Object.freeze({valid:Boolean(validatedLines),debitOre:raw.debitOre,creditOre:raw.creditOre}),
      receivables:Object.freeze({subledgerOre:receivableCheck.totalOre,account1510Ore,differenceOre:receivableDifferenceOre,matched:receivableDifferenceOre===0}),
      payables:Object.freeze({subledgerOre:payableCheck.totalOre,account2440Ore,differenceOre:payableDifferenceOre,matched:payableDifferenceOre===0})
    }),
    masterdata:Object.freeze({
      missingCustomerNumbers:Object.freeze(receivableCheck.missingCustomerNumbers),
      missingSupplierNumbers:Object.freeze(payableCheck.missingSupplierNumbers)
    }),
    blockers:Object.freeze(blockers),
    warnings:Object.freeze([
      Object.freeze({code:'PREVIEW_ONLY',message:'Detta är endast en förhandskontroll. Ingen faktura, reskontrapost, verifikation eller auditpost har skapats.'}),
      Object.freeze({code:'POSITIVE_OPEN_ITEMS_ONLY',message:'Den första kontrollversionen accepterar endast positiva öppna kund- och leverantörsposter. Kreditposter kräver ett separat migreringsflöde.'})
    ])
  });
}

module.exports=Object.freeze({previewOpeningMigration,normalizeSupplierInvoiceNumber});
