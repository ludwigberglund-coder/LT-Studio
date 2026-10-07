'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('operatorportalen kan skapa ett isolerat UAT-företag genom skyddad Edge Function',()=>{
  const app=read('apps/operator/app.js');
  const edge=read('supabase/functions/operator-admin/index.ts');

  assert.match(app,/data-action="create-company"/);
  assert.match(app,/id="create-company-form"/);
  assert.match(app,/mutate\('\/companies',\{method:'POST'/);
  assert.match(app,/action:'create-company'/);

  assert.match(edge,/claims\.aal!=="aal2"/);
  assert.match(edge,/from\("platform_operators"\)/);
  assert.match(edge,/if\(action==="create-company"\)/);
  assert.match(edge,/companyId="uat_"\+crypto\.randomUUID/);
  assert.match(edge,/from\("companies"\)\.insert/);
  assert.match(edge,/from\("uat_bootstrap_invites"\)\.insert/);
  assert.match(edge,/membership_role:"admin"/);
  assert.match(edge,/grant_operator:false/);
});

test('första företagsadmin använder engångskod vars klartext inte sparas',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');
  const bootstrap=read('supabase/functions/uat-bootstrap/index.ts');

  assert.match(edge,/randomInviteCode\(\)/);
  assert.match(edge,/sha256Hex\(inviteCode\)/);
  assert.match(edge,/code_sha256:codeHash/);
  assert.doesNotMatch(edge,/code_sha256:inviteCode/);
  assert.match(edge,/activation:\{inviteCode,expiresAt/);

  assert.match(bootstrap,/sha256Hex\(inviteCode\)/);
  assert.match(bootstrap,/eq\("code_sha256",codeHash\)/);
  assert.match(bootstrap,/membership_role/);
  assert.match(bootstrap,/company_id:invite\.company_id/);
});

test('UAT-företag kräver tydlig testidentitet och syntetiskt organisationsnummer',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');
  assert.match(edge,/UAT_NAME_REQUIRED/);
  assert.match(edge,/\^000\[0-9\]\{3\}-\[0-9\]\{4\}\$/);
  assert.match(edge,/COMPANY_ORG_NUMBER_EXISTS/);
  assert.match(edge,/UAT_COMPANY_CREATED/);
});


test('nya UAT-företag får ofarliga fakturainställningar direkt',()=>{
  const edge=read('supabase/functions/operator-admin/index.ts');
  assert.match(edge,/from\("company_invoice_settings"\)\.insert/);
  assert.match(edge,/bankgiro:"EJ-BETALNING"/);
  assert.match(edge,/example\.invalid/);
  assert.match(edge,/tax_status:"UAT – EJ SKARP \/ EJ F-SKATT"/);
  assert.match(edge,/vat_number:"SE"\+orgDigits\+"01"/);
  assert.doesNotMatch(edge,/bankgiro:"[0-9]{3,}-[0-9]{3,}"/);
});
