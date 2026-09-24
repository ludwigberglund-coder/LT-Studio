'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Auth=require('../apps/api/auth.js');
const Db=require('../apps/api/database.js');
const Bank=require('../apps/api/bank-payments.js');

const SYNTHETIC_TENANTS=Object.freeze([
  Object.freeze({
    legalName:'Synthetic Staging Company Alpha',
    displayName:'Synthetic Alpha',
    orgNumber:'000000-0000',
    username:'staging-alpha',
    userDisplayName:'Synthetic Tester Alpha',
    passwordEnv:'ROLLANDS_STAGING_ALPHA_PASSWORD',
    mfaEnv:'ROLLANDS_STAGING_ALPHA_MFA_SECRET'
  }),
  Object.freeze({
    legalName:'Synthetic Staging Company Beta',
    displayName:'Synthetic Beta',
    orgNumber:'000000-0018',
    username:'staging-beta',
    userDisplayName:'Synthetic Tester Beta',
    passwordEnv:'ROLLANDS_STAGING_BETA_PASSWORD',
    mfaEnv:'ROLLANDS_STAGING_BETA_MFA_SECRET'
  })
]);

function required(env,name){
  const value=String(env[name]||'').trim();
  if(!value)throw new Error(`${name} måste anges.`);
  return value;
}

function stockholmDate(now=new Date()){
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}

function seedSyntheticUatBusinessData(db,{company,user,index,bookingDate=stockholmDate()}){
  const suffix=String(index+1).padStart(2,'0');
  const exactCustomer=Db.createCustomer(db,{
    companyId:company.id,
    customerNumber:`K-UAT-${suffix}01`,
    name:`UAT Bankkund ${suffix} AB`,
    orgNumber:`000000-${String(1100+index).padStart(4,'0')}`,
    email:`uat-bank-${suffix}@example.invalid`,
    address:{street:'Syntetgatan 1',postalCode:'000 00',city:'Teststad'},
    customerType:'business',
    reminderFeeAgreed:true
  });
  const exactInvoice=Db.createInvoice(db,{
    companyId:company.id,
    customerId:exactCustomer.id,
    invoiceNumber:`UAT-BANK-${suffix}-1001`,
    ocr:`9900${suffix}1001`,
    invoiceDate:bookingDate,
    postingDate:bookingDate,
    dueDate:bookingDate,
    totalOre:125000,
    remainingOre:125000,
    vatOre:25000,
    status:'Bokförd',
    paymentMethod:'Bankgiro',
    paymentAccount:'999-8888',
    invoiceAccount:'1510'
  });
  const exactPayment=Bank.create(db,{
    companyId:company.id,
    externalId:`UAT-BANK-EXACT-${suffix}`,
    bookingDate,
    valueDate:bookingDate,
    amountOre:125000,
    reference:exactInvoice.invoiceNumber,
    message:`Syntetisk exakt UAT-matchning ${exactInvoice.invoiceNumber}`,
    payerName:exactCustomer.name,
    payerAccount:`UAT-PAYER-${suffix}`,
    createdBy:user.id
  }).payment;

  const ambiguousCustomers=[1,2].map(number=>Db.createCustomer(db,{
    companyId:company.id,
    customerNumber:`K-UAT-${suffix}1${number}`,
    name:'UAT Delad Betalare AB',
    orgNumber:`000000-${String(1200+index*10+number).padStart(4,'0')}`,
    email:`uat-ambiguous-${suffix}-${number}@example.invalid`,
    address:{street:`Testvägen ${number}`,postalCode:'000 00',city:'Teststad'},
    customerType:'business'
  }));
  const ambiguousInvoices=ambiguousCustomers.map((customer,number)=>Db.createInvoice(db,{
    companyId:company.id,
    customerId:customer.id,
    invoiceNumber:`UAT-AMB-${suffix}-${number+1}`,
    ocr:`8800${suffix}${number+1}001`,
    invoiceDate:bookingDate,
    postingDate:bookingDate,
    dueDate:bookingDate,
    totalOre:75000,
    remainingOre:75000,
    vatOre:15000,
    status:'Bokförd',
    paymentMethod:'Bankgiro',
    paymentAccount:'999-8888',
    invoiceAccount:'1510'
  }));
  const ambiguousPayment=Bank.create(db,{
    companyId:company.id,
    externalId:`UAT-BANK-AMBIGUOUS-${suffix}`,
    bookingDate,
    valueDate:bookingDate,
    amountOre:75000,
    reference:'UAT-MANUELL-GRANSKNING',
    message:'Syntetisk betalning med två likvärdiga fakturakandidater',
    payerName:'UAT Delad Betalare AB',
    payerAccount:`UAT-AMB-PAYER-${suffix}`,
    createdBy:user.id
  }).payment;

  Db.appendAudit(db,{
    companyId:company.id,
    userId:user.id,
    action:'SYNTHETIC_UAT_BUSINESS_DATA_SEEDED',
    entityType:'bank-payment',
    entityId:exactPayment.id,
    details:{
      dataClassification:'synthetic',
      exactInvoiceId:exactInvoice.id,
      exactBankPaymentId:exactPayment.id,
      ambiguousInvoiceIds:ambiguousInvoices.map(invoice=>invoice.id),
      ambiguousBankPaymentId:ambiguousPayment.id
    }
  });
  return{exactCustomer,exactInvoice,exactPayment,ambiguousCustomers,ambiguousInvoices,ambiguousPayment};
}


