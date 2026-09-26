'use strict';

function supabaseError(message, code='SUPABASE_UAT_ERROR', statusCode=500) {
  const error=new Error(message);
  error.code=code;
  error.statusCode=statusCode;
  return error;
}

function required(value, name) {
  const clean=String(value??'').trim();
  if(!clean) throw supabaseError(`${name} saknas.`, `MISSING_${name}`);
  return clean;
}

function projectUrl(value) {
  const raw=required(value,'SUPABASE_PROJECT_URL').replace(/\/$/,'');
  let parsed;
  try { parsed=new URL(raw); }
  catch { throw supabaseError('SUPABASE_PROJECT_URL är ogiltig.','INVALID_SUPABASE_PROJECT_URL'); }
  if(parsed.protocol!=='https:' || !parsed.hostname.endsWith('.supabase.co')) {
    throw supabaseError('SUPABASE_PROJECT_URL måste vara en HTTPS-adress hos Supabase.','INVALID_SUPABASE_PROJECT_URL');
  }
  return raw;
}

function tenantId(value, name='companyId') {
  const clean=String(value??'').trim();
  if(!/^company_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)) {
    throw supabaseError(`${name} har ogiltigt format.`,'INVALID_TENANT_ID',422);
  }
  return clean;
}

function createSupabaseUatStore({env=process.env,fetchImpl=globalThis.fetch}={}) {
  const baseUrl=projectUrl(env.SUPABASE_PROJECT_URL);
  const serviceRoleKey=required(env.SUPABASE_SERVICE_ROLE_KEY,'SUPABASE_SERVICE_ROLE_KEY');
  if(typeof fetchImpl!=='function') throw supabaseError('Fetch-stöd saknas.','MISSING_FETCH');

  async function request(path,{signal}={}) {
    const response=await fetchImpl(`${baseUrl}/rest/v1/${path}`,{
      method:'GET',
      headers:{
        apikey:serviceRoleKey,
        authorization:`Bearer ${serviceRoleKey}`,
        accept:'application/json'
      },
      signal
    });
    if(!response?.ok) {
      const status=Number(response?.status)||502;
      let details='';
      try { details=String(await response.text()).slice(0,300); } catch {}
      const error=supabaseError(
        `Supabase-anrop misslyckades med HTTP ${status}.`,
        'SUPABASE_REQUEST_FAILED',
        status
      );
      error.details=details;
      throw error;
    }
    const body=await response.json();
    if(!Array.isArray(body)) throw supabaseError('Supabase returnerade oväntat format.','INVALID_SUPABASE_RESPONSE',502);
    return body;
  }

  async function listCustomers(companyId,{signal}={}) {
    const tenant=tenantId(companyId);
    const query=new URLSearchParams({
      select:'id,company_id,customer_number,name,org_number,email,customer_type,reminder_fee_agreed,created_at,updated_at',
      company_id:`eq.${tenant}`,
      order:'customer_number.asc'
    });
    const rows=await request(`customers?${query.toString()}`,{signal});
    for(const row of rows) {
      if(String(row?.company_id||'')!==tenant) {
        throw supabaseError(
          'Supabase returnerade data från fel företag. Åtkomsten stoppades.',
          'TENANT_ISOLATION_ERROR',
          500
        );
      }
    }
    return rows.map(row=>Object.freeze({
      id:row.id,
      companyId:row.company_id,
      customerNumber:row.customer_number,
      name:row.name,
      orgNumber:row.org_number,
      email:row.email,
      customerType:row.customer_type,
      reminderFeeAgreed:Boolean(row.reminder_fee_agreed),
      createdAt:row.created_at,
      updatedAt:row.updated_at
    }));
  }

  async function customerByNumber(companyId,customerNumber,{signal}={}) {
    const tenant=tenantId(companyId);
    const number=String(customerNumber??'').trim();
    if(!number || number.length>80) throw supabaseError('Kundnummer är ogiltigt.','INVALID_CUSTOMER_NUMBER',422);
    const query=new URLSearchParams({
      select:'id,company_id,customer_number,name,org_number,email,customer_type,reminder_fee_agreed,created_at,updated_at',
      company_id:`eq.${tenant}`,
      customer_number:`eq.${number}`,
      limit:'2'
    });
    const rows=await request(`customers?${query.toString()}`,{signal});
    if(rows.length>1) throw supabaseError('Flera kunder hittades med samma kundnummer.','CUSTOMER_INTEGRITY_ERROR',500);
    if(rows.length===0) return null;
    if(String(rows[0]?.company_id||'')!==tenant) {
      throw supabaseError('Supabase returnerade data från fel företag. Åtkomsten stoppades.','TENANT_ISOLATION_ERROR',500);
    }
    const row=rows[0];
    return Object.freeze({
      id:row.id,
      companyId:row.company_id,
      customerNumber:row.customer_number,
      name:row.name,
      orgNumber:row.org_number,
      email:row.email,
      customerType:row.customer_type,
      reminderFeeAgreed:Boolean(row.reminder_fee_agreed),
      createdAt:row.created_at,
      updatedAt:row.updated_at
    });
  }

  async function listSuppliers(companyId,{signal}={}) {
    const tenant=tenantId(companyId);
    const query=new URLSearchParams({
      select:'id,company_id,supplier_number,name,org_number,email,bankgiro,plusgiro,default_cost_account,created_at,updated_at',
      company_id:`eq.${tenant}`,
      order:'name.asc,supplier_number.asc'
    });
    const rows=await request(`suppliers?${query.toString()}`,{signal});
    for(const row of rows) {
      if(String(row?.company_id||'')!==tenant) {
        throw supabaseError('Supabase returnerade data från fel företag. Åtkomsten stoppades.','TENANT_ISOLATION_ERROR',500);
      }
    }
    return rows.map(row=>Object.freeze({
      id:row.id,
      companyId:row.company_id,
      supplierNumber:row.supplier_number,
      name:row.name,
      orgNumber:row.org_number,
      email:row.email,
      bankgiro:row.bankgiro,
      plusgiro:row.plusgiro,
      defaultCostAccount:row.default_cost_account,
      createdAt:row.created_at,
      updatedAt:row.updated_at
    }));
  }

  async function supplierByNumber(companyId,supplierNumber,{signal}={}) {
    const tenant=tenantId(companyId);
    const number=String(supplierNumber??'').trim();
    if(!number || number.length>40) throw supabaseError('Leverantörsnumret är ogiltigt.','INVALID_SUPPLIER_NUMBER',422);
    const query=new URLSearchParams({
      select:'id,company_id,supplier_number,name,org_number,email,bankgiro,plusgiro,default_cost_account,created_at,updated_at',
      company_id:`eq.${tenant}`,
      supplier_number:`eq.${number}`,
      limit:'2'
    });
    const rows=await request(`suppliers?${query.toString()}`,{signal});
    if(rows.length>1) throw supabaseError('Flera leverantörer hittades med samma leverantörsnummer.','SUPPLIER_INTEGRITY_ERROR',500);
    if(rows.length===0) return null;
    if(String(rows[0]?.company_id||'')!==tenant) {
      throw supabaseError('Supabase returnerade data från fel företag. Åtkomsten stoppades.','TENANT_ISOLATION_ERROR',500);
    }
    const row=rows[0];
    return Object.freeze({
      id:row.id,
      companyId:row.company_id,
      supplierNumber:row.supplier_number,
      name:row.name,
      orgNumber:row.org_number,
      email:row.email,
      bankgiro:row.bankgiro,
      plusgiro:row.plusgiro,
      defaultCostAccount:row.default_cost_account,
      createdAt:row.created_at,
      updatedAt:row.updated_at
    });
  }

  async function listCustomerInvoices(companyId,{signal}={}) {
    const tenant=tenantId(companyId);
    const query=new URLSearchParams({
      select:'id,company_id,customer_id,invoice_number,ocr,invoice_date,posting_date,due_date,total_ore,remaining_ore,vat_ore,status,payment_method,payment_account,invoice_account,batch_number,journal_number,pdf_sha256,created_at,updated_at',
      company_id:`eq.${tenant}`,
      order:'invoice_date.desc,invoice_number.desc'
    });
    const rows=await request(`customer_invoices?${query.toString()}`,{signal});
    for(const row of rows) {
      if(String(row?.company_id||'')!==tenant) {
        throw supabaseError('Supabase returnerade faktura från fel företag. Åtkomsten stoppades.','TENANT_ISOLATION_ERROR',500);
      }
    }
    return rows.map(row=>Object.freeze({
      id:row.id,
      companyId:row.company_id,
      customerId:row.customer_id,
      invoiceNumber:row.invoice_number,
      ocr:row.ocr,
      invoiceDate:row.invoice_date,
      postingDate:row.posting_date,
      dueDate:row.due_date,
      totalOre:Number(row.total_ore),
      remainingOre:Number(row.remaining_ore),
      vatOre:Number(row.vat_ore||0),
      status:row.status,
      paymentMethod:row.payment_method,
      paymentAccount:row.payment_account,
      invoiceAccount:row.invoice_account,
      batchNumber:row.batch_number,
      journalNumber:row.journal_number,
      pdfSha256:row.pdf_sha256,
      createdAt:row.created_at,
      updatedAt:row.updated_at
    }));
  }

  async function listSupplierInvoices(companyId,{signal}={}) {
    const tenant=tenantId(companyId);
    const query=new URLSearchParams({
      select:'id,company_id,supplier_id,supplier_invoice_number,invoice_date,due_date,total_ore,vat_ore,currency,vat_treatment,status,coding_json,coding_sha256,document_name,document_mime,document_sha256,registered_by,approved_by,approved_at,liability_accounting_entry_id,liability_posted_at,open_amount_ore,created_at,updated_at',
      company_id:`eq.${tenant}`,
      order:'due_date.asc,created_at.asc'
    });
    const rows=await request(`supplier_invoices?${query.toString()}`,{signal});
    for(const row of rows) {
      if(String(row?.company_id||'')!==tenant) {
        throw supabaseError('Supabase returnerade leverantörsfaktura från fel företag. Åtkomsten stoppades.','TENANT_ISOLATION_ERROR',500);
      }
    }
    return rows.map(row=>Object.freeze({
      id:row.id,
      companyId:row.company_id,
      supplierId:row.supplier_id,
      supplierInvoiceNumber:row.supplier_invoice_number,
      invoiceDate:row.invoice_date,
      dueDate:row.due_date,
      totalOre:Number(row.total_ore),
      vatOre:Number(row.vat_ore||0),
      currency:row.currency,
      vatTreatment:row.vat_treatment,
      status:row.status,
      coding:Array.isArray(row.coding_json)?row.coding_json:[],
      codingSha256:row.coding_sha256,
      documentName:row.document_name,
      documentMime:row.document_mime,
      documentSha256:row.document_sha256,
      registeredBy:row.registered_by,
      approvedBy:row.approved_by,
      approvedAt:row.approved_at,
      liabilityAccountingEntryId:row.liability_accounting_entry_id,
      liabilityPostedAt:row.liability_posted_at,
      openAmountOre:Number(row.open_amount_ore||0),
      createdAt:row.created_at,
      updatedAt:row.updated_at
    }));
  }

  return Object.freeze({listCustomers,customerByNumber,listSuppliers,supplierByNumber,listCustomerInvoices,listSupplierInvoices});
}

module.exports=Object.freeze({createSupabaseUatStore});
