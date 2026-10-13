/* Book-close trial balance UI: read-only, authenticated, never a final approval. */
(function(root){
'use strict';
const doc=root.document;
const byId=id=>doc.getElementById(id);
const form=byId('tb-form'),start=byId('tb-start'),end=byId('tb-end'),button=byId('tb-run'),
  status=byId('tb-message'),app=byId('tb-app'),loading=byId('tb-loading'),
  results=byId('tb-results'),rows=byId('tb-rows'),search=byId('tb-search');
if(!form||!start||!end||!button||!status||!app||!loading||!results||!rows||!search)return;
let revision=0,activeCompany='',accountRows=[];
const fmtOre=value=>{
  const n=BigInt(value),minus=n<0n?'-':'',digits=(n<0n?-n:n).toString().padStart(3,'0');
  const whole=digits.slice(0,-2).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
  return minus+whole+','+digits.slice(-2)+' kr';
};
function setMessage(message){status.textContent=message;}
function clear(){
  revision++;accountRows=[];results.hidden=true;rows.replaceChildren();
  search.value='';button.disabled=false;
}
function filtered(){
  rows.replaceChildren();
  const query=search.value.trim().toLocaleLowerCase('sv-SE');
  const matching=accountRows.filter(row=>row.account.toLocaleLowerCase('sv-SE').includes(query));
  const fragment=doc.createDocumentFragment();
  for(const row of matching){
    const tr=doc.createElement('tr');
    const values=[row.account,row.prior_net_ore,row.period_debit_ore,row.period_credit_ore,row.period_net_ore,row.through_end_net_ore];
    values.forEach((v,index)=>{
      const cell=doc.createElement(index===0?'th':'td');
      if(index===0)cell.scope='row';
      cell.textContent=index===0?v:fmtOre(v);
      tr.appendChild(cell);
    });
    fragment.appendChild(tr);
  }
  rows.appendChild(fragment);
  byId('tb-table-count').textContent=matching.length+' av '+accountRows.length+' konton visas.';
}
const plusDay=day=>{
  const date=new Date(day+'T00:00:00Z');
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==day)throw Error('Felaktigt slutdatum.');
  date.setUTCDate(date.getUTCDate()+1);
  return date.toISOString().slice(0,10);
};
const setDefaults=()=>{
  const year=new Date().getFullYear();
  start.value=(year-1)+'-01-01';end.value=(year-1)+'-12-31';
};
search.addEventListener('input',filtered);
[start,end].forEach(el=>el.addEventListener('input',()=>{clear();setMessage('Perioden ändrades. Hämta saldobalansen igen.');}));
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const ticket=++revision;
  results.hidden=true;rows.replaceChildren();accountRows=[];button.disabled=true;
  setMessage('Hämtar konton och beräknar saldobalans…');
  const originalStart=start.value,originalEnd=end.value;
  try{
    const exclusiveEnd=plusDay(originalEnd);
    root.LTBookCloseTrialBalance.bounds(originalStart,exclusiveEnd);
    const first=await root.LTSupabaseUat.context();
    if(!first?.authenticated||!first.company?.id||!first.accessToken)throw Error('Sessionen behöver förnyas.');
    const result=await root.LTBookCloseTrialBalance.inspect({
      companyId:first.company.id,token:first.accessToken,start:originalStart,end:exclusiveEnd,client:root.LTSupabase
    });
    const now=await root.LTSupabaseUat.context();
    if(ticket!==revision||!now?.authenticated||now.company?.id!==first.company.id||
      activeCompany!==first.company.id||start.value!==originalStart||end.value!==originalEnd)
      return;
    accountRows=result.accounts;
    byId('tb-accounts-count').textContent=result.counts.account_count;
    byId('tb-debit').textContent=fmtOre(result.totals.period_debit_ore);
    byId('tb-credit').textContent=fmtOre(result.totals.period_credit_ore);
    const diff=BigInt(result.totals.period_debit_ore)-BigInt(result.totals.period_credit_ore);
    byId('tb-difference').textContent=fmtOre(diff.toString());
    byId('tb-difference-note').textContent=diff===0n?'Kontrollsumman balanserar, men bokslutet är ej avstämt.':'Skillnaden måste granskas.';
    const warnings=[];
    if(diff!==0n)warnings.push('Debet och kredit skiljer sig. Undersök verifikationerna.');
    if(BigInt(result.counts.invalid_lines)>0n)warnings.push('Ogiltiga kontorader behöver granskas.');
    warnings.push('Ingående balans och externa underlag är inte verifierade.');
    byId('tb-warning').textContent=warnings.join(' ');
    byId('tb-period-caption').textContent=originalStart+' till '+originalEnd+' · Belopp i kronor.';
    search.value='';filtered();results.hidden=false;
    setMessage('Saldobalansen hämtad för '+originalStart+' till '+originalEnd+'. Den är inte godkänd eller avstämd.');
  }catch(error){
    if(ticket!==revision)return;
    results.hidden=true;accountRows=[];rows.replaceChildren();
    setMessage('Saldobalansen kunde inte hämtas. '+String(error?.message||'Kontrollera datum och inloggning.')+' Ingen data har godkänts.');
  }finally{if(ticket===revision)button.disabled=false;}
});
async function init(){
  setDefaults();
  if(new URLSearchParams(root.location?.search||'').get('demo')==='1'){
    button.disabled=true;byId('tb-company').textContent='Demoläge – ingen företagsdata läses.';
    setMessage('Logga in i ett testföretag för att hämta en riktig saldobalans.');
    app.hidden=false;loading.hidden=true;return;
  }
  try{
    if(!root.LTSupabaseUat||!root.LTSupabase||!root.LTBookCloseTrialBalance)throw Error('Inloggning saknas.');
    const ctx=await root.LTSupabaseUat.context();
    if(!ctx?.authenticated||!ctx.company?.id||!ctx.accessToken){root.location.replace('./index.html');return;}
    activeCompany=ctx.company.id;
    byId('tb-company').textContent='Företag: '+String(ctx.company.name||'Aktivt företag');
    app.hidden=false;loading.hidden=true;
  }catch{root.location.replace('./index.html');}
}
init();
})(globalThis);
