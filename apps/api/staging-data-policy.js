'use strict';

const EXPECTED_STAGING_COMPANIES=Object.freeze([
  Object.freeze({legalName:'Synthetic Staging Company Alpha',displayName:'Synthetic Alpha',orgNumber:'000000-0000'}),
  Object.freeze({legalName:'Synthetic Staging Company Beta',displayName:'Synthetic Beta',orgNumber:'000000-0018'})
]);

function stagingDataError(message){
  const error=new Error(message);
  error.code='UNSAFE_STAGING_DATA';
  return error;
}

function assertSyntheticStagingDatabase(db,env=process.env){
  if(String(env.ROLLANDS_ENV||'').trim()!=='staging')return Object.freeze({required:false,ok:true});
  const rows=db.prepare('SELECT id,legal_name AS legalName,display_name AS displayName,org_number AS orgNumber FROM companies ORDER BY org_number').all();
  if(rows.length!==EXPECTED_STAGING_COMPANIES.length){
    throw stagingDataError(`Stagingdatabasen måste innehålla exakt ${EXPECTED_STAGING_COMPANIES.length} syntetiska företag. Hittade ${rows.length}.`);
  }
  const expectedByOrg=new Map(EXPECTED_STAGING_COMPANIES.map(company=>[company.orgNumber,company]));
  for(const row of rows){
    const expected=expectedByOrg.get(String(row.orgNumber||''));
    if(!expected||row.legalName!==expected.legalName||row.displayName!==expected.displayName){
      throw stagingDataError('Stagingdatabasen innehåller ett företag som inte matchar den godkända syntetiska fixture-identiteten.');
    }
    const audits=db.prepare("SELECT details_json AS detailsJson FROM audit_events WHERE company_id=? AND action='SYNTHETIC_STAGING_BOOTSTRAP'").all(row.id);
    const hasSyntheticBootstrap=audits.some(audit=>{
      try{return JSON.parse(audit.detailsJson||'{}').dataClassification==='synthetic'}catch{return false}
    });
    if(!hasSyntheticBootstrap)throw stagingDataError(`Stagingföretaget ${row.orgNumber} saknar verifierbar SYNTHETIC_STAGING_BOOTSTRAP-audit.`);
  }
  return Object.freeze({required:true,ok:true,companies:rows.length});
}

module.exports=Object.freeze({EXPECTED_STAGING_COMPANIES,assertSyntheticStagingDatabase});
