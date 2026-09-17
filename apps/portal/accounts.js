const app=document.getElementById('accounts-app');
const Demo=globalThis.RollandsDemoScenario,Invoice=globalThis.RollandsInvoice;
const isDemo=location.hostname.endsWith('github.io')||new URLSearchParams(location.search).has('demo');
let base=[],message='';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function revenue(){return Invoice.revenueAccounts(isDemo?Demo.state().invoiceRevenueAccounts||[]:[]);}
function render(){
  const map=new Map(base.map(r=>[r.number,r]));for(const r of revenue())map.set(r.number,{...r,group:'Intäkter',revenue:true});
  const rows=[...map.values()].sort((a,b)=>a.number.localeCompare(b.number));
  app.innerHTML=`<div class="portal"><aside class="sidebar"></aside><section class="main"><header class="topbar"><div><h1>Kontoplan & intäktskonton</h1><p>Ekonomi / Kontoinställningar</p></div></header><main class="content invoice-workspace"><div class="demo-banner">Detta är demots konfigurerade konton, inte en verifierad fullständig BAS-kontoplan. Konto och momssats väljs separat på varje fakturarad.</div><div class="invoice-toolbar"><div><h2>Välj hur intäkten bokförs</h2><p>Intäktskontot sparas på fakturan och används i dess verifikation. En ändring här skriver inte om redan bokförda fakturor.</p></div><a class="button" href="./invoices.html${isDemo?'?demo=1':''}">Öppna fakturaverktyget</a></div>${message?`<div class="invoice-alert" role="alert">${esc(message)}</div>`:''}${isDemo?`<section class="invoice-preview-card accounts-edit"><h3>Lägg till eget intäktskonto</h3><form id="account-form" class="invoice-grid"><label>Kontonummer *<input name="number" inputmode="numeric" pattern="(3[0-9]{3}|83[0-9]{2})" maxlength="4" required placeholder="Exempel: 3099"></label><label>Kontonamn *<input name="name" maxlength="120" required placeholder="Namn på er intäkt"></label><div class="wide"><button class="button" type="submit">Spara intäktskonto</button></div></form><p class="invoice-help">Fyra siffror i klass 3 eller 83. 3740 är reserverat för öresutjämning. Det nya kontot blir tillgängligt direkt i samma webbläsares fakturaverktyg.</p></section>`:''}<section class="invoice-preview-card"><h3>Konton i systemet</h3><div class="table-scroll"><table class="accounts-table"><thead><tr><th>Konto</th><th>Benämning</th><th>Användning</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.number)}</b></td><td>${esc(r.name)}</td><td>${r.revenue?'Valbart intäktskonto':esc(r.group||'Ekonomi')}</td></tr>`).join('')}</tbody></table></div></section></main></section></div>`;
}
document.addEventListener('submit',event=>{
  if(event.target.id!=='account-form'||!isDemo)return;event.preventDefault();
  try{
    const fd=new FormData(event.target),row={number:String(fd.get('number')).trim(),name:String(fd.get('name')).trim()};
    Invoice.revenueAccounts([row]);
    if(revenue().some(a=>a.number===row.number)&&!confirm('Kontot finns redan. Ändra visningsnamnet för framtida fakturor?'))return;
    Demo.patch(state=>{state.invoiceRevenueAccounts=[...(state.invoiceRevenueAccounts||[]).filter(a=>a.number!==row.number),row];});
    message=`${row.number} ${row.name} är sparat och kan väljas i fakturaverktyget.`;render();
  }catch(error){message=error.message;render();}
});
async function boot(){const r=await fetch('../config/accounting-accounts.json');if(!r.ok)throw new Error('Kontoplanen kunde inte hämtas.');base=(await r.json()).accounts||[];render();}
boot().catch(error=>{message=error.message;render();});
