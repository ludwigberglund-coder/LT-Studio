const app=document.getElementById('inventory-app');
const isDemo=new URLSearchParams(location.search).get('demo')==='1';
const isSupabase=location.hostname.endsWith('github.io')&&!isDemo;
const csrfToken=sessionStorage.getItem('rollands-csrf')||'';
let session=null,items=[],movements=[],adjustments=[],selectedId='',message='',supabaseCtx=null;
let movementRequestId='',adjustmentRequestId='',movementInFlight=false,adjustmentInFlight=false;

const demoItems=[
  {id:'item-apple',sku:'APPLE-SE',name:'Svenska äpplen',unit:'kg',purchaseAccount:'4010',inventoryAccount:'1460',quantityMilli:18500,active:true},
  {id:'item-tomato',sku:'TOMATO',name:'Tomater',unit:'kg',purchaseAccount:'4010',inventoryAccount:'1460',quantityMilli:12250,active:true},
  {id:'item-box',sku:'BOX-L',name:'Papperskasse stor',unit:'st',purchaseAccount:'5460',inventoryAccount:'1460',quantityMilli:42000,active:true}
];
let demoMovements=[
  {id:'m1',itemId:'item-apple',movementDate:'2026-09-16',type:'receipt',quantityMilli:25000,note:'Morgonleverans'},
  {id:'m2',itemId:'item-apple',movementDate:'2026-09-16',type:'sale',quantityMilli:-5750,note:'Försäljning'},
  {id:'m3',itemId:'item-apple',movementDate:'2026-09-16',type:'waste',quantityMilli:-750,note:'Skadat i låda'}
];
let demoAdjustments=[];
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function supabaseContext(){supabaseCtx=supabaseCtx?.authenticated?supabaseCtx:await window.LTSupabaseUat.context();if(!supabaseCtx?.authenticated||!supabaseCtx.company){location.href='./index.html';throw new Error('Ingen aktiv Supabase-session.')}return supabaseCtx}
async function loadSupabaseInventory(){
  const ctx=await supabaseContext(),filter='company_id=eq.'+encodeURIComponent(ctx.company.id);
  const [itemRows,movementRows,adjustmentRows]=await Promise.all([
    window.LTSupabase.from('inventory_items',ctx.accessToken).select('*',filter+'&order=name.asc,sku.asc'),
    window.LTSupabase.from('inventory_movements',ctx.accessToken).select('*',filter+'&order=movement_date.desc,created_at.desc'),
    window.LTSupabase.from('inventory_adjustments',ctx.accessToken).select('*',filter+'&order=created_at.desc')
  ]);
  movements=(movementRows||[]).map(r=>({id:r.id,itemId:r.item_id,movementDate:r.movement_date,type:r.type,quantityMilli:Number(r.quantity_milli||0),unitCostOre:r.unit_cost_ore==null?null:Number(r.unit_cost_ore),referenceType:r.reference_type||'',referenceId:r.reference_id||'',note:r.note||'',actorId:r.actor_id,createdAt:r.created_at}));
  const balances=new Map();for(const m of movements)balances.set(String(m.itemId),(balances.get(String(m.itemId))||0)+Number(m.quantityMilli||0));
  items=(itemRows||[]).map(r=>({id:r.id,sku:r.sku,name:r.name,unit:r.unit,purchaseAccount:r.purchase_account,inventoryAccount:r.inventory_account,active:Boolean(r.active),quantityMilli:balances.get(String(r.id))||0,createdAt:r.created_at,updatedAt:r.updated_at}));
  const itemMap=new Map(items.map(i=>[String(i.id),i]));
  adjustments=(adjustmentRows||[]).map(r=>({id:r.id,itemId:r.item_id,adjustmentDate:r.adjustment_date,currentQuantityMilli:Number(r.current_quantity_milli||0),countedQuantityMilli:Number(r.counted_quantity_milli||0),differenceMilli:Number(r.difference_milli||0),reason:r.reason,status:r.status,countedBy:r.counted_by,approvedBy:r.approved_by,rejectedBy:r.rejected_by,createdAt:r.created_at,name:itemMap.get(String(r.item_id))?.name||'',unit:itemMap.get(String(r.item_id))?.unit||''}));
  if(!items.some(i=>i.id===selectedId))selectedId=items[0]?.id||'';
  session={user:ctx.user,company:ctx.company};
}
function today(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function qty(value,unit){const n=Number(value||0)/1000;return `${new Intl.NumberFormat('sv-SE',{maximumFractionDigits:3}).format(n)} ${unit}`}
function parseQty(value){const raw=String(value||'').trim().replace(/\s/g,'').replace(',','.');const n=Number(raw);if(!Number.isFinite(n)||n<0)throw new Error('Kvantiteten är ogiltig.');const milli=Math.round(n*1000);if(!Number.isSafeInteger(milli))throw new Error('Kvantiteten är för stor.');return milli}
function newRequestId(prefix){return `${prefix}-${crypto.randomUUID()}`}
async function api(path,options={}){const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};if(options.method&&options.method!=='GET'&&csrfToken)headers['X-CSRF-Token']=csrfToken;const r=await fetch(`/api/v1${path}`,{credentials:'same-origin',...options,headers,body:options.body?JSON.stringify(options.body):undefined});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Begäran misslyckades.');return data}
function selected(){return items.find(i=>i.id===selectedId)||items[0]||null}
function sidebar(){const suffix=isDemo?'?demo=1':'';return `<aside class="sidebar inventory-nav"><div class="logo"><strong>${esc(isDemo?'Rollands':session?.company?.name||'Företaget')}</strong><small>LT STUDIO</small></div><div class="company-pill">${esc(session?.company?.name||(isDemo?'Rollands Frukt o Grönt AB':'Företaget'))}<br>${isDemo?'Demoföretag':'Personlig session'}</div><div class="side-group"><span>Arbetsyta</span><a class="side-link" href="./dashboard.html${suffix}">Översikt</a></div><div class="side-group"><span>Ekonomi</span><a class="side-link" href="./payables.html${suffix}">Leverantörsfakturor</a><a class="side-link" href="./bank.html${suffix}">Bank & avstämning</a><a class="side-link" href="./suppliers.html${suffix}">Leverantörer</a><a class="side-link active" href="./inventory.html${suffix}">Lager</a><a class="side-link" href="./automation.html${suffix}">Automationskö</a></div><div class="sidebar-footer">Saldo i tusendelar · svinn och inventering spåras separat.</div></aside>`}
function summary(){const total=items.length;const low=items.filter(i=>Number(i.quantityMilli)<5000).length;const waste=Math.abs(movements.filter(m=>m.type==='waste'&&m.movementDate===today()).reduce((s,m)=>s+Number(m.quantityMilli),0));const pending=adjustments.filter(a=>a.status==='pending').length;return `<section class="inventory-summary"><article><span>Aktiva artiklar</span><strong>${total}</strong></article><article><span>Lågt saldo</span><strong>${low}</strong></article><article><span>Svinn idag</span><strong>${new Intl.NumberFormat('sv-SE',{maximumFractionDigits:3}).format(waste/1000)}</strong></article><article><span>Väntar godkännande</span><strong>${pending}</strong></article></section>`}
function itemTable(){return `<section class="inventory-panel"><div class="inventory-head"><div><span class="eyebrow">Artikelregister</span><h2>Lagerartiklar</h2></div></div><div style="overflow:auto"><table class="inventory-table"><thead><tr><th>Artikel</th><th>Namn</th><th>Enhet</th><th>Saldo</th><th>Lagerkonto</th></tr></thead><tbody>${items.map(i=>`<tr data-item-id="${esc(i.id)}" class="${selected()?.id===i.id?'selected':''}"><td><b>${esc(i.sku)}</b></td><td>${esc(i.name)}</td><td>${esc(i.unit)}</td><td class="qty">${qty(i.quantityMilli,i.unit)}</td><td>${esc(i.inventoryAccount)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">Inga artiklar.</td></tr>'}</tbody></table></div></section>`}
function workPanel(){const item=selected();if(!item)return `<section class="inventory-panel"><div class="inventory-head"><div><span class="eyebrow">Artikelregister</span><h3>Skapa första lagerartikeln</h3></div></div><form class="inventory-form" data-form="item"><div class="two"><label class="field"><span>Artikelnummer</span><input name="sku" maxlength="60" required placeholder="APPLE-SE"></label><label class="field"><span>Namn</span><input name="name" maxlength="160" required placeholder="Svenska äpplen"></label></div><div class="two"><label class="field"><span>Enhet</span><select name="unit"><option value="st">st</option><option value="kg">kg</option><option value="l">l</option></select></label><label class="field"><span>Inköpskonto</span><input name="purchaseAccount" value="4010" pattern="[0-9]{4}" maxlength="4" required></label></div><label class="field"><span>Lagerkonto</span><input name="inventoryAccount" value="1460" pattern="[0-9]{4}" maxlength="4" required></label><div class="inventory-actions"><button class="button" type="submit">Skapa artikel</button></div></form></section>`;return `<section class="inventory-panel"><div class="inventory-head"><div><span class="eyebrow">${esc(item.sku)}</span><h3>${esc(item.name)}</h3></div><strong>${qty(item.quantityMilli,item.unit)}</strong></div><form class="inventory-form" data-form="movement"><div class="two"><label class="field"><span>Typ</span><select name="type"><option value="receipt">Inleverans</option><option value="sale">Försäljning</option><option value="waste">Svinn</option></select></label><label class="field"><span>Datum</span><input type="date" name="date" value="${today()}" required></label></div><label class="field"><span>Kvantitet (${esc(item.unit)})</span><input name="quantity" inputmode="decimal" required placeholder="1,000"></label><label class="field"><span>Kommentar</span><input name="note" maxlength="500" placeholder="Exempel: skadat, leverans 123"></label><div class="inventory-actions"><button class="button" type="submit">Registrera rörelse</button></div></form><form class="inventory-form" data-form="count"><div class="notice inventory-note"><b>Inventering:</b> räknat saldo skapar en väntande justering. En annan behörig person måste godkänna den.</div><div class="two"><label class="field"><span>Räknat saldo (${esc(item.unit)})</span><input name="counted" inputmode="decimal" required></label><label class="field"><span>Datum</span><input type="date" name="date" value="${today()}" required></label></div><label class="field"><span>Orsak</span><input name="reason" maxlength="500" value="Inventering"></label><div class="inventory-actions"><button class="button ghost" type="submit">Skapa inventeringsdifferens</button></div></form></section>`}
function movementsPanel(){const item=selected();const rows=movements.filter(m=>!item||m.itemId===item.id).slice(0,10);const labels={receipt:'Inleverans',sale:'Försäljning',waste:'Svinn',adjustment:'Justering'};return `<section class="inventory-panel" style="margin-top:18px"><div class="inventory-head"><div><span class="eyebrow">Spårbarhet</span><h3>Senaste lagerrörelser</h3></div></div><div class="movement-list">${rows.map(m=>`<div class="movement-row"><span class="movement-type ${esc(m.type)}">${labels[m.type]||esc(m.type)}</span><span>${esc(m.movementDate)}<br><small>${esc(m.note||'')}</small></span><strong>${m.quantityMilli>0?'+':''}${qty(m.quantityMilli,item?.unit||'')}</strong><span>${esc(m.referenceType||'')}</span></div>`).join('')||'<p class="empty">Inga lagerrörelser ännu.</p>'}</div></section>`}
function adjustmentsPanel(){return `<section class="inventory-panel" style="margin-top:18px"><div class="inventory-head"><div><span class="eyebrow">Fyrögonsprincip</span><h3>Inventeringsjusteringar</h3></div></div><div class="adjustment-list">${adjustments.map(a=>`<div class="adjustment-row"><span class="adjustment-status ${esc(a.status)}">${a.status==='pending'?'Väntar':a.status==='approved'?'Godkänd':'Avvisad'}</span><span><b>${esc(a.name||items.find(i=>i.id===a.itemId)?.name||'Artikel')}</b><br><small>${esc(a.adjustmentDate)}</small></span><strong>${a.differenceMilli>0?'+':''}${qty(a.differenceMilli,a.unit||items.find(i=>i.id===a.itemId)?.unit||'')}</strong><div class="adjustment-actions">${a.status==='pending'?`<button class="button small" data-action="approve" data-id="${esc(a.id)}">Godkänn</button><button class="button ghost small" data-action="reject" data-id="${esc(a.id)}">Avvisa</button>`:'—'}</div></div>`).join('')||'<p class="empty">Inga inventeringsjusteringar.</p>'}</div></section>`}
function render(){app.innerHTML=`<div class="inventory-shell">${sidebar()}<section class="inventory-main"><header class="topbar"><div><h1>Lager</h1><p>Artiklar · saldo · svinn · inventering</p></div><div class="user-chip"><b>${esc(session?.user?.displayName||'Demoanvändare')}</b></div></header><main class="content">${isDemo?'<div class="demo-banner"><b>GitHub Pages-demo.</b> Lagerdata här är exempeldata.</div>':''}${message?`<div class="notice">${esc(message)}</div>`:''}${summary()}<div class="inventory-grid">${itemTable()}${workPanel()}</div>${movementsPanel()}${adjustmentsPanel()}</main></section></div>`}
async function load(){if(isDemo){session={user:{displayName:'Demo Lager'}};items=structuredClone(demoItems);movements=structuredClone(demoMovements);adjustments=structuredClone(demoAdjustments);selectedId=items[0].id;render();return}if(isSupabase){await loadSupabaseInventory();render();return}const s=await api('/session');if(!s.authenticated){location.href='./index.html';return}session=s;items=(await api('/inventory/items')).items||[];movements=(await api('/inventory/movements')).movements||[];adjustments=(await api('/inventory/adjustments?status=all')).adjustments||[];selectedId=items[0]?.id||'';render()}
function recalcDemo(){for(const item of items)item.quantityMilli=demoMovements.filter(m=>m.itemId===item.id).reduce((s,m)=>s+Number(m.quantityMilli||0),0)}
document.addEventListener('click',async e=>{const row=e.target.closest('[data-item-id]');if(row){selectedId=row.dataset.itemId;render();return}const b=e.target.closest('[data-action]');if(!b)return;try{if(isDemo){const a=adjustments.find(x=>x.id===b.dataset.id);if(!a)throw new Error('Justeringen hittades inte.');if(b.dataset.action==='approve'){a.status='approved';demoMovements.unshift({id:`m-${Date.now()}`,itemId:a.itemId,movementDate:a.adjustmentDate,type:'adjustment',quantityMilli:a.differenceMilli,note:a.reason,referenceType:'inventory-adjustment'});recalcDemo();message='Lagerjusteringen godkändes i demon.'}else{a.status='rejected';message='Lagerjusteringen avvisades i demon.'}}else if(isSupabase){const ctx=await supabaseContext();await window.LTSupabase.rpc('decide_inventory_adjustment',{p_company_id:ctx.company.id,p_adjustment_id:b.dataset.id,p_decision:b.dataset.action},ctx.accessToken);message=b.dataset.action==='approve'?'Lagerjusteringen godkändes i Supabase.':'Lagerjusteringen avvisades i Supabase.';await loadSupabaseInventory()}else{await api(`/inventory/adjustments/${encodeURIComponent(b.dataset.id)}/${b.dataset.action}`,{method:'POST',body:{}});message=b.dataset.action==='approve'?'Lagerjusteringen godkändes.':'Lagerjusteringen avvisades.';items=(await api('/inventory/items')).items||[];movements=(await api('/inventory/movements')).movements||[];adjustments=(await api('/inventory/adjustments?status=all')).adjustments||[]}render()}catch(err){message=err.message;render()}});
document.addEventListener('input',e=>{
  const form=e.target.closest('[data-form]');if(!form)return;
  if(form.dataset.form==='movement'&&!movementInFlight)movementRequestId='';
  if(form.dataset.form==='count'&&!adjustmentInFlight)adjustmentRequestId='';
});
document.addEventListener('submit',async e=>{
  const form=e.target;if(!form.matches('[data-form]'))return;e.preventDefault();
  const kind=form.dataset.form;
  if(kind==='movement'&&movementInFlight)return;
  if(kind==='count'&&adjustmentInFlight)return;
  if(kind==='movement')movementInFlight=true;else if(kind==='count')adjustmentInFlight=true;
  try{
    const data=new FormData(form);
    if(kind==='item'){
      if(isDemo)throw new Error('Skapa artiklar testas i Supabase-UAT.');
      if(isSupabase){const ctx=await supabaseContext();const created=(await window.LTSupabase.rpc('create_inventory_item',{p_company_id:ctx.company.id,p_sku:String(data.get('sku')||''),p_name:String(data.get('name')||''),p_unit:String(data.get('unit')||'st'),p_purchase_account:String(data.get('purchaseAccount')||'4010'),p_inventory_account:String(data.get('inventoryAccount')||'1460')},ctx.accessToken))?.[0];if(!created)throw new Error('Lagerartikeln kunde inte skapas.');await loadSupabaseInventory();selectedId=created.item_id;message=created.duplicate?'Artikeln fanns redan och öppnades.':'Lagerartikeln skapades.';render();return}
      throw new Error('Artikelregistrering görs via det befintliga serverflödet utanför Supabase-UAT.');
    }
    const item=selected();if(!item)throw new Error('Välj en artikel.');
    if(kind==='movement'){
      const type=String(data.get('type')),q=parseQty(data.get('quantity')),signed=type==='receipt'?q:-q;
      if(isDemo){
        demoMovements.unshift({id:`m-${Date.now()}`,itemId:item.id,movementDate:String(data.get('date')),type,quantityMilli:signed,note:String(data.get('note')||'')});
        recalcDemo();message='Lagerrörelsen registrerades i demon.';
      }else if(isSupabase){
        const ctx=await supabaseContext();movementRequestId=movementRequestId||newRequestId('inventory-movement');
        await window.LTSupabase.rpc('add_inventory_movement',{p_company_id:ctx.company.id,p_request_id:movementRequestId,p_item_id:item.id,p_movement_date:String(data.get('date')),p_type:type,p_quantity_milli:signed,p_note:String(data.get('note')||'')},ctx.accessToken);
        movementRequestId='';await loadSupabaseInventory();message='Lagerrörelsen registrerades i Supabase.';
      }else{
        movementRequestId=movementRequestId||newRequestId('inventory-movement');
        await api('/inventory/movements',{method:'POST',body:{requestId:movementRequestId,itemId:item.id,movementDate:String(data.get('date')),type,quantityMilli:signed,note:String(data.get('note')||'')}});
        movementRequestId='';
        items=(await api('/inventory/items')).items||[];
        movements=(await api('/inventory/movements')).movements||[];
        message='Lagerrörelsen registrerades.';
      }
    }else{
      const counted=parseQty(data.get('counted'));
      if(isDemo){
        const current=item.quantityMilli,difference=counted-current;if(!difference)throw new Error('Ingen inventeringsdifferens finns.');
        adjustments.unshift({id:`adj-${Date.now()}`,itemId:item.id,name:item.name,unit:item.unit,adjustmentDate:String(data.get('date')),currentQuantityMilli:current,countedQuantityMilli:counted,differenceMilli:difference,reason:String(data.get('reason')||'Inventering'),status:'pending'});
        message='Inventeringsdifferensen väntar nu på en annan persons godkännande.';
      }else if(isSupabase){
        const ctx=await supabaseContext();adjustmentRequestId=adjustmentRequestId||newRequestId('inventory-adjustment');
        await window.LTSupabase.rpc('create_inventory_adjustment',{p_company_id:ctx.company.id,p_request_id:adjustmentRequestId,p_item_id:item.id,p_adjustment_date:String(data.get('date')),p_counted_quantity_milli:counted,p_reason:String(data.get('reason')||'Inventering')},ctx.accessToken);
        adjustmentRequestId='';await loadSupabaseInventory();message='Inventeringsdifferensen skapades och väntar på en annan persons godkännande.';
      }else{
        adjustmentRequestId=adjustmentRequestId||newRequestId('inventory-adjustment');
        await api('/inventory/adjustments',{method:'POST',body:{requestId:adjustmentRequestId,itemId:item.id,adjustmentDate:String(data.get('date')),countedQuantityMilli:counted,reason:String(data.get('reason')||'Inventering')}});
        adjustmentRequestId='';
        adjustments=(await api('/inventory/adjustments?status=all')).adjustments||[];
        message='Inventeringsdifferensen skapades och väntar på godkännande.';
      }
    }
    render();
  }catch(err){message=err.message;render()}
  finally{if(kind==='movement')movementInFlight=false;else if(kind==='count')adjustmentInFlight=false}
});
load().catch(err=>{app.innerHTML=`<main class="boot"><strong>Kunde inte ladda lager</strong><span>${esc(err.message)}</span></main>`});
