'use strict';

function overviewError(message,code='PLATFORM_OVERVIEW_ERROR'){
  const error=new Error(message);error.code=code;return error;
}
function monthKey(date){return date.toISOString().slice(0,7)}
function monthLabel(key){
  const [year,month]=key.split('-').map(Number);
  return new Intl.DateTimeFormat('sv-SE',{month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(year,month-1,1))).replace('.','');
}
function recentMonths(now,count=6){
  const result=[];
  for(let offset=count-1;offset>=0;offset-=1)result.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-offset,1))));
  return result;
}
function groupedCounts(db,table,fromIso){
  const allowed=new Set(['audit_events','invoices','customers','memberships']);
  if(!allowed.has(table))throw overviewError('Ogiltig statistikserie.','PLATFORM_OVERVIEW_INVALID_SERIES');
  return new Map(db.prepare(`SELECT substr(created_at,1,7) AS month,COUNT(*) AS count FROM ${table}
    WHERE created_at>=? GROUP BY substr(created_at,1,7) ORDER BY month`).all(fromIso).map(row=>[row.month,Number(row.count||0)]));
}
function platformOverview(db,{nowMs=Date.now(),securityWindowHours=24}={}){
  if(!db||typeof db.prepare!=='function')throw overviewError('Databas krävs.','PLATFORM_OVERVIEW_DATABASE_REQUIRED');
  const now=new Date(nowMs);
  if(!Number.isFinite(now.getTime()))throw overviewError('Ogiltig tidpunkt.','PLATFORM_OVERVIEW_INVALID_TIME');
  const hours=Number(securityWindowHours);
  if(!Number.isFinite(hours)||hours<=0||hours>24*30)throw overviewError('Ogiltigt säkerhetsfönster.','PLATFORM_OVERVIEW_INVALID_SECURITY_WINDOW');
  const nowIso=now.toISOString();
  const securitySinceIso=new Date(now.getTime()-hours*60*60*1000).toISOString();
  const active30SinceIso=new Date(now.getTime()-30*24*60*60*1000).toISOString();
  const companies=db.prepare(`
    SELECT
      c.id,
      c.legal_name AS legalName,
      c.display_name AS displayName,
      c.org_number AS orgNumber,
      c.created_at AS createdAt,
      (SELECT COUNT(*) FROM memberships m WHERE m.company_id=c.id) AS memberCount,
      (SELECT COUNT(*) FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=c.id AND u.disabled=0) AS activeMemberCount,
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
    activeMemberCount:Number(row.activeMemberCount||0),
    activeSessionCount:Number(row.activeSessionCount||0),
    customerRecordCount:Number(row.customerRecordCount||0),
    invoiceRecordCount:Number(row.invoiceRecordCount||0),
    lastActivityAt:row.lastActivityAt||null,
    accessConfigured:Number(row.activeMemberCount||0)>0
  }));

  const totals=Object.freeze({
    members:companies.reduce((sum,row)=>sum+row.memberCount,0),
    customers:companies.reduce((sum,row)=>sum+row.customerRecordCount,0),
    invoices:companies.reduce((sum,row)=>sum+row.invoiceRecordCount,0),
    activeSessions:companies.reduce((sum,row)=>sum+row.activeSessionCount,0),
    configuredCompanies:companies.filter(row=>row.accessConfigured).length,
    activeCompanies30d:companies.filter(row=>row.lastActivityAt&&row.lastActivityAt>=active30SinceIso).length,
    newCompanies30d:companies.filter(row=>row.createdAt>=active30SinceIso).length,
    disabledUsers:Number(db.prepare('SELECT COUNT(*) AS count FROM users WHERE disabled=1').get()?.count||0)
  });

  const roleRows=db.prepare('SELECT role,COUNT(*) AS count FROM memberships GROUP BY role ORDER BY role').all();
  const roleDistribution={admin:0,accountant:0,approver:0,readonly:0};
  for(const row of roleRows)if(Object.hasOwn(roleDistribution,row.role))roleDistribution[row.role]=Number(row.count||0);

  const months=recentMonths(now,6);
  const seriesFromIso=`${months[0]}-01T00:00:00.000Z`;
  const activityCounts=groupedCounts(db,'audit_events',seriesFromIso);
  const invoiceCounts=groupedCounts(db,'invoices',seriesFromIso);
  const customerCounts=groupedCounts(db,'customers',seriesFromIso);
  const membershipCounts=groupedCounts(db,'memberships',seriesFromIso);
  const monthly=months.map(month=>Object.freeze({
    month,
    label:monthLabel(month),
    activity:Number(activityCounts.get(month)||0),
    invoices:Number(invoiceCounts.get(month)||0),
    customers:Number(customerCounts.get(month)||0),
    memberships:Number(membershipCounts.get(month)||0)
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
    activeSessionCount:totals.activeSessions,
    totals,
    roleDistribution:Object.freeze(roleDistribution),
    monthly:Object.freeze(monthly),
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
