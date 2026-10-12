'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../apps/portal/supabase-client.js'),'utf8');
function client(response){
  const requests=[];
  const window={LT_SUPABASE:{url:'https://synthetic.supabase.invalid',publishableKey:'synthetic-public-key'}};
  vm.runInNewContext(code,{window,fetch:async(url,options)=>{
    requests.push({url,options});
    return {
      ok:response.ok??true,status:response.status??206,
      text:async()=>response.body??'[]',
      headers:{get:key=>key.toLowerCase()==='content-range'?(response.range??null):null}
    };
  },Date,URL,URLSearchParams,setTimeout,clearTimeout,setInterval,clearInterval});
  return {supabase:window.LTSupabase,requests};
}
test('exakt antal läses från Content-Range, med företagfilter och personlig token',async()=>{
  const {supabase,requests}=client({range:'0-0/1234'});
  const count=await supabase.from('journal_entries','synthetic-session').countExact('company_id=eq.company-a&posting_date=gte.2026-10-01&posting_date=lt.2026-11-01');
  assert.equal(count,1234);
  assert.equal(requests.length,1);
  assert.match(requests[0].url,/journal_entries\?select=id/);
  assert.match(requests[0].url,/company_id=eq.company-a/);
  assert.match(requests[0].url,/limit=1/);
  assert.equal(requests[0].options.headers.Authorization,'Bearer synthetic-session');
  assert.equal(requests[0].options.headers.Prefer,'count=exact');
});
test('tom tabell rapporterar exakt noll, inte okänd siffra',async()=>{
  assert.equal(await client({range:'*/0'}).supabase.from('journal_lines','token').countExact('company_id=eq.company-a'),0);
});
test('saknad eller ungefärlig Count-header avvisas hellre än att ge klarsignal',async()=>{
  for(const range of [null,'0-0/*','0-0/NaN','0-0/999999999999999999999999999']){
    const {supabase}=client({range});
    await assert.rejects(supabase.from('journal_entries','token').countExact('company_id=eq.company-a'),/exakt antal poster/);
  }
});
test('åtkomstfel vid antalskontroll respekteras',async()=>{
  const {supabase}=client({ok:false,status:403,body:'{"message":"RLS denied"}'});
  await assert.rejects(supabase.from('journal_entries','token').countExact('company_id=eq.company-a'),/RLS denied/);
});