function assertSyntheticStaging(env){
  if(String(env.ROLLANDS_ENV||'').trim()!=='staging')throw new Error('Synthetic staging-bootstrap får endast köras när ROLLANDS_ENV=staging.');
  if(String(env.ROLLANDS_DATA_CLASSIFICATION||'').trim().toLowerCase()!=='synthetic')throw new Error('ROLLANDS_DATA_CLASSIFICATION måste vara synthetic.');
  if(String(env.ROLLANDS_REAL_DATA_ALLOWED||'').trim()!=='0')throw new Error('ROLLANDS_REAL_DATA_ALLOWED måste vara 0.');
  if(String(env.ROLLANDS_DEMO_DATA||'0').trim()!=='0')throw new Error('ROLLANDS_DEMO_DATA måste vara 0.');
}

function cleanupDatabaseFiles(filename){
  for(const candidate of [filename,`${filename}-wal`,`${filename}-shm`]){
    try{if(fs.existsSync(candidate))fs.rmSync(candidate,{force:true})}catch{}
  }
}

function assertFreshDatabasePath(root,filename){
  if(!path.isAbsolute(filename))throw new Error('ROLLANDS_DATABASE_PATH måste vara en absolut sökväg i staging.');
  const resolved=path.resolve(filename);
  const parent=path.dirname(resolved);
  if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory())throw new Error('Katalogen för ROLLANDS_DATABASE_PATH måste finnas innan staging-bootstrap körs.');
  const rootReal=fs.realpathSync(root);
  const parentReal=fs.realpathSync(parent);
  const relative=path.relative(rootReal,parentReal);
  if(!relative||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw new Error('ROLLANDS_DATABASE_PATH måste ligga utanför Git-repositoryt.');
  const realTarget=path.join(parentReal,path.basename(resolved));
  if(fs.existsSync(realTarget))throw new Error('Synthetic staging-bootstrap kräver en helt ny databasfil. Befintlig databas får inte återanvändas.');
  return realTarget;
}

function bootstrapSyntheticStaging({env=process.env,root=path.resolve(__dirname,'..')}={}){
  assertSyntheticStaging(env);

  const databasePath=assertFreshDatabasePath(root,required(env,'ROLLANDS_DATABASE_PATH'));

  const encryptionKey=required(env,'ROLLANDS_AUTH_ENCRYPTION_KEY');
  if(encryptionKey.length<32)throw new Error('ROLLANDS_AUTH_ENCRYPTION_KEY måste vara minst 32 tecken.');

  const credentials=SYNTHETIC_TENANTS.map(tenant=>{
    const password=required(env,tenant.passwordEnv);
    Auth.assertPassword(password);
    const mfaSecret=required(env,tenant.mfaEnv);
    Auth.totpCode(mfaSecret,Date.now());
    return{tenant,password,mfaSecret};
  });

  if(credentials[0].password===credentials[1].password)throw new Error('De två syntetiska testkontona måste ha olika lösenord.');
  if(credentials[0].mfaSecret===credentials[1].mfaSecret)throw new Error('De två syntetiska testkontona måste ha olika MFA-hemligheter.');

  let db=null;
  try{
    db=Db.openDatabase(databasePath);
    Bank.initializeBankPayments(db);
    const fixtureDate=stockholmDate();
    Db.transaction(db,()=>{
      for(const [index,{tenant,password,mfaSecret}] of credentials.entries()){
        const company=Db.createCompany(db,{
          legalName:tenant.legalName,
          displayName:tenant.displayName,
          orgNumber:tenant.orgNumber
        });
        const user=Db.createUser(db,{
          username:Auth.normalizeUsername(tenant.username),
          displayName:tenant.userDisplayName,
          passwordHash:Auth.hashPassword(password),
          mfaSecretEncrypted:Auth.encryptSecret(mfaSecret,encryptionKey)
        });
        Db.addMembership(db,{companyId:company.id,userId:user.id});
        Db.appendAudit(db,{
          companyId:company.id,
          userId:user.id,
          action:'SYNTHETIC_STAGING_BOOTSTRAP',
          entityType:'company',
          entityId:company.id,
          details:{dataClassification:'synthetic',fixtureName:tenant.displayName}
        });
        seedSyntheticUatBusinessData(db,{company,user,index,bookingDate:fixtureDate});
      }
    });
    db.close();db=null;
    fs.chmodSync(databasePath,0o600);
    return Object.freeze({
      databasePath,
      companies:SYNTHETIC_TENANTS.map(tenant=>Object.freeze({
        displayName:tenant.displayName,
        orgNumber:tenant.orgNumber,
        username:tenant.username
      }))
    });
  }catch(error){
    try{db?.close()}catch{}
    cleanupDatabaseFiles(databasePath);
    throw error;
  }
}

function main(){
  if(!process.argv.includes('--apply')){
    console.log('Ingen databas skapad. Kör med --apply först när staging-secrets och sökvägen är kontrollerade.');
    process.exitCode=2;
    return;
  }
  const result=bootstrapSyntheticStaging();
  console.log('Syntetisk stagingdatabas skapad.');
  for(const company of result.companies)console.log(`- ${company.displayName}: ${company.username}`);
  console.log(`Databas: ${result.databasePath}`);
  console.log('Lösenord, MFA-hemligheter och krypteringsnyckel har inte skrivits till loggen.');
}

if(require.main===module){
  try{main()}catch(error){console.error(error.message);process.exitCode=1}
}

module.exports={SYNTHETIC_TENANTS,assertSyntheticStaging,assertFreshDatabasePath,bootstrapSyntheticStaging,cleanupDatabaseFiles,stockholmDate,seedSyntheticUatBusinessData};
