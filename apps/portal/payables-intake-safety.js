'use strict';
(function(root){
  const fail=code=>Object.assign(new Error(code),{code});
  const normalizeName=v=>String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('sv-SE');
  function text(value,max,required=false){
    if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw fail('INVALID_INTAKE_INPUT');
    const v=value.trim();if(required&&!v)throw fail('INVALID_INTAKE_INPUT');return v;
  }
  function amount(value,allowZero=false){
    const v=text(value,30,true).replace(/\s/g,'').replace(',','.');
    if(!/^\d+(?:\.\d{1,2})?$/.test(v))throw fail('INVALID_INTAKE_AMOUNT');
    const [whole,decimal='']=v.split('.');const result=Number(whole)*100+Number((decimal+'00').slice(0,2));
    if(!Number.isSafeInteger(result)||result>99999999999||result<0||(!allowZero&&!result))throw fail('INVALID_INTAKE_AMOUNT');
    return result;
  }
  function date(value){
    if(typeof value!=='string'||!/^(?:19|20)\d{2}-\d{2}-\d{2}$/.test(value))throw fail('INVALID_INTAKE_DATE');
    const d=new Date(value+'T00:00:00Z');
    if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw fail('INVALID_INTAKE_DATE');return value;
  }
  function validate(input){
    const allowed=['supplierId','supplierNumber','supplierName','orgNumber','bankgiro','defaultCostAccount','supplierInvoiceNumber','invoiceDate','dueDate','totalAmount','vatAmount','vatTreatment'];
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw fail('INVALID_INTAKE_INPUT');
    if(input.vatTreatment!=='se-domestic-full-input-vat')throw fail('UNSUPPORTED_INTAKE_VAT');
    const totalOre=amount(input.totalAmount),vatOre=amount(input.vatAmount,true);
    if(vatOre>=totalOre)throw fail('INVALID_INTAKE_AMOUNT');
    const invoiceDate=date(input.invoiceDate),dueDate=date(input.dueDate);
    if(dueDate<invoiceDate)throw fail('INVALID_INTAKE_DATE');
    const supplierId=text(input.supplierId,100,true);
    let supplier=null;
    if(supplierId==='__new__'){
      supplier={supplierNumber:text(input.supplierNumber,40,true),name:text(input.supplierName,160,true),
        orgNumber:text(input.orgNumber||'',40),bankgiro:text(input.bankgiro||'',40),defaultCostAccount:text(input.defaultCostAccount||'',4)};
      if(supplier.defaultCostAccount&&!/^\d{4}$/.test(supplier.defaultCostAccount))throw fail('INVALID_INTAKE_INPUT');
      Object.freeze(supplier);
    }
    return Object.freeze({supplierId,supplier,supplierInvoiceNumber:text(input.supplierInvoiceNumber,100,true),invoiceDate,dueDate,totalOre,vatOre,vatTreatment:input.vatTreatment});
  }
  async function hash(bytes){const b=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  async function id(value){const h=await hash(new TextEncoder().encode(value));return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
  async function prepare({input,file,context,store,pdf,pdfLibrary}){
    const validated=validate(input),scope=store.scope(context);
    if(!['admin','accountant'].includes(scope.role))throw fail('SUPPLIER_ACCESS_DENIED');
    if(!file||typeof file.arrayBuffer!=='function'||file.size>10485760||file.size<32||
       (file.type&&file.type!=='application/pdf'))throw fail('INVALID_INTAKE_PDF');
    const bytes=new Uint8Array(await file.arrayBuffer());
    await pdf.assertSafePdfDeep(bytes,{fileName:file.name},pdfLibrary);
    const sha256=await hash(bytes);
    const invoiceId=await id(JSON.stringify(['supplier-intake-v1',scope.companyId,sha256]));
    const supplierId=validated.supplier?await id(JSON.stringify(['supplier-create-v1',scope.companyId,validated.supplier.supplierNumber])):validated.supplierId;
    const supplierOperation=validated.supplier?store.operation({context,kind:'create',id:supplierId,payload:validated.supplier,
      requestId:await id(JSON.stringify(['supplier-create-request-v1',scope.companyId,scope.userId,validated.supplier]))}):null;
    return Object.freeze({scope:Object.freeze(scope),input:validated,supplierId,supplierOperation,invoiceId,
      documentId:await id('supplier-document-v1:'+invoiceId),sha256,
      path:scope.companyId+'/supplier-invoices/'+invoiceId+'/original.pdf',fileName:file.name,size:bytes.length,
      file:new Blob([bytes],{type:'application/pdf'})});
  }
  function expectedInvoice(op){return {id:op.invoiceId,company_id:op.scope.companyId,supplier_id:op.supplierId,
    supplier_invoice_number:op.input.supplierInvoiceNumber,invoice_date:op.input.invoiceDate,due_date:op.input.dueDate,
    total_ore:op.input.totalOre,vat_ore:op.input.vatOre,pdf_sha256:op.sha256,currency:'SEK',vat_treatment:op.input.vatTreatment};}
  function sameInvoice(row,op){return row&&Object.entries(expectedInvoice(op)).every(([key,value])=>
    key.endsWith('_ore')?Number(row[key])===value:row[key]===value);}
  function sameDocument(row,op){return row&&row.company_id===op.scope.companyId&&row.source_id===op.invoiceId&&
    row.source_type==='supplier-invoice'&&row.object_path===op.path&&row.sha256===op.sha256&&
    row.mime_type==='application/pdf'&&Number(row.size_bytes)===op.size;}
  async function save({operation:op,client,store,getContext,onStage=()=>{}}){
    let stage='validation';
    const context=async()=>store.assertScope(op.scope,await getContext());
    const filter='company_id=eq.'+encodeURIComponent(op.scope.companyId);
    const originals=async()=>{
      const ctx=await context();
      const rows=await client.from('documents',ctx.accessToken).select('*',filter+'&source_type=eq.supplier-invoice&source_id=eq.'+encodeURIComponent(op.invoiceId)+'&limit=2');
      await context();
      if(!Array.isArray(rows)||rows.length>1||rows.some(row=>!sameDocument(row,op)))throw fail('INTAKE_DOCUMENT_CONFLICT');
      return rows;
    };
    try{
      let ctx=await context();
      const rows=await client.from('supplier_invoices',ctx.accessToken).select('*',filter+'&or=(id.eq.'+op.invoiceId+',pdf_sha256.eq.'+op.sha256+')&limit=2');
      await context();
      if(!Array.isArray(rows)||rows.length>1||rows.some(row=>!sameInvoice(row,op)))throw fail('INTAKE_DUPLICATE_OR_CHANGED');
      let invoice=rows[0]||null;
      if(invoice){
        if((await originals()).length===1)return {invoiceId:invoice.id,resumed:true};
        if(!['registered','coding-review'].includes(invoice.status)||invoice.approved_by||invoice.approved_at||invoice.liability_accounting_entry_id)
          throw fail('INTAKE_LOCKED');
      }
      // Upload a passive original BEFORE creating any supplier. Never overwrite
      // storage. An ambiguous timeout/conflict is resolved by a byte-hash read.
      stage='original';onStage(stage);ctx=await context();
      try{await client.storage.upload('lt-documents',op.path,op.file,ctx.accessToken);}
      catch(error){
        ctx=await context();const stored=await client.storage.download('lt-documents',op.path,ctx.accessToken);
        if(stored.size!==op.size||await hash(await stored.arrayBuffer())!==op.sha256)throw fail('INTAKE_DOCUMENT_CONFLICT');
      }
      await context();
      stage='supplier';onStage(stage);ctx=await context();
      if(op.supplierOperation&&!invoice)await store.save({client,getContext,operation:op.supplierOperation});
      else{
        const suppliers=await client.from('suppliers',ctx.accessToken).select('*',filter+'&id=eq.'+encodeURIComponent(op.supplierId)+'&limit=2');
        if(!Array.isArray(suppliers)||suppliers.length!==1||suppliers[0].id!==op.supplierId||
          suppliers[0].company_id!==op.scope.companyId||suppliers[0].archived_at)throw fail('INTAKE_SUPPLIER_REQUIRED');
      }
      await context();
      if(!invoice){
        stage='invoice';onStage(stage);ctx=await context();
        const payload={...expectedInvoice(op),posting_date:op.input.invoiceDate,remaining_ore:op.input.totalOre,status:'registered',registered_by:op.scope.userId};
        try{
          const saved=await client.from('supplier_invoices',ctx.accessToken).insert([payload]);
          if(!Array.isArray(saved)||saved.length!==1||!sameInvoice(saved[0],op))throw fail('INTAKE_DUPLICATE_OR_CHANGED');
          invoice=saved[0];
        }catch(error){
          ctx=await context();const saved=await client.from('supplier_invoices',ctx.accessToken).select('*',filter+'&id=eq.'+op.invoiceId+'&limit=2');
          if(!Array.isArray(saved)||saved.length!==1||!sameInvoice(saved[0],op))throw error;
          invoice=saved[0];
        }
        await context();
      }
      stage='document';onStage(stage);
      if(!(await originals()).length){
        ctx=await context();
        try{await client.from('documents',ctx.accessToken).insert([{
          id:op.documentId,company_id:op.scope.companyId,object_path:op.path,file_name:op.fileName,mime_type:'application/pdf',
          size_bytes:op.size,sha256:op.sha256,source_type:'supplier-invoice',source_id:op.invoiceId,uploaded_by:op.scope.userId,
          title:'Leverantörsfaktura '+op.input.supplierInvoiceNumber,category:'supplier-invoice',note:''
        }]);}catch(error){if(!(await originals()).length)throw error;}
      }
      if((await originals()).length!==1)throw fail('INTAKE_DOCUMENT_CONFLICT');
      await context();return {invoiceId:op.invoiceId,resumed:Boolean(rows.length)};
    }catch(error){error.intakeStage=stage;throw error;}
  }
  function prefill(extraction,suppliers=[]){
    if(extraction?.source!=='local-pdf-text'||extraction.status!=='needs-review'||extraction.posted!==false)throw fail('INVALID_INTAKE_EXTRACTION');
    const fields=extraction.fields||{},values={};
    for(const [source,target] of [['reference','supplierInvoiceNumber'],['invoiceDate','invoiceDate'],['dueDate','dueDate']])
      if(fields[source]?.verified===false&&typeof fields[source].value==='string')values[target]=fields[source].value;
    for(const [source,target] of [['grossOre','totalAmount'],['vatOre','vatAmount']])
      if(fields[source]?.verified===false&&Number.isSafeInteger(fields[source].value)&&fields[source].value>=0)
        values[target]=(fields[source].value/100).toFixed(2).replace('.',',');
    const name=fields.supplier?.verified===false?fields.supplier.value:'';
    const matches=typeof name==='string'?suppliers.filter(s=>normalizeName(s.name)===normalizeName(name)):[];
    return {values,supplierName:typeof name==='string'?name:'',possibleSupplierId:matches.length===1?matches[0].id:null,
      blocked:Boolean(extraction.checks?.creditNote||extraction.checks?.negativeSummary||extraction.checks?.mixedVatRates||
        extraction.warnings?.some(w=>/utländsk valuta|motstridiga/i.test(w)))};
  }
  function message(error){
    const code=String(error?.code||error?.message||'');
    if(/CONTEXT_CHANGED|ACCESS_DENIED|AUTH_REQUIRED/.test(code))return 'Företag eller behörighet ändrades. Registreringen har avbrutits för denna vy. Ladda om i rätt företag.';
    if(/INVALID_INTAKE_AMOUNT/.test(code))return 'Kontrollera beloppen. Moms ska vara lägre än totalbeloppet och belopp får ha högst två decimaler.';
    if(/INVALID_INTAKE_DATE/.test(code))return 'Kontrollera giltiga datum. Förfallodatum får inte vara tidigare än fakturadatum.';
    if(/UNSUPPORTED_INTAKE_VAT/.test(code))return 'Välj verifierad momsbehandling. Detta momsfall kräver manuell hantering utanför det här flödet.';
    if(/INVALID_INTAKE_INPUT|SUPPLIER_REQUIRED/.test(code))return 'Välj leverantör och fyll i fakturanummer, datum och leverantörsuppgifter.';
    if(/DUPLICATE|CONFLICT|23505|IDENTITY_ALREADY_EXISTS|supplier_invoices_.*uidx|suppliers_.*key/.test(code))return 'Uppgifterna krockar med en befintlig leverantör, faktura eller ett original. Kontrollera befintlig post; skapa inte en kopia.';
    if(/PDF|DOCUMENT_TOO/.test(code))return 'PDF-originalet kunde inte säkerhetskontrolleras. Använd en giltig, passiv PDF på högst 10 MB.';
    return 'Registreringen är inte färdigbekräftad. Behåll samma uppgifter och försök igen. Redan sparade steg återanvänds; inget attesteras eller bokförs.';
  }
  const api=Object.freeze({validate,prepare,save,prefill,message,hash});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.LTStudioIntakeSafety=api;
})(typeof window!=='undefined'?window:null);
