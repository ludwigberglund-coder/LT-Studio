'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Supabase logout clears browser auth state before remote revocation',()=>{
  const source=read('apps/portal/supabase-session.js');
  const start=source.indexOf("async function signOut(scope='global')");
  const end=source.indexOf('async function context()',start);
  assert.ok(start>=0&&end>start,'signOut helper saknas');
  const body=source.slice(start,end);
  const clearSession=body.indexOf('write(null)');
  const clearCompany=body.indexOf('localStorage.removeItem(COMPANY_KEY)');
  const remote=body.indexOf("await api().signOut(t,scope)");
  assert.ok(clearSession>=0&&clearCompany>=0&&remote>=0,'förväntade logout-steg saknas');
  assert.ok(clearSession<remote,'sessionslagringen måste rensas före nätverksanropet');
  assert.ok(clearCompany<remote,'företagsvalet måste rensas före nätverksanropet');
});

test('shared portal guard revalidates auth after BFCache restore and hides stale content',()=>{
  const source=read('apps/portal/portal-nav.js');
  assert.match(source,/addEventListener\('pagehide',\(\)=>\{authRevalidationShield\(\);\}\)/);
  assert.match(source,/addEventListener\('pageshow',event=>\{[^}]*enforceSupabaseSession\(\{fromBfcache:Boolean\(event\.persisted\)\}\)/s);
  assert.match(source,/function authRevalidationShield\(\)/);
  assert.match(source,/authenticated=context\?\.authenticated===true/);
  assert.match(source,/if\(authenticated\)return true/);
  assert.match(source,/location\.replace\(portalLoginUrl\(\)\)/);
  assert.match(source,/if\(fromBfcache\)location\.reload\(\)/);
});

test('shared Supabase logout replaces history entry instead of pushing a stale protected page',()=>{
  const source=read('apps/portal/portal-nav.js');
  const logoutStart=source.indexOf("logout.addEventListener('click'");
  const logoutEnd=source.indexOf('menu.append(logout)',logoutStart);
  assert.ok(logoutStart>=0&&logoutEnd>logoutStart,'logout handler saknas');
  const body=source.slice(logoutStart,logoutEnd);
  assert.match(body,/await root\.LTSupabaseUat\.signOut\('global'\)/);
  assert.match(body,/location\.replace\(portalLoginUrl\(\)\)/);
  assert.doesNotMatch(body,/location\.href\s*=/);
});
