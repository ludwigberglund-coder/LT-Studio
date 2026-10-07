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
