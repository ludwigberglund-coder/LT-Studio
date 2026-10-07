'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('ny kundadmin kan inte använda företagsmedlemskapet utan verifierad AAL2-session',()=>{
  const claim=read('supabase/migrations/20261007152200_claim_company_activation.sql');
  const guard=read('supabase/migrations/20260926152441_personal_session_server_guard.sql');
  const activation=read('supabase/functions/company-activate/index.ts');

  // Onboarding creates the company membership before the new user has enrolled MFA.
  assert.match(claim,/insert into public\.company_memberships/i);

  // The database boundary must therefore remain fail-closed until the JWT is AAL2.
  assert.match(guard,/auth\.jwt\(\)->>'aal'/i);
  assert.match(guard,/<> 'aal2'/i);
  assert.match(guard,/as restrictive for all to authenticated/i);
  assert.match(guard,/private\.lt_personal_session_allowed\(\)/i);

  // The activation response and portal still explicitly require MFA enrollment.
  assert.match(activation,/requireMfa:true/);
});

test('befintligt konto måste vara AAL2 innan aktiverings-RPC kan skapa medlemskap',()=>{
  const activation=read('supabase/functions/company-activate/index.ts');

  assert.match(activation,/action==="claim-existing"/);
  assert.match(activation,/jwtPayload\(token\)\.aal!=="aal2"/);
  assert.match(activation,/MFA_REQUIRED/);
  assert.match(activation,/auth\.getUser\(token\)/);
  assert.match(activation,/INVITED_EMAIL_MISMATCH/);
});

test('aktiveringshemligheten exponeras inte som browserläsbar Supabase-data',()=>{
  const invites=read('supabase/migrations/20261007152000_company_activation_invites.sql');
  const onboarding=read('supabase/functions/operator-admin/company-onboarding.ts');

  assert.match(invites,/alter table public\.company_activation_invites enable row level security/i);
  assert.match(invites,/revoke all on public\.company_activation_invites from public,anon,authenticated/i);
  assert.match(invites,/using\(false\)/i);
  assert.match(invites,/with check\(false\)/i);

  assert.match(onboarding,/sha256Hex\(inviteCode\)/);
  assert.match(onboarding,/p_code_sha256:codeHash/);
  assert.doesNotMatch(invites,/inviteCode/);
});

test('AAL2-databasspärren installeras före produktions-onboardingens nya migrationer',()=>{
  const guardMigration=20260926152441;
  const onboardingMigrations=[
    20261007152000,
    20261007152100,
    20261007152200,
    20261007152300
  ];
  for(const migration of onboardingMigrations){
    assert.ok(migration>guardMigration,'onboarding får inte flyttas före den globala AAL2-spärren utan ny säkerhetsgranskning');
  }
});


test('endast en oanvänd aktiveringslänk kan vara giltig per företag även vid samtidiga rotationer',()=>{
  const hardening=read('supabase/migrations/20261007152400_single_active_company_activation.sql');

  assert.match(hardening,/create unique index if not exists company_activation_invites_single_active_per_company/i);
  assert.match(hardening,/on public\.company_activation_invites\(company_id\)/i);
  assert.match(hardening,/where claimed_at is null and revoked_at is null/i);
});


test('LT Studio-operatören blir inte automatiskt medlem i kundföretaget',()=>{
  const create=read('supabase/migrations/20261007152100_operator_create_company_onboarding.sql');

  assert.match(create,/insert into public\.companies/i);
  assert.match(create,/insert into public\.company_invoice_settings/i);
  assert.match(create,/insert into public\.company_activation_invites/i);
  assert.doesNotMatch(create,/insert into public\.company_memberships/i);
});

