'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {validateContent}=require('./validate-content.js');
const root=path.resolve(__dirname,'..'),target=path.join(root,'dist');
function copyDirectory(source,destination){if(!fs.existsSync(source))throw new Error(`Källkatalog saknas: ${path.relative(root,source)}`);fs.mkdirSync(destination,{recursive:true});fs.cpSync(source,destination,{recursive:true});}
function copyFile(source,destination){if(!fs.existsSync(source))throw new Error(`Källfil saknas: ${path.relative(root,source)}`);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);}
function installWorkspaceNavigation(directory){
  for(const name of fs.readdirSync(directory)){
    const file=path.join(directory,name);
    if(fs.statSync(file).isDirectory()){installWorkspaceNavigation(file);continue;}
    if(!name.endsWith('.html'))continue;
    const relative=path.relative(path.dirname(file),path.join(target,'portal')).split(path.sep).join('/')||'.';
    let html=fs.readFileSync(file,'utf8');
    html=html.replace(/<script\b[^>]*src=["'][^"']*portal-nav\.js["'][^>]*>\s*<\/script>/gi,'');
    html=html.replace(/<link\b[^>]*href=["'][^"']*shared-nav\.css["'][^>]*>/gi,'');
    const sharedNavigation=`<link rel="stylesheet" href="${relative}/shared-nav.css">`;
    const designSystem=/<link\b[^>]*href=["'][^"']*design-system\.css(?:\?[^"']*)?["'][^>]*>/i;
    html=designSystem.test(html)
      ? html.replace(designSystem,match=>`${sharedNavigation}\n${match}`)
      : html.replace('</head>',`${sharedNavigation}\n</head>`);
    html=html.replace('</body>',`<script src="${relative}/portal-nav.js"></script>\n</body>`);
    fs.writeFileSync(file,html);
  }
}
function buildStatic(){
  const report=validateContent();if(!report.ok)throw new Error(`Innehållet är ogiltigt: ${report.errors[0]}`);
  fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true});
  copyDirectory(path.join(root,'apps','website'),target);
  copyDirectory(path.join(root,'apps','admin'),path.join(target,'admin'));
  copyDirectory(path.join(root,'apps','operator'),path.join(target,'operator'));
  copyDirectory(path.join(root,'apps','portal'),path.join(target,'portal'));
  copyDirectory(path.join(root,'packages','shared','browser'),path.join(target,'shared'));
  copyFile(path.join(root,'packages','accounting','money.js'),path.join(target,'shared','accounting','money.js'));
  copyFile(path.join(root,'packages','accounting','journal.js'),path.join(target,'shared','accounting','journal.js'));
  copyFile(path.join(root,'packages','access-control','authorization.js'),path.join(target,'shared','access-control','authorization.js'));
  copyFile(path.join(root,'packages','receivables','customer-receivables.js'),path.join(target,'shared','receivables','customer-receivables.js'));
  copyDirectory(path.join(root,'packages','invoicing'),path.join(target,'shared','invoicing'));
  copyFile(require.resolve('pdf-lib/dist/pdf-lib.min.js'),path.join(target,'shared','vendor','pdf-lib.min.js'));
  copyDirectory(path.join(root,'content'),path.join(target,'content'));
  copyDirectory(path.join(root,'config'),path.join(target,'config'));
  copyDirectory(path.join(root,'public'),path.join(target,'legacy'));
  for(const workspace of ['portal','admin','legacy'])installWorkspaceNavigation(path.join(target,workspace));
  copyFile(path.join(root,'apps','website','index.html'),path.join(target,'404.html'));
  fs.writeFileSync(path.join(target,'.nojekyll'),'');
  fs.writeFileSync(path.join(target,'build-info.json'),`${JSON.stringify({source:'GitHub',commit:process.env.GITHUB_SHA||'local',generatedAt:new Date().toISOString(),demoOnly:false,runtime:'supabase-uat'},null,2)}\n`);
  const required=[
    'index.html','app.js','styles.css','design-system.css','operator/index.html','operator/app.js','operator/styles.css','operator/design-system.css','admin/index.html','admin/app.js','admin/money-view.js','admin/money.css','admin/design-system.css',
    'admin/access-view.js','admin/access.css','admin/journal-view.js','admin/journal.css',
    'portal/dashboard.html','portal/dashboard.js','portal/dashboard.css','portal/portal-nav.js','portal/shared-nav.css','portal/profile.html','portal/profile.js','portal/company-settings.html','portal/company-settings.js','portal/company-settings.css',
    'portal/index.html','portal/app.js','portal/styles.css','portal/design-system.css','portal/automation-link.js','portal/supabase-config.js','portal/supabase-client.js','portal/supabase-session.js','portal/uat-setup.html','portal/uat-setup.js',
    'portal/customers.html','portal/customers.js','portal/invoices.html','portal/invoices.js','portal/receivables.html','portal/sales.css',
    'portal/accounts.html','portal/accounts.js','portal/invoice-editor.css',
    'portal/demo-scenario.js','portal/demo-workflows.js','portal/uat.html','portal/uat.js','portal/uat.css',
    'portal/automation.html','portal/automation.js','portal/automation.css','portal/bank.html','portal/bank.js','portal/bank.css',
    'portal/payables.html','portal/payables.js','portal/payables.css','portal/payables-queue.js','portal/payables-intake.js','portal/payables-intake.css',
    'portal/suppliers.html','portal/suppliers.js','portal/suppliers.css','portal/inventory.html','portal/inventory.js','portal/inventory.css',
    'portal/accounting.html','portal/accounting.js','portal/accounting.css','portal/reports.html','portal/reports.js','portal/reports.css',
    'portal/payroll.html','portal/payroll.js','portal/payroll.css','portal/documents.html','portal/documents.js','portal/documents.css',
    'portal/website.html','portal/website.js','portal/website.css','shared/content.js',
    'shared/accounting/money.js','shared/accounting/journal.js','shared/access-control/authorization.js','shared/receivables/customer-receivables.js',
    'shared/invoicing/invoice.js','shared/invoicing/pdf.js','shared/vendor/pdf-lib.min.js',
    'content/company.json','content/site.json','content/admin.json','config/rolands-business-decisions.json','config/access-control.json',
    'config/legal-rates.json','config/accounting-accounts.json','legacy/index.html','legacy/design-system.css'
  ];
  for(const name of required)if(!fs.existsSync(path.join(target,name)))throw new Error(`Byggfil saknas: ${name}`);
  console.log(`Ny statisk demo byggd: ${target}`);return target;
}
if(require.main===module){try{buildStatic();}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={buildStatic};
