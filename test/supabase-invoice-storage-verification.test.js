'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Supabase kundfaktura verifierar faktisk PDF via Edge före finalisering',()=>{
  const invoices=read('apps/portal/invoices.js');
  const client=read('apps/portal/supabase-client.js');
  const edge=read('supabase/functions/verify-customer-invoice-document/index.ts');

  assert.match(client,/functions:\{invoke:/);
  assert.match(invoices,/functions\.invoke\('verify-customer-invoice-document'/);
  assert.ok(
    invoices.indexOf("functions.invoke('verify-customer-invoice-document'")<
    invoices.indexOf("rpc('finalize_customer_invoice'"),
    'PDF-verifieringen måste ske före vanlig fakturafinalisering.'
  );
  const creditVerify=invoices.lastIndexOf("functions.invoke('verify-customer-invoice-document'");
  const creditFinalize=invoices.indexOf("rpc('finalize_customer_credit'");
  assert.ok(creditVerify>=0&&creditVerify<creditFinalize,'PDF-verifieringen måste ske före kreditfakturafinalisering.');

  assert.match(edge,/ALLOWED_ORIGINS=new Set\(\["https:\/\/ludwigberglund-coder\.github\.io"\]\)/);
  assert.match(edge,/jwtClaims\(token\)\.aal!==["']aal2["']/);
  assert.match(edge,/storage\.from\(["']lt-documents["']\)\.download\(objectPath\)/);
  assert.match(edge,/storage\.from\(["']lt-documents["']\)\.list\(folder/);
  assert.match(edge,/isPdfMagic\(bytes\)/);
  assert.match(edge,/PDFDocument\.load\(bytes/);
  assert.match(edge,/ACTIVE_PDF_CONTENT_NOT_ALLOWED/);
  assert.match(edge,/ENCRYPTED_PDF_NOT_ALLOWED/);
  assert.match(edge,/INVALID_PDF_EOF/);
  assert.match(edge,/calculatedPdfSha!==pdfSha256/);
  assert.match(edge,/calculatedDocumentSha!==documentSha256/);
  assert.match(edge,/storage_object_id:objectInfo\.id/);
  assert.doesNotMatch(invoices,/SUPABASE_SERVICE_ROLE_KEY|sb_secret_/);
});

test('verifieringsbiljetter kan inte skapas av browserrollen och konsumeras av dokumenttriggern',()=>{
  const sql=read('supabase/migrations/20260925_verified_customer_invoice_storage.sql');

  assert.match(sql,/revoke all on public\.document_upload_verifications from anon,authenticated/i);
  assert.match(sql,/grant select,delete on public\.document_upload_verifications to authenticated/i);
  assert.doesNotMatch(sql,/grant\s+[^;]*insert[^;]*document_upload_verifications\s+to\s+authenticated/i);
  assert.match(sql,/grant select,insert,delete on public\.document_upload_verifications to service_role/i);
  assert.match(sql,/coalesce\(\(select auth\.jwt\(\)\)->>'aal','aal1'\)='aal2'/i);
  assert.match(sql,/before insert on public\.customer_invoice_documents/i);
  assert.match(sql,/DOCUMENT_UPLOAD_NOT_VERIFIED/);
  assert.match(sql,/VERIFIED_STORAGE_OBJECT_CHANGED/);
  assert.match(sql,/o\.id=v_storage_object_id/);
  assert.match(sql,/o\.bucket_id='lt-documents'/);
  assert.match(sql,/v\.document_json=new\.document_json/);
  assert.match(sql,/v\.document_sha256=new\.document_sha256/);
  assert.match(sql,/v\.pdf_sha256=new\.pdf_sha256/);
});
