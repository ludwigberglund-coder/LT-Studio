'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./private-workflows-fixture.cjs');

async function run(fn){
  const f=await fixture();
  try{await fn(f)}finally{await f.close()}
}

test('andra kundens privata portal får rätt företagsidentitet från sessionen',()=>run(async f=>{
  const headers=await f.login(f.other.username);
  const response=await fetch(f.base+'/api/v1/session',{headers});
  assert.equal(response.status,200);
  const session=await response.json();
  assert.equal(session.authenticated,true);
  assert.equal(session.companyId,f.b.id);
  assert.equal(session.company.id,f.b.id);
  assert.equal(session.company.name,f.b.displayName);
  assert.equal(session.company.legalName,f.b.legalName);
  assert.doesNotMatch(JSON.stringify(session.company),/Rolands|Rollands|556406-5059/i);
}));

test('andra kundens fakturaprofil hämtas från dess egen företagsmiljö',()=>run(async f=>{
  const headers=await f.login(f.other.username);
  const response=await fetch(f.base+'/api/v1/customer-invoices/config',{headers});
  assert.equal(response.status,200);
  const config=await response.json();
  assert.equal(config.company.legalName,f.b.legalName);
  assert.equal(config.company.displayName,f.b.displayName);
  assert.equal(config.company.orgNumber,f.b.orgNumber);
  assert.equal(config.issuanceReady,false);
  assert.doesNotMatch(JSON.stringify(config.company),/Rolands|Rollands|556406-5059/i);
}));

test('ny kund får neutral CMS-startpunkt utan Rolands innehåll',()=>run(async f=>{
  const headers=await f.login(f.other.username);
  const response=await fetch(f.base+'/api/v1/website/cms',{headers});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.state.companyId,f.b.id);
  assert.equal(data.state.draft.company.legalName,f.b.legalName);
  assert.equal(data.state.draft.company.displayName,f.b.displayName);
  assert.equal(data.state.draft.company.orgNumber,f.b.orgNumber);
  assert.match(data.state.published.site.meta.title,new RegExp(f.b.displayName));
  assert.doesNotMatch(JSON.stringify(data.state),/Rolands|Rollands|556406-5059|Billdal/i);
}));


test('privata portalskal har ingen hårdkodad Rolands-identitet för kund nummer två',()=>{
  const portal=path.join(__dirname,'..','apps','portal');
  const files=fs.readdirSync(portal).filter(name=>/\.(?:html|js)$/.test(name));
  const forbidden=[
    /<strong>Rollands<\/strong>/,
    /Rollands \/ (?:Ekonomi|Försäljning|Administration)/,
    /Rollands plattform/,
    /website:company\.website\|\|'https:\/\/rollands\.se'/
  ];
  for(const name of files){
    const source=fs.readFileSync(path.join(portal,name),'utf8');
    for(const pattern of forbidden)assert.doesNotMatch(source,pattern,name+' får inte använda Rolands som privat plattformsstandard');
  }
});
