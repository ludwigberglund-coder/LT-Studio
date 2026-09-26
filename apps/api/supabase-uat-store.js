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

  return Object.freeze({listCustomers,customerByNumber,listSuppliers,supplierByNumber});
}

module.exports=Object.freeze({createSupabaseUatStore});