test('driftadmin hämtar bara ekonomisk metadata och inte kundernas eller fakturornas innehåll',()=>{
  const operator=read('supabase/functions/operator-admin/index.ts');

  // Översikten får räkna poster men ska inte hämta ekonomiska detaljfält.
  assert.match(operator,/from\("customers"\)\.select\("id,company_id,created_at"\)/);
  assert.match(operator,/from\("invoices"\)\.select\("id,company_id,created_at"\)/);

  // Företagsdetaljen får bara använda ID:n för statistik.
  assert.match(operator,/from\("customers"\)\.select\("id"\)\.eq\("company_id",companyId\)/);
  assert.match(operator,/from\("invoices"\)\.select\("id"\)\.eq\("company_id",companyId\)/);

  // Ingen operatörsväg ska returnera fulla kund- eller fakturarader.
  assert.doesNotMatch(operator,/from\("customers"\)\.select\("\*"\)/);
  assert.doesNotMatch(operator,/from\("invoices"\)\.select\("\*"\)/);
});

test('aktiveringsinbjudningar publiceras inte till kundportalens realtime-kanal',()=>{
  const realtime=read('supabase/migrations/20260926164726_shared_uat_realtime_completion.sql');

  assert.doesNotMatch(realtime,/['"]company_activation_invites['"]/);
});


test('aktiveringslänken transporterar hemligheten i URL-fragment och rensar adressfältet direkt',()=>{
  const operator=read('apps/operator/app.js');
  const activation=read('apps/portal/company-activate.js');

  assert.match(operator,/url\.hash='code='/);
  assert.doesNotMatch(operator,/searchParams\.set\(['"]code['"]/);
  assert.match(activation,/location\.hash/);
  assert.match(activation,/history\.replaceState\(null,'',location\.pathname\+location\.search\)/);
});

test('aktiveringssidan laddar endast lokala script och styles',()=>{
  const html=read('apps/portal/company-activate.html');

  const externalScript=/<script[^>]+src=["']https?:\/\//i;
  const externalStyle=/<link[^>]+href=["']https?:\/\//i;
  const externalForm=/<form[^>]+action=["']https?:\/\//i;

  assert.doesNotMatch(html,externalScript);
  assert.doesNotMatch(html,externalStyle);
  assert.doesNotMatch(html,externalForm);
  assert.match(html,/src="\.\/supabase-config\.js"/);
  assert.match(html,/src="\.\/company-activate\.js"/);
});

test('aktiveringskod och lösenord är maskerade och undantas från autocomplete',()=>{
  const html=read('apps/portal/company-activate.html');

  assert.match(html,/name="inviteCode" type="password"[^>]+autocomplete="off"/);
  assert.match(html,/name="password" type="password"[^>]+autocomplete="new-password"/);
  assert.match(html,/autocomplete="current-password"/);
});


test('rollbyte gäller omedelbart via company_memberships utan att skapa parallell behörighetskälla',()=>{
  const operator=read('supabase/functions/operator-admin/index.ts');
  const tenant=read('supabase/migrations/20260925055322_optimize_shared_rls_indexes.sql');

  assert.match(operator,/from\("company_memberships"\)\.update\(\{role\}\)/);
  assert.match(tenant,/m\.role in \('admin','accountant'\)/);
  assert.doesNotMatch(operator,/user_metadata.*role/i);
});

test('borttaget medlemskap är företagsspecifikt och tar inte bort användarens andra medlemskap',()=>{
  const operator=read('supabase/functions/operator-admin/index.ts');

  assert.match(operator,/from\("company_memberships"\)\.delete\(\)\.eq\("company_id",companyId\)\.eq\("auth_user_id",target\)/);
  assert.doesNotMatch(operator,/auth\.admin\.deleteUser\(target\)/);
  assert.match(operator,/sessionScope:"company"/);
});

test('portalens företagsval kan bara välja bland medlemskap som RLS returnerar',()=>{
  const session=read('apps/portal/supabase-session.js');

  assert.match(session,/from\('company_memberships',t\)\.select\('\*','auth_user_id=eq\.'/);
  assert.match(session,/const allowed=new Set\(\(memberships\|\|\[\]\)\.map\(m=>String\(m\.company_id\)\)\)/);
  assert.match(session,/if\(!allowed\.has\(companyId\)\)companyId=visible\[0\]\?\.id\|\|''/);
});
