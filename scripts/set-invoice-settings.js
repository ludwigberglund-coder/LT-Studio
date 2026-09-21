'use strict';

const path=require('node:path');
const fs=require('node:fs');
const Access=require('../packages/access-control/authorization.js');
const Auth=require('../apps/api/auth.js');
const Db=require('../apps/api/database.js');
const Settings=require('../apps/api/company-invoice-settings.js');

function requiredEnv(name){const value=String(process.env[name]||'').trim();if(!value)throw new Error(`${name} måste anges.`);return value}
function assertOutsideRepository(root,filename){
  const resolved=path.resolve(filename),relative=path.relative(root,resolved);
  if(!relative||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw new Error('ROLLANDS_DATABASE_PATH måste ligga utanför repositoryt i pilot/produktion.');
  return resolved;
}
function updateInvoiceSettings(db,{orgNumber,username,bankgiro,taxStatus,vatNumber,accessConfig}){
  const companyRow=db.prepare('SELECT id FROM companies WHERE org_number=?').get(orgNumber);
  if(!companyRow)throw new Error('Företaget finns inte i databasen.');
  const company=Db.companyById(db,companyRow.id);
  const user=Db.userByUsername(db,Auth.normalizeUsername(username));
  if(!user)throw new Error('Användarkontot finns inte.');
  const membership=Db.membership(db,company.id,user.id);
  if(!membership)throw new Error('Användarkontot saknar åtkomst till företaget.');
  const model=Access.createModel(accessConfig);
  const decision=Access.authorize(model,{id:user.id,name:user.displayName,companyId:company.id,authenticated:true,membershipActive:true,disabled:Boolean(user.disabled)},'platform.settings.manage');
  if(!decision.allowed)throw new Error('Kontot saknar behörighet att ändra företagets fakturainställningar.');
  let settings;
  Db.transaction(db,()=>{
    settings=Settings.setInvoiceSettings(db,{companyId:company.id,bankgiro,taxStatus,vatNumber,updatedBy:user.id});
    Db.appendAudit(db,{companyId:company.id,userId:user.id,action:'COMPANY_INVOICE_SETTINGS_UPDATED',entityType:'company',entityId:company.id,details:{bankgiroConfigured:true,taxStatusConfigured:true,vatNumberConfigured:true}});
  });
  return{company,settings};
}
function main(){
  if(!process.argv.includes('--apply')){console.log('Ingen ändring gjord. Kör med --apply när de verifierade fakturauppgifterna är kontrollerade.');process.exitCode=2;return;}
  const root=path.resolve(__dirname,'..');
  const databasePath=assertOutsideRepository(root,requiredEnv('ROLLANDS_DATABASE_PATH'));
  const accessConfig=JSON.parse(fs.readFileSync(path.join(root,'config','access-control.json'),'utf8'));
  const db=Db.openDatabase(databasePath);
  try{
    const result=updateInvoiceSettings(db,{
      orgNumber:requiredEnv('ROLLANDS_INVOICE_SETTINGS_COMPANY_ORG_NUMBER'),
      username:requiredEnv('ROLLANDS_INVOICE_SETTINGS_USERNAME'),
      bankgiro:requiredEnv('ROLLANDS_INVOICE_BANKGIRO'),
      taxStatus:requiredEnv('ROLLANDS_INVOICE_TAX_STATUS'),
      vatNumber:requiredEnv('ROLLANDS_INVOICE_VAT_NUMBER'),
      accessConfig
    });
    console.log(`Privata fakturainställningar uppdaterade för: ${result.company.displayName}`);
    console.log('Bankgiro, VAT-nummer och skattestatus har inte skrivits till loggen eller GitHub.');
    console.log(`Databas: ${databasePath}`);
  }finally{db.close();}
}
if(require.main===module){try{main()}catch(error){console.error(error.message);process.exitCode=1}}
module.exports={main,requiredEnv,assertOutsideRepository,updateInvoiceSettings};
