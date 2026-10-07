'use strict';

const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const app=read('apps/operator/app.js');
const styles=read('apps/operator/styles.css');
const onboarding=read('supabase/functions/operator-admin/company-onboarding.ts');
const activate=read('supabase/functions/company-activate/index.ts');

assert.match(app,/Lägg till kundföretag/);
assert.match(app,/companyOnboardingPanel/);
assert.match(app,/MFA återstår/);
assert.match(app,/Plattformsoperatörer/);
assert.match(app,/Adminmetadata/);
assert.match(app,/inte automatiskt läsa kundföretagets ekonomiska data/i);
assert.doesNotMatch(app,/Övergripande global åtkomst/);
assert.match(app,/operatorUiPrefsKey/);
assert.match(app,/data-ui-motion/);
assert.match(app,/data-ui-compact/);

assert.match(styles,/onboarding-modal-card/);
assert.match(styles,/onboarding-security/);
assert.match(styles,/activation-delivery/);

assert.match(onboarding,/operator_create_company_onboarding/);
assert.match(onboarding,/swedishOrgNumberOk/);
assert.match(onboarding,/sha256Hex/);
assert.match(onboarding,/confirmed!==true/);

assert.match(activate,/MFA_REQUIRED/);
assert.match(activate,/INVITED_EMAIL_MISMATCH/);
assert.match(activate,/PASSWORD_COMPROMISED/);
assert.match(activate,/api\.pwnedpasswords\.com\/range\//);

console.log('Operator onboarding UI/security contract passed.');
