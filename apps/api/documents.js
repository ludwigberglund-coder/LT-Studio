'use strict';

const crypto=require('node:crypto');
const ContentStore=require('./document-content-store.js');
const PrivateObject=require('./private-object-contract.js');

function documentError(message,code='DOCUMENT_ERROR',statusCode=422){const e=new Error(message);e.code=code;e.statusCode=statusCode;return e}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function text(v){return String(v??'').trim()}
function nowIso(){return new Date().toISOString()}
const ALLOWED_MIME=Object.freeze(['application/pdf','image/jpeg','image/png']);
const MAX_BYTES=15*1024*1024;

function initializeDocuments(db){db.exec(`
  CREATE TABLE IF NOT EXISTS documents(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    note TEXT,
    sha256 TEXT,
    size_bytes INTEGER,
    content_blob BLOB,
    status TEXT NOT NULL CHECK(status IN ('pending','ready')),
    uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE(company_id,sha256)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS document_links(
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY(document_id,entity_type,entity_id),
    CHECK(length(entity_type) BETWEEN 1 AND 80),
    CHECK(length(entity_id) BETWEEN 1 AND 160)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_documents_company_created ON documents(company_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_document_links_company_entity ON document_links(company_id,entity_type,entity_id);
`)}
function sanitizeName(value){const name=text(value).replace(/[\r\n\\/]+/g,'_').slice(0,180);if(!name)throw documentError('Filnamn krävs.','INVALID_DOCUMENT_NAME');return name}
function validateMeta(input){const title=text(input.title).slice(0,180),category=text(input.category||'other').toLowerCase();if(title.length<2)throw documentError('Dokumentets titel måste vara minst två tecken.','INVALID_DOCUMENT_TITLE');if(!/^[a-z0-9-]{2,40}$/.test(category))throw documentError('Dokumentkategorin är ogiltig.','INVALID_DOCUMENT_CATEGORY');return{title,category,note:text(input.note).slice(0,1000),fileName:sanitizeName(input.fileName||'underlag.pdf'),mimeType:text(input.mimeType||'application/pdf').toLowerCase()}}
function createPending(db,{companyId,uploadedBy,...input}){const meta=validateMeta(input);if(!ALLOWED_MIME.includes(meta.mimeType))throw documentError('Endast PDF, JPEG och PNG stöds i dokumentarkivet.','UNSUPPORTED_DOCUMENT_TYPE',415);const documentId=input.id||id('doc'),createdAt=nowIso();db.prepare(`INSERT INTO documents(id,company_id,file_name,mime_type,category,title,note,status,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)`).run(documentId,companyId,meta.fileName,meta.mimeType,meta.category,meta.title,meta.note||null,uploadedBy,createdAt);if(input.entityType&&input.entityId)linkDocument(db,{companyId,documentId,entityType:input.entityType,entityId:input.entityId,label:input.linkLabel||''});return documentById(db,companyId,documentId)}
function magicMatches(mime,bytes){if(mime==='application/pdf')return bytes.length>=5&&bytes.subarray(0,5).toString('ascii')==='%PDF-';if(mime==='image/jpeg')return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;if(mime==='image/png')return bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));return false}
function storeContent(db,{companyId,documentId,bytes}){
  const doc=documentById(db,companyId,documentId);
  if(!doc)throw documentError('Dokumentet hittades inte.','DOCUMENT_NOT_FOUND',404);
  if(doc.status==='ready')throw documentError('Ett färdigställt originaldokument kan inte ersättas.','DOCUMENT_IMMUTABLE',409);
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw documentError('Dokumentinnehåll saknas.','MISSING_DOCUMENT_CONTENT');
  if(bytes.length>MAX_BYTES)throw documentError('Dokumentet får vara högst 15 MB.','DOCUMENT_TOO_LARGE',413);
  if(!magicMatches(doc.mimeType,bytes))throw documentError('Filens innehåll stämmer inte med angiven filtyp.','DOCUMENT_MAGIC_MISMATCH',415);
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const duplicate=db.prepare(`SELECT id,title FROM documents WHERE company_id=? AND sha256=? AND id<>?`).get(companyId,sha256,documentId);
  if(duplicate)throw documentError(`Samma originalfil finns redan i dokumentarkivet (${duplicate.title}).`,'DUPLICATE_DOCUMENT',409);
  const completedAt=nowIso(),store=ContentStore.createSqliteDocumentContentStore(db);
  const savepoint=`document_content_${crypto.randomBytes(8).toString('hex')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try{
    if(!store.put({companyId,documentId,bytes}))throw documentError('Dokumentinnehållet kunde inte lagras.','DOCUMENT_STORE_FAILED',409);
    const result=db.prepare(`UPDATE documents SET sha256=?,size_bytes=?,status='ready',completed_at=? WHERE company_id=? AND id=? AND status='pending'`).run(sha256,bytes.length,completedAt,companyId,documentId);
    if(result.changes!==1)throw documentError('Dokumentets metadata kunde inte färdigställas.','DOCUMENT_STORE_FAILED',409);
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
  }catch(error){
    try{db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)}catch{}
    try{db.exec(`RELEASE SAVEPOINT ${savepoint}`)}catch{}
    throw error;
  }
  return documentById(db,companyId,documentId);
}
function linkDocument(db,{companyId,documentId,entityType,entityId,label=''}){const doc=documentById(db,companyId,documentId);if(!doc)throw documentError('Dokumentet hittades inte.','DOCUMENT_NOT_FOUND',404);const type=text(entityType).toLowerCase(),entity=text(entityId);if(!/^[a-z0-9-]{1,80}$/.test(type)||!entity||entity.length>160)throw documentError('Dokumentlänken är ogiltig.','INVALID_DOCUMENT_LINK');db.prepare(`INSERT OR IGNORE INTO document_links(document_id,company_id,entity_type,entity_id,label,created_at) VALUES(?,?,?,?,?,?)`).run(documentId,companyId,type,entity,text(label).slice(0,180)||null,nowIso());return linksForDocument(db,companyId,documentId)}
function linksForDocument(db,companyId,documentId){return db.prepare(`SELECT entity_type AS entityType,entity_id AS entityId,label,created_at AS createdAt FROM document_links WHERE company_id=? AND document_id=? ORDER BY created_at`).all(companyId,documentId)}
function documentById(db,companyId,documentId){const row=db.prepare(`SELECT id,company_id AS companyId,file_name AS fileName,mime_type AS mimeType,category,title,note,sha256,size_bytes AS sizeBytes,status,uploaded_by AS uploadedBy,created_at AS createdAt,completed_at AS completedAt FROM documents WHERE company_id=? AND id=?`).get(companyId,documentId);return row?{...row,links:linksForDocument(db,companyId,row.id)}:null}
function verifyContent(row){if(!row||row.status!=='ready'||!row.bytes)throw documentError('Dokumentinnehållet hittades inte.','DOCUMENT_CONTENT_NOT_FOUND',404);const bytes=Buffer.from(row.bytes);const expected=text(row.sha256).toLowerCase();const actual=crypto.createHash('sha256').update(bytes).digest('hex');if(!/^[a-f0-9]{64}$/.test(expected)||!Number.isSafeInteger(Number(row.sizeBytes))||Number(row.sizeBytes)!==bytes.length||expected!==actual||!magicMatches(row.mimeType,bytes))throw documentError('Dokumentets integritetskontroll misslyckades.','DOCUMENT_INTEGRITY_ERROR',409);return{...row,bytes}}
function content(db,companyId,documentId){
  const row=db.prepare(`SELECT file_name AS fileName,mime_type AS mimeType,sha256,size_bytes AS sizeBytes,status FROM documents WHERE company_id=? AND id=?`).get(companyId,documentId);
  if(row)row.bytes=ContentStore.createSqliteDocumentContentStore(db).get({companyId,documentId});
  return verifyContent(row);
}
function privateObjectMetadata(db,companyId,documentId){
  const row=db.prepare(`SELECT id,company_id AS companyId,mime_type AS mimeType,sha256,size_bytes AS sizeBytes,status,completed_at AS completedAt
    FROM documents WHERE company_id=? AND id=?`).get(companyId,documentId);
  if(!row||row.status!=='ready')return null;
  return PrivateObject.createPrivateObjectMetadata({
    companyId:row.companyId,
    kind:PrivateObject.PRIVATE_OBJECT_KINDS.DOCUMENT,
    objectId:row.id,
    mimeType:row.mimeType,
    sizeBytes:row.sizeBytes,
    sha256:row.sha256,
    createdAt:row.completedAt
  });
}
function listDocuments(db,companyId,{category='',entityType='',entityId='',limit=200}={}){const safe=Math.max(1,Math.min(1000,Number(limit)||200));if(entityType&&entityId){return db.prepare(`SELECT d.id FROM documents d JOIN document_links l ON l.document_id=d.id AND l.company_id=d.company_id WHERE d.company_id=? AND l.entity_type=? AND l.entity_id=? AND d.status='ready' ORDER BY d.created_at DESC LIMIT ?`).all(companyId,text(entityType).toLowerCase(),text(entityId),safe).map(r=>documentById(db,companyId,r.id))}if(category){return db.prepare(`SELECT id FROM documents WHERE company_id=? AND category=? AND status='ready' ORDER BY created_at DESC LIMIT ?`).all(companyId,text(category).toLowerCase(),safe).map(r=>documentById(db,companyId,r.id))}return db.prepare(`SELECT id FROM documents WHERE company_id=? AND status='ready' ORDER BY created_at DESC LIMIT ?`).all(companyId,safe).map(r=>documentById(db,companyId,r.id))}

module.exports=Object.freeze({ALLOWED_MIME,MAX_BYTES,initializeDocuments,createPending,storeContent,linkDocument,linksForDocument,documentById,content,privateObjectMetadata,listDocuments,magicMatches,verifyContent});
