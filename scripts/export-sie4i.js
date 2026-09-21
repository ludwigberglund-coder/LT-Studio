'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const SIE=require('../lib/sie4i-sqlite.js');
const pkg=require('../package.json');

function argument(name,argv=process.argv){
  const prefix=`--${name}=`;
  const value=argv.find(item=>item.startsWith(prefix));
  return value?value.slice(prefix.length):'';
}
function required(value,message){
  const clean=String(value||'').trim();
  if(!clean)throw new Error(message);
  return clean;
}
function today(){return new Date().toISOString().slice(0,10)}
function sha256(buffer){return crypto.createHash('sha256').update(buffer).digest('hex')}

function main({argv=process.argv,env=process.env}={}){
  const database=path.resolve(required(
    argument('database',argv)||env.ROLLANDS_DATABASE_PATH,
    'SIE-export kräver --database=... eller ROLLANDS_DATABASE_PATH.'
  ));
  const companyId=required(argument('company-id',argv),'SIE-export kräver --company-id=... för att förhindra export från fel företag.');
  const fiscalYear=required(argument('year',argv),'SIE-export kräver --year=ÅÅÅÅ.');
  const companyType=required(argument('company-type',argv),'SIE-export kräver --company-type=... eftersom företagsform inte får gissas.');
  const output=path.resolve(required(argument('output',argv),'SIE-export kräver en explicit --output=... sökväg.'));
  const generatedAt=argument('date',argv)||today();

  if(!fs.existsSync(database))throw new Error('Den angivna SQLite-databasen finns inte.');
  if(fs.existsSync(output)||fs.existsSync(`${output}.sha256`))throw new Error('SIE-exporten eller dess checksummefil finns redan. Ingen fil skrivs över.');
  const directory=path.dirname(output);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});

  const db=new DatabaseSync(database,{readOnly:true,timeout:5000});
  let buffer;
  let count=0;
  try{
    db.exec('PRAGMA query_only = ON');
    buffer=SIE.buildSie4iFromDatabase(db,{
      companyId,
      fiscalYear,
      companyType,
      generatedAt,
      signature:'LT Studio',
      programName:'LT Studio',
      programVersion:String(pkg.version||'0.0.0'),
      currency:'SEK'
    });
    count=Number(db.prepare('SELECT count(*) AS count FROM accounting_entries WHERE company_id=? AND fiscal_year=?').get(companyId,fiscalYear)?.count||0);
  }finally{
    db.close();
  }

  fs.writeFileSync(output,buffer,{flag:'wx',mode:0o600});
  const written=fs.readFileSync(output);
  if(!written.equals(buffer)){
    try{fs.unlinkSync(output)}catch{}
    throw new Error('Den skrivna SIE-filen matchar inte det verifierade exportunderlaget. Filen togs bort.');
  }
  const digest=sha256(written);
  try{
    fs.writeFileSync(`${output}.sha256`,`${digest}  ${path.basename(output)}\n`,{flag:'wx',mode:0o600});
  }catch(error){
    try{fs.unlinkSync(output)}catch{}
    throw error;
  }

  console.log(`SIE 4I skapad från privat SQLite: ${output}`);
  console.log(`Företag: ${companyId}`);
  console.log(`Räkenskapsår: ${fiscalYear}`);
  console.log(`Verifikationer: ${count}`);
  console.log(`SHA-256: ${digest}`);
  return{output,digest,count,companyId,fiscalYear};
}

if(require.main===module){
  try{main()}catch(error){console.error(error.message);process.exitCode=1}
}
module.exports=Object.freeze({main,argument,sha256});
