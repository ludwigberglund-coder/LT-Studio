'use strict';

const {createSupabaseUatStore}=require('../apps/api/supabase-uat-store.js');
const Config=require('../apps/api/database-runtime-config.js');

function required(env,name){
  const value=String(env[name]||'').trim();
  if(!value)throw new Error(`${name} måste anges.`);
  return value;
}

async function runPreflight({env=process.env,fetchImpl=globalThis.fetch,write=console.log}={}){
  if(String(env.ROLLANDS_ENV||'').trim()!=='staging') {
    throw new Error('Supabase UAT-preflight får endast köras när ROLLANDS_ENV=staging.');
  }
  if(String(env.ROLLANDS_DATA_CLASSIFICATION||'').trim().toLowerCase()!=='synthetic') {
    throw new Error('ROLLANDS_DATA_CLASSIFICATION måste vara synthetic för Supabase-UAT.');
  }
  if(String(env.ROLLANDS_REAL_DATA_ALLOWED||'').trim()!=='0') {
    throw new Error('ROLLANDS_REAL_DATA_ALLOWED måste vara 0 för Supabase-UAT.');
  }

  const target=Config.resolveDatabaseTarget(env);
  if(target.engine!=='postgresql') {
    throw new Error('LT_DATABASE_ENGINE måste vara postgresql när Supabase UAT verifieras.');
  }

  required(env,'SUPABASE_PROJECT_URL');
  required(env,'SUPABASE_SERVICE_ROLE_KEY');
  const companyId=required(env,'LT_SUPABASE_UAT_COMPANY_ID');

  const store=createSupabaseUatStore({env,fetchImpl});
  const [customers,suppliers,customerInvoices,supplierInvoices]=await Promise.all([
    store.listCustomers(companyId),
    store.listSuppliers(companyId),
    store.listCustomerInvoices(companyId),
    store.listSupplierInvoices(companyId)
  ]);

  const summary=Object.freeze({
    engine:'postgresql',
    dataClassification:'synthetic',
    companyId,
    customers:customers.length,
    suppliers:suppliers.length,
    customerInvoices:customerInvoices.length,
    supplierInvoices:supplierInvoices.length
  });
  write(JSON.stringify(summary));
  return summary;
}

if(require.main===module){
  runPreflight().catch(error=>{
    console.error(error.message);
    process.exitCode=1;
  });
}

module.exports=Object.freeze({runPreflight});
