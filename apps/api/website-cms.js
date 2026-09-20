'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const DEFAULT_SITE=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','content','site.json'),'utf8'));
const DEFAULT_COMPANY=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','content','company.json'),'utf8'));

function cmsError(message,code='WEBSITE_CMS_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function text(v){return String(v??'').trim()}
function now(){return new Date().toISOString()}
function clone(v){return structuredClone(v)}
function parse(value,fallback){try{return JSON.parse(value)}catch{return clone(fallback)}}
function required(value,label,max=5000){const result=text(value);if(!result)throw cmsError(`${label} måste anges.`,'INVALID_WEBSITE_CONTENT');if(result.length>max)throw cmsError(`${label} är för lång.`,'INVALID_WEBSITE_CONTENT');return result}
function safeLink(value,label){const v=required(value,label,500);if(!/^(?:#|\.\.?\/|https?:\/\/|mailto:|tel:)/i.test(v))throw cmsError(`${label} innehåller en otillåten länk.`,'INVALID_WEBSITE_LINK');return v}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value))}

function initializeWebsiteCms(db){db.exec(`
  CREATE TABLE IF NOT EXISTS website_cms_state(
    company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    draft_site_json TEXT NOT NULL,
    draft_company_json TEXT NOT NULL,
    draft_updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    draft_updated_at TEXT NOT NULL,
    draft_revision INTEGER NOT NULL DEFAULT 1 CHECK(draft_revision>0),
    published_site_json TEXT NOT NULL,
    published_company_json TEXT NOT NULL,
    published_version INTEGER NOT NULL DEFAULT 0 CHECK(published_version>=0),
    published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    published_at TEXT
  ) STRICT;
  CREATE TABLE IF NOT EXISTS website_cms_revisions(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version>0),
    site_json TEXT NOT NULL,
    company_json TEXT NOT NULL,
    published_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    published_at TEXT NOT NULL,
    UNIQUE(company_id,version)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_website_revisions_company_version ON website_cms_revisions(company_id,version DESC);
`);
  if(!db.prepare('PRAGMA table_info(website_cms_state)').all().some(row=>row.name==='draft_revision')) {
    db.exec('ALTER TABLE website_cms_state ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 1 CHECK(draft_revision>0)');
  }
}

function genericSite(company){
  const name=text(company.displayName||company.legalName||'Företaget');
  return{
    meta:{title:`${name} | Webbplats`,description:`Information, erbjudanden och kontakt för ${name}.`,language:'sv'},
    navigation:[{label:'Hem',href:'#hem'},{label:'Erbjudande',href:'#erbjudande'},{label:'Om oss',href:'#om'},{label:'Kontakt',href:'#kontakt'}],
    hero:{eyebrow:`Välkommen till ${name}`,title:'Enklare information för kunder och företag.',body:`Här hittar du aktuell information om ${name}.`,primaryCta:{label:'Kontakta oss',href:'#kontakt'},secondaryCta:{label:'Läs mer',href:'#om'}},
    highlights:[{value:'Aktuellt',label:'information och erbjudanden'},{value:'Kontakt',label:'nå oss enkelt'},{value:'Företag',label:'anpassat efter verksamheten'}],
    services:{eyebrow:'Vårt erbjudande',title:'Produkter och tjänster',body:'Anpassa innehållet i webbplatsadministrationen efter verksamhetens faktiska erbjudande.',items:[
      {id:'products',symbol:'01',title:'Produkter och tjänster',description:'Beskriv företagets viktigaste produkter eller tjänster här.'},
      {id:'business',symbol:'02',title:'För företag',description:'Beskriv erbjudanden eller lösningar för företagskunder här.'},
      {id:'service',symbol:'03',title:'Service',description:'Beskriv den service och hjälp som kunder kan få.'}
    ]},
    story:{eyebrow:'Om oss',title:`Om ${name}`,body:'Beskriv verksamheten, inriktningen och det som är viktigt för kunderna.',points:['Tydlig information för kunder','Aktuella kontaktuppgifter och öppettider','Innehåll som kan uppdateras utan kodändringar']},
    contact:{eyebrow:'Kontakt',title:'Välkommen att höra av dig',body:`Kontakta ${name} för aktuell information och frågor.`,openingHours:[{days:'Öppettider',hours:'Lägg in aktuella öppettider'}]},
    footer:{tagline:`${name}.`,adminLabel:'Öppna webbplatsadministration'}
  };
}
function defaultContent(db,companyId){
  const company=db.prepare(`SELECT legal_name AS legalName,display_name AS displayName,org_number AS orgNumber FROM companies WHERE id=?`).get(companyId);
  if(!company)throw cmsError('Företaget hittades inte.','COMPANY_NOT_FOUND',404);
  if(company.orgNumber===DEFAULT_COMPANY.orgNumber)return{site:clone(DEFAULT_SITE),company:clone(DEFAULT_COMPANY)};
  const base=clone(DEFAULT_COMPANY);
  base.legalName=company.legalName;base.displayName=company.displayName;base.orgNumber=company.orgNumber;base.vatNumber='EJ ANGIVET';base.registeredOffice='EJ ANGIVET';
  base.address={street:'',postalCode:'',city:'',full:'Adress ej angiven'};
  base.contact={phone:'Ej angivet',phoneHref:'+46000000000',email:'info@example.invalid'};
  base.website='';base.invoice={bankgiro:'',taxStatus:''};base.business={description:'',currency:'SEK'};base.links={maps:'#kontakt'};
  return{site:genericSite(company),company:base};
}
function ensureState(db,companyId){let row=db.prepare(`SELECT company_id AS companyId,draft_site_json AS draftSiteJson,draft_company_json AS draftCompanyJson,draft_updated_by AS draftUpdatedBy,draft_updated_at AS draftUpdatedAt,draft_revision AS draftRevision,published_site_json AS publishedSiteJson,published_company_json AS publishedCompanyJson,published_version AS publishedVersion,published_by AS publishedBy,published_at AS publishedAt FROM website_cms_state WHERE company_id=?`).get(companyId);if(!row){const initial=defaultContent(db,companyId),stamp=now();db.prepare(`INSERT INTO website_cms_state(company_id,draft_site_json,draft_company_json,draft_updated_at,published_site_json,published_company_json,published_version) VALUES(?,?,?,?,?,?,0)`).run(companyId,JSON.stringify(initial.site),JSON.stringify(initial.company),stamp,JSON.stringify(initial.site),JSON.stringify(initial.company));row=db.prepare(`SELECT company_id AS companyId,draft_site_json AS draftSiteJson,draft_company_json AS draftCompanyJson,draft_updated_by AS draftUpdatedBy,draft_updated_at AS draftUpdatedAt,draft_revision AS draftRevision,published_site_json AS publishedSiteJson,published_company_json AS publishedCompanyJson,published_version AS publishedVersion,published_by AS publishedBy,published_at AS publishedAt FROM website_cms_state WHERE company_id=?`).get(companyId)}return row}
function state(db,companyId){const row=ensureState(db,companyId);return{companyId:row.companyId,draft:{revision:row.draftRevision,site:parse(row.draftSiteJson,DEFAULT_SITE),company:parse(row.draftCompanyJson,DEFAULT_COMPANY),updatedBy:row.draftUpdatedBy,updatedAt:row.draftUpdatedAt},published:{site:parse(row.publishedSiteJson,DEFAULT_SITE),company:parse(row.publishedCompanyJson,DEFAULT_COMPANY),version:Number(row.publishedVersion||0),publishedBy:row.publishedBy,publishedAt:row.publishedAt}}}

function validateSite(input){const site=clone(input||{});site.meta=site.meta||{};site.hero=site.hero||{};site.services=site.services||{};site.story=site.story||{};site.contact=site.contact||{};site.footer=site.footer||{};
  site.meta.title=required(site.meta.title,'Sidans titel',180);site.meta.description=required(site.meta.description,'Meta-beskrivning',320);site.meta.language=text(site.meta.language||'sv').slice(0,10);
  site.hero.eyebrow=required(site.hero.eyebrow,'Hero-överrubrik',160);site.hero.title=required(site.hero.title,'Hero-rubrik',300);site.hero.body=required(site.hero.body,'Hero-text',1200);site.hero.primaryCta=site.hero.primaryCta||{};site.hero.secondaryCta=site.hero.secondaryCta||{};site.hero.primaryCta.label=required(site.hero.primaryCta.label,'Primär knapptext',80);site.hero.primaryCta.href=safeLink(site.hero.primaryCta.href,'Primär knapplänk');site.hero.secondaryCta.label=required(site.hero.secondaryCta.label,'Sekundär knapptext',80);site.hero.secondaryCta.href=safeLink(site.hero.secondaryCta.href,'Sekundär knapplänk');
  if(!Array.isArray(site.navigation)||site.navigation.length<1||site.navigation.length>12)throw cmsError('Navigeringen måste innehålla 1–12 länkar.','INVALID_WEBSITE_CONTENT');site.navigation=site.navigation.map((item,index)=>({label:required(item?.label,`Navigationslänk ${index+1}`,80),href:safeLink(item?.href,`Navigationslänk ${index+1}`)}));
  if(!Array.isArray(site.highlights)||site.highlights.length<1||site.highlights.length>8)throw cmsError('Höjdpunkter måste innehålla 1–8 poster.','INVALID_WEBSITE_CONTENT');site.highlights=site.highlights.map((item,index)=>({value:required(item?.value,`Höjdpunkt ${index+1}`,80),label:required(item?.label,`Höjdpunkt ${index+1}`,120)}));
  site.services.eyebrow=required(site.services.eyebrow,'Erbjudandets överrubrik',160);site.services.title=required(site.services.title,'Erbjudandets rubrik',240);site.services.body=required(site.services.body,'Erbjudandets text',1200);if(!Array.isArray(site.services.items)||site.services.items.length<1||site.services.items.length>12)throw cmsError('Erbjudanden måste innehålla 1–12 poster.','INVALID_WEBSITE_CONTENT');site.services.items=site.services.items.map((item,index)=>({id:required(item?.id,`Erbjudande ${index+1} id`,80),symbol:required(item?.symbol,`Erbjudande ${index+1} symbol`,20),title:required(item?.title,`Erbjudande ${index+1} rubrik`,160),description:required(item?.description,`Erbjudande ${index+1} text`,800)}));
  site.story.eyebrow=required(site.story.eyebrow,'Om-sektionens överrubrik',160);site.story.title=required(site.story.title,'Om-sektionens rubrik',240);site.story.body=required(site.story.body,'Om-sektionens text',1600);if(!Array.isArray(site.story.points)||site.story.points.length<1||site.story.points.length>12)throw cmsError('Om-punkter måste innehålla 1–12 poster.','INVALID_WEBSITE_CONTENT');site.story.points=site.story.points.map((value,index)=>required(value,`Om-punkt ${index+1}`,240));
  site.contact.eyebrow=required(site.contact.eyebrow,'Kontaktens överrubrik',160);site.contact.title=required(site.contact.title,'Kontaktens rubrik',240);site.contact.body=required(site.contact.body,'Kontaktens text',1200);if(!Array.isArray(site.contact.openingHours)||site.contact.openingHours.length<1||site.contact.openingHours.length>14)throw cmsError('Öppettider måste innehålla 1–14 rader.','INVALID_WEBSITE_CONTENT');site.contact.openingHours=site.contact.openingHours.map((row,index)=>({days:required(row?.days,`Öppettid ${index+1} dagar`,100),hours:required(row?.hours,`Öppettid ${index+1} tid`,160)}));
  site.footer.tagline=required(site.footer.tagline,'Sidfotens text',240);site.footer.adminLabel=required(site.footer.adminLabel,'Sidfotens adminlänk',100);return site}
function validateCompany(input,identity){const company=clone(input||{});company.legalName=identity.legalName;company.orgNumber=identity.orgNumber;company.vatNumber=identity.vatNumber;company.registeredOffice=identity.registeredOffice;company.displayName=required(company.displayName,'Visningsnamn',160);company.address=company.address||{};company.address.street=required(company.address.street,'Gatuadress',200);company.address.postalCode=required(company.address.postalCode,'Postnummer',30);company.address.city=required(company.address.city,'Ort',120);company.address.full=required(company.address.full,'Fullständig adress',300);company.contact=company.contact||{};company.contact.phone=required(company.contact.phone,'Telefon',50);company.contact.phoneHref=required(company.contact.phoneHref,'Telefonlänk',30);if(!/^\+\d{8,15}$/.test(company.contact.phoneHref))throw cmsError('Telefonlänken måste vara internationellt nummer, till exempel +4631913223.','INVALID_PHONE');company.contact.email=required(company.contact.email,'E-post',200);if(!validEmail(company.contact.email))throw cmsError('E-postadressen är ogiltig.','INVALID_EMAIL');company.links=company.links||{};company.links.maps=safeLink(company.links.maps,'Kartlänk');company.business=company.business||identity.business||{};return company}
function identityFromPublished(db,companyId){const current=state(db,companyId).published.company;return{legalName:current.legalName,orgNumber:current.orgNumber,vatNumber:current.vatNumber,registeredOffice:current.registeredOffice,business:current.business}}
function saveDraft(db,{companyId,site,company,userId}){const cleanSite=validateSite(site);const cleanCompany=validateCompany(company,identityFromPublished(db,companyId));const stamp=now();db.prepare(`UPDATE website_cms_state SET draft_site_json=?,draft_company_json=?,draft_updated_by=?,draft_updated_at=?,draft_revision=draft_revision+1 WHERE company_id=?`).run(JSON.stringify(cleanSite),JSON.stringify(cleanCompany),userId,stamp,companyId);return state(db,companyId)}
function publish(db,{companyId,userId}){const current=state(db,companyId);const cleanSite=validateSite(current.draft.site);const cleanCompany=validateCompany(current.draft.company,identityFromPublished(db,companyId));const version=current.published.version+1,stamp=now(),revisionId=id('webrev');db.prepare(`INSERT INTO website_cms_revisions(id,company_id,version,site_json,company_json,published_by,published_at) VALUES(?,?,?,?,?,?,?)`).run(revisionId,companyId,version,JSON.stringify(cleanSite),JSON.stringify(cleanCompany),userId,stamp);db.prepare(`UPDATE website_cms_state SET published_site_json=?,published_company_json=?,published_version=?,published_by=?,published_at=? WHERE company_id=?`).run(JSON.stringify(cleanSite),JSON.stringify(cleanCompany),version,userId,stamp,companyId);return state(db,companyId)}
function listRevisions(db,companyId,{limit=50}={}){const safe=Math.max(1,Math.min(200,Number(limit)||50));return db.prepare(`SELECT id,version,published_by AS publishedBy,published_at AS publishedAt FROM website_cms_revisions WHERE company_id=? ORDER BY version DESC LIMIT ?`).all(companyId,safe)}
function revision(db,companyId,version){const row=db.prepare(`SELECT id,version,site_json AS siteJson,company_json AS companyJson,published_by AS publishedBy,published_at AS publishedAt FROM website_cms_revisions WHERE company_id=? AND version=?`).get(companyId,Number(version));return row?{id:row.id,version:row.version,site:parse(row.siteJson,DEFAULT_SITE),company:parse(row.companyJson,DEFAULT_COMPANY),publishedBy:row.publishedBy,publishedAt:row.publishedAt}:null}
function restoreToDraft(db,{companyId,version,userId}){const old=revision(db,companyId,version);if(!old)throw cmsError('Webbplatsversionen hittades inte.','WEBSITE_REVISION_NOT_FOUND',404);const stamp=now();db.prepare(`UPDATE website_cms_state SET draft_site_json=?,draft_company_json=?,draft_updated_by=?,draft_updated_at=?,draft_revision=draft_revision+1 WHERE company_id=?`).run(JSON.stringify(old.site),JSON.stringify(old.company),userId,stamp,companyId);return state(db,companyId)}

module.exports=Object.freeze({initializeWebsiteCms,state,validateSite,validateCompany,saveDraft,publish,listRevisions,revision,restoreToDraft});
