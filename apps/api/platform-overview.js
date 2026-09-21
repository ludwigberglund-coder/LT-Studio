'use strict';

function overviewError(message,code='PLATFORM_OVERVIEW_ERROR'){
  const error=new Error(message);error.code=code;return error;
}
function platformOverview(db,{nowMs=Date.now(),securityWindowHours=24}={}){
  if(!db||typeof db.prepare!=='function')throw overviewError('Databas krävs.','PLATFORM_OVERVIEW_DATABASE_REQUIRED');
  const now=new Date(nowMs);
  if(!Number.isFinite(now.getTime()))throw overviewError('Ogiltig tidpunkt.','PLATFORM_OVERVIEW_INVALID_TIME');
  const hours=Number(securityWindowHours);
  if(!Number.isFinite(hours)||hours<=0||hours>24*30)throw overviewError('Ogiltigt säkerhetsfönster.','PLATFORM_OVERVIEW_INVALID_SECURITY_WINDOW');
  const nowIso=now.toISOString();
  const securitySinceIso=new Date(now.getTime()-hours*60*60*1000).toISOString();
  const companies=db.prepare(`
    SELECT
      c.id,
      c.legal_name AS legalName,
      c.display_name AS displayName,
      c.org_number AS orgNumber,
      c.created_at AS createdAt,
      (SELECT COUNT(*) FROM memberships m WHERE m.company_id=c.id) AS memberCount,
      (SELECT COUNT(*) FROM sessions s
        WHERE s.company_id=c.id AND s.expires_at>? AND s.absolute_expires_at>?) AS activeSessionCount,
      (SELECT COUNT(*) FROM customers customer WHERE customer.company_id=c.id) AS customerRecordCount,
      (SELECT COUNT(*) FROM invoices invoice WHERE invoice.company_id=c.id) AS invoiceRecordCount,
      (SELECT MAX(a.created_at) FROM audit_events a WHERE a.company_id=c.id) AS lastActivityAt
    FROM companies c
    ORDER BY COALESCE(NULLIF(c.display_name,''),c.legal_name),c.id
  `).all(nowIso,nowIso).map(row=>({
    id:row.id,
    legalName:row.legalName,
    displayName:row.displayName||row.legalName,
    orgNumber:row.orgNumber||'',
    createdAt:row.createdAt,
    memberCount:Number(row.memberCount||0),
    activeSessionCount:Number(row.activeSessionCount||0),
    customerRecordCount:Number(row.customerRecordCount||0),
    invoiceRecordCount:Number(row.invoiceRecordCount||0),
    lastActivityAt:row.lastActivityAt||null,
    accessConfigured:Number(row.memberCount||0)>0
  }));
  const securityRows=db.prepare(`SELECT severity,COUNT(*) AS count
    FROM security_events WHERE created_at>=? AND created_at<=?
    GROUP BY severity`).all(securitySinceIso,nowIso);
  const securityCounts={info:0,warning:0,critical:0};
  for(const row of securityRows)if(Object.hasOwn(securityCounts,row.severity))securityCounts[row.severity]=Number(row.count||0);
  const latestSecurity=db.prepare('SELECT created_at AS createdAt FROM security_events ORDER BY created_at DESC,id DESC LIMIT 1').get()||null;
  return Object.freeze({
    generatedAt:nowIso,
    runtimeModel:'shared-saas',
    companyCount:companies.length,
    activeSessionCount:companies.reduce((sum,row)=>sum+row.activeSessionCount,0),
    security:Object.freeze({
      windowHours:hours,
      total:securityCounts.info+securityCounts.warning+securityCounts.critical,
      info:securityCounts.info,
      warning:securityCounts.warning,
      critical:securityCounts.critical,
      latestEventAt:latestSecurity?.createdAt||null
    }),
    companies:Object.freeze(companies.map(row=>Object.freeze(row)))
  });
}
module.exports=Object.freeze({platformOverview});
