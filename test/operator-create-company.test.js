'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('operatorportalen onboardar riktiga kundföretag utan UAT-begränsningar',()=>{
  const app=read('apps/operator/app.js');
  const edge=read('supabase/functions/operator-admin/index.ts');
  const onboarding=read('supabase/functions/operator-admin/company-onboarding.ts');

  assert.match(app,/Lägg till kundföretag/);
  assert.match(app,/id="create-company-form"/);
  assert.match(app,/name="orgNumber"/);
  assert.match(app,/name="vatNumber"/);
  assert.match(app,/name="adminEmail"/);
  assert.match(app,/Skapa kundföretag säkert/);
  assert.doesNotMatch(app,/Skapa UAT-företag/);

  assert.match(edge,/claims\.aal!=="aal2"/);
  assert.match(edge,/from\("platform_operators"\)/);
  assert.match(edge,/createCompanyOnboarding/);
  assert.match(onboarding,/operator_create_company_onboarding/);
  assert.match(onboarding,/swedishOrgNumberOk/);
  assert.match(onboarding,/COMPANY_ORG_NUMBER_EXISTS/);
  assert.doesNotMatch(onboarding,/UAT_NAME_REQUIRED/);
  assert.doesNotMatch(onboarding,/companyId="uat_"/);
});

test('företagsskapandet är atomiskt och aktiveringen lagrar bara hash',()=>{
  const migration=read('supabase/migrations/20261007152100_operator_create_company_onboarding.sql');
  const inviteMigration=read('supabase/migrations/20261007152000_company_activation_invites.sql');
  const onboarding=read('supabase/functions/operator-admin/company-onboarding.ts');

  assert.match(migration,/insert into public\.companies/);
  assert.match(migration,/insert into public\.company_invoice_settings/);
  assert.match(migration,/insert into public\.company_activation_invites/);
  assert.match(migration,/CUSTOMER_COMPANY_CREATED/);
  assert.match(inviteMigration,/code_sha256 text not null unique/);
  assert.match(inviteMigration,/recipient_email text not null/);
  assert.match(inviteMigration,/revoke all on public\.company_activation_invites from public,anon,authenticated/);
  assert.match(onboarding,/sha256Hex\(inviteCode\)/);
  assert.match(onboarding,/p_code_sha256:codeHash/);
  assert.doesNotMatch(migration,/inviteCode/);
});

test('första kundadmin får företagsroll men aldrig LT Studio-operatörsroll',()=>{
  const claim=read('supabase/migrations/20261007152200_claim_company_activation.sql');
  const activate=read('supabase/functions/company-activate/index.ts');

  assert.match(claim,/insert into public\.company_memberships/);
  assert.match(claim,/v_invite\.membership_role/);
  assert.doesNotMatch(claim,/insert into public\.platform_operators/);
  assert.doesNotMatch(activate,/platform_operators.*insert/);
});

test('aktivering är bunden till inbjuden e-post och befintligt konto kräver AAL2',()=>{
  const activate=read('supabase/functions/company-activate/index.ts');
  const claim=read('supabase/migrations/20261007152200_claim_company_activation.sql');

  assert.match(activate,/recipient_email/);
  assert.match(activate,/INVITED_EMAIL_MISMATCH/);
  assert.match(activate,/jwtPayload\(token\)\.aal!=="aal2"/);
  assert.match(claim,/lower\(v_invite\.recipient_email\)<>v_email/);
  assert.match(claim,/for update/);
});

test('kundens lösenord väljs av kunden och MFA är obligatorisk i portalen',()=>{
  const activatePage=read('apps/portal/company-activate.html');
  const activateJs=read('apps/portal/company-activate.js');
  const config=read('apps/portal/supabase-config.js');
  const session=read('apps/portal/supabase-session.js');

  assert.match(activatePage,/Nytt lösenord/);
  assert.match(activatePage,/Obligatorisk MFA/);
  assert.match(activateJs,/mfaEnroll/);
  assert.match(activateJs,/mfaVerify/);
  assert.match(activateJs,/history\.replaceState/);
  assert.match(config,/requireMfa:\s*true/);
  assert.match(session,/requireMfa!==false/);
});

test('aktiverings-RPC:er kan inte anropas direkt av browserroller',()=>{
  const create=read('supabase/migrations/20261007152100_operator_create_company_onboarding.sql');
  const claim=read('supabase/migrations/20261007152200_claim_company_activation.sql');
  const reissue=read('supabase/migrations/20261007152300_reissue_company_activation.sql');

  for(const source of [create,claim,reissue]){
    assert.match(source,/revoke all on function/);
    assert.match(source,/from public,anon,authenticated/);
    assert.match(source,/to service_role/);
    assert.match(source,/security invoker/);
  }
});

test('operatören kan rotera en oanvänd aktiveringslänk utan att skapa om företaget',()=>{
  const app=read('apps/operator/app.js');
  const reissue=read('supabase/migrations/20261007152300_reissue_company_activation.sql');

  assert.match(app,/reissue-company-activation/);
  assert.match(app,/Ny aktiveringslänk/);
  assert.match(reissue,/set revoked_at=now\(\)/);
  assert.match(reissue,/COMPANY_ALREADY_ACTIVATED/);
  assert.match(reissue,/CUSTOMER_ACTIVATION_REISSUED/);
});


test('företaget blir inte aktivt förrän första admin har verifierad MFA',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');
  const app=read('apps/operator/app.js');

  assert.match(edge,/mfaProtectedAdmins\.length>0\?"active"/);
  assert.match(edge,/"mfa_pending"/);
  assert.match(edge,/accessConfigured:mfaProtectedAdmins\.length>0/);
  assert.match(app,/MFA återstår/);
  assert.match(app,/Kontot är skapat – MFA återstår/);
  assert.match(app,/AAL2 krävs/);
});

test('databastransaktionen validerar svenska bolagsuppgifter även utan Edge Function',()=>{
  const migration=read('supabase/migrations/20261007152100_operator_create_company_onboarding.sql');

  assert.match(migration,/v_luhn_sum/);
  assert.match(migration,/SE'\|\|v_org_digits\|\|'01/);
  assert.match(migration,/\^https:\/\//);
  assert.match(migration,/\^\[0-9\]\{3,4\}-\[0-9\]\{4\}\$/);
  assert.match(migration,/Godkänd för F-skatt/);
  assert.match(migration,/Godkänd för FA-skatt/);
});
