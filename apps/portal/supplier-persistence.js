'use strict';
// Supabase writes are auditable in the database trigger, never in a second
// browser request. No AI, approval, payment or bookkeeping calls exist here.
(function(root){
  const fail=code=>Object.assign(new Error(code),{code});
  function scope(ctx){
    if(!ctx?.authenticated||!ctx.company?.id||!ctx.authUser?.id||!ctx.accessToken||
       typeof ctx.membership?.role!=='string'||!ctx.membership.role)throw fail('SUPPLIER_ACCESS_DENIED');
    return {companyId:String(ctx.company.id),userId:String(ctx.authUser.id),role:ctx.membership.role};
  }
  function assertScope(expected,ctx){
    const actual=scope(ctx);
    if(!expected||actual.companyId!==expected.companyId||actual.userId!==expected.userId||actual.role!==expected.role)
      throw fail('SUPPLIER_CONTEXT_CHANGED');
    return ctx;
  }
  function record(row){
    return {id:row.id,companyId:row.company_id,supplierNumber:row.supplier_number,name:row.name,
      orgNumber:row.org_number||'',countryCode:row.country_code||'',email:row.email||'',
      defaultCostAccount:row.default_cost_account||'',bankgiro:row.bankgiro||'',plusgiro:row.plusgiro||'',
      rowVersion:Number(row.row_version),lastChangeRequestId:row.last_change_request_id||''};
  }
  function values(payload,kind){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw fail('INVALID_SUPPLIER_INPUT');
    const fields=kind==='payment'?{bankgiro:40,plusgiro:40}:
      kind==='profile'?{name:160,orgNumber:40,countryCode:2,email:254,defaultCostAccount:4}:
      kind==='create'?{supplierNumber:40,name:160,orgNumber:40,countryCode:2,email:254,defaultCostAccount:4,bankgiro:40,plusgiro:40}:null;
    if(!fields||Object.keys(payload).some(key=>!Object.hasOwn(fields,key)))throw fail('INVALID_SUPPLIER_INPUT');
    const names={supplierNumber:'supplier_number',orgNumber:'org_number',countryCode:'country_code',defaultCostAccount:'default_cost_account'};
    const result={};
    for(const [key,max] of Object.entries(fields)){
      const v=payload[key]??'';
      if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw fail('INVALID_SUPPLIER_INPUT');
      const text=v.trim();
      if(['name','supplierNumber'].includes(key)&&!text)throw fail('INVALID_SUPPLIER_INPUT');
      if(key==='defaultCostAccount'&&text&&!/^\d{4}$/.test(text))throw fail('INVALID_SUPPLIER_INPUT');
      if(key==='countryCode'&&text&&!/^[A-Z]{2}$/.test(text))throw fail('INVALID_SUPPLIER_INPUT');
      result[names[key]||key]=text||null;
    }
    return result;
  }
  function alreadyApplied(row,operation){
    return row&&row.id===operation.id&&row.company_id===operation.scope.companyId&&
      row.last_change_request_id===operation.requestId&&
      Number(row.row_version)===(operation.create?1:operation.version+1)&&
      Object.entries(operation.values).every(([key,value])=>row[key]===value);
  }
  function operation({context,supplier,payload,kind,id,requestId}){
    const bound=scope(context),create=kind==='create';
    if(!['admin','accountant'].includes(bound.role))throw fail('SUPPLIER_ACCESS_DENIED');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId||''))
      throw fail('INVALID_SUPPLIER_REQUEST');
    if(!create&&(!supplier?.id||supplier.companyId!==bound.companyId||
        !Number.isSafeInteger(supplier.rowVersion)||supplier.rowVersion<1))throw fail('SUPPLIER_VERSION_CONFLICT');
    const target=create?id:supplier.id;
    if(typeof target!=='string'||!target||target.length>100)throw fail('INVALID_SUPPLIER_REQUEST');
    return Object.freeze({id:target,requestId,scope:Object.freeze(bound),create,
      version:create?0:supplier.rowVersion,values:Object.freeze(values(payload,kind))});
  }
  async function save({client,getContext,operation:op}){
    if(!op||!client||typeof getContext!=='function')throw fail('INVALID_SUPPLIER_REQUEST');
    const filters='company_id=eq.'+encodeURIComponent(op.scope.companyId)+'&id=eq.'+encodeURIComponent(op.id);
    let ctx=assertScope(op.scope,await getContext());
    if(!['admin','accountant'].includes(ctx.membership.role))throw fail('SUPPLIER_ACCESS_DENIED');
    const existing=await client.from('suppliers',ctx.accessToken).select('*',filters+'&limit=2');
    ctx=assertScope(op.scope,await getContext());
    if(!Array.isArray(existing)||existing.length>1||existing.some(row=>row.company_id!==op.scope.companyId||row.id!==op.id))
      throw fail('SUPPLIER_CONTEXT_CHANGED');
    if(alreadyApplied(existing[0],op))return record(existing[0]);
    if(op.create&&existing.length)throw fail('SUPPLIER_REQUEST_CONFLICT');
    if(!op.create&&(existing.length!==1||Number(existing[0].row_version)!==op.version))
      throw fail('SUPPLIER_VERSION_CONFLICT');
    const changes={...op.values,row_version:op.version+1,last_change_request_id:op.requestId};
    let rows;
    try{
      rows=op.create?await client.from('suppliers',ctx.accessToken).insert([{...changes,id:op.id,company_id:op.scope.companyId}]):
        await client.from('suppliers',ctx.accessToken).update(changes,filters+'&row_version=eq.'+op.version);
    }catch(error){
      // The network may fail AFTER a successful commit. Read back this exact
      // request; never issue a blind second mutation or reuse another supplier.
      ctx=assertScope(op.scope,await getContext());
      const confirmed=await client.from('suppliers',ctx.accessToken).select('*',filters+'&limit=2');
      assertScope(op.scope,await getContext());
      if(Array.isArray(confirmed)&&confirmed.length===1&&alreadyApplied(confirmed[0],op))return record(confirmed[0]);
      throw error;
    }
    assertScope(op.scope,await getContext());
    if(!Array.isArray(rows)||rows.length!==1||!alreadyApplied(rows[0],op))throw fail('SUPPLIER_VERSION_CONFLICT');
    return record(rows[0]);
  }
  function errorMessage(error){
    const text=String(error?.message||'');
    if(/CONTEXT_CHANGED|ACCESS_DENIED|AUTH_REQUIRED/.test(text))return 'Företag eller behörighet ändrades. Ladda om innan du fortsätter.';
    if(/VERSION_CONFLICT|REQUEST_CONFLICT|REQUEST_ALREADY_APPLIED/.test(text))return 'Leverantören har ändrats. Ladda om och granska aktuella uppgifter. Dina ändringar skrevs inte över en nyare version.';
    if(/IDENTITY_ALREADY_EXISTS|suppliers_country_identity|suppliers_company_id_supplier_number/.test(text))return 'Leverantören eller leverantörsnumret finns redan. Välj den befintliga posten och kontrollera identiteten.';
    if(/INVALID_SUPPLIER/.test(text))return 'Kontrollera namn, leverantörsnummer, landskod och övriga uppgifter.';
    return 'Ändringen kunde inte bekräftas. Behåll formuläret och försök igen; samma försök skapar inte en ny leverantör.';
  }
  const api=Object.freeze({scope,assertScope,record,values,operation,save,errorMessage});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.LTStudioSupplierPersistence=api;
})(typeof window!=='undefined'?window:null);
