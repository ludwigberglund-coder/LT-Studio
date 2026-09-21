'use strict';

const crypto=require('node:crypto');

const MAX_SAFE_INTEGER=Number.MAX_SAFE_INTEGER;
const IDENTIFIER=/^[A-Za-z_][A-Za-z0-9_]*$/;
const quote=value=>'"'+String(value).replaceAll('"','""')+'"';

function failure(message){
  const error=new Error(message);
  error.code='MONEY_STORAGE_INTEGRITY_ERROR';
  return error;
}

function moneyColumns(db){
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>String(row.name));
  const rows=[];
  for(const table of tables){
    if(!IDENTIFIER.test(table))throw failure('Ogiltigt tabellnamn i SQLite-schemat.');
    const columns=db.prepare(`PRAGMA table_info(${quote(table)})`).all();
    for(const column of columns){
      const name=String(column.name||'');
      if(!name.endsWith('_ore'))continue;
      if(!IDENTIFIER.test(name))throw failure('Ogiltigt kolumnnamn i SQLite-schemat.');
      rows.push({table,column:name,declaredType:String(column.type||'').trim().toUpperCase(),notNull:Boolean(column.notnull)});
    }
  }
  return rows;
}

function inspectMoneyStorage(db){
  const columns=moneyColumns(db);
  const invalidDeclarations=[];
  const violations=[];
  for(const row of columns){
    if(row.declaredType!=='INTEGER')invalidDeclarations.push({...row});
    const sql=`SELECT COUNT(*) AS count FROM ${quote(row.table)}
      WHERE ${quote(row.column)} IS NOT NULL
        AND (typeof(${quote(row.column)})<>'integer'
          OR ${quote(row.column)}>${MAX_SAFE_INTEGER}
          OR ${quote(row.column)}<-${MAX_SAFE_INTEGER})`;
    const count=Number(db.prepare(sql).get().count||0);
    if(count>0)violations.push({...row,count});
  }
  return Object.freeze({
    ok:invalidDeclarations.length===0&&violations.length===0,
    checkedColumns:columns.length,
    columns:Object.freeze(columns.map(row=>Object.freeze({...row}))),
    invalidDeclarations:Object.freeze(invalidDeclarations.map(row=>Object.freeze({...row}))),
    violations:Object.freeze(violations.map(row=>Object.freeze({...row})))
  });
}

function installMoneyStorageGuards(db){
  const report=inspectMoneyStorage(db);
  if(!report.ok){
    const locations=[...report.invalidDeclarations,...report.violations].map(row=>row.table+'.'+row.column);
    throw failure('Pengalagringen är inte säker för heltalsören i: '+[...new Set(locations)].join(', ')+'.');
  }
  const savepoint='money_guards_'+crypto.randomBytes(8).toString('hex');
  db.exec('SAVEPOINT '+savepoint);
  try{
    for(const row of report.columns){
      const suffix=crypto.createHash('sha256').update(row.table+'|'+row.column).digest('hex').slice(0,20);
      const unsafe=`NEW.${quote(row.column)} IS NOT NULL AND (
        typeof(NEW.${quote(row.column)})<>'integer'
        OR NEW.${quote(row.column)}>${MAX_SAFE_INTEGER}
        OR NEW.${quote(row.column)}<-${MAX_SAFE_INTEGER}
      )`;
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${quote('money_integer_'+suffix+'_insert')}
        BEFORE INSERT ON ${quote(row.table)}
        WHEN ${unsafe}
        BEGIN SELECT RAISE(ABORT,'MONEY_STORAGE_SAFE_INTEGER_REQUIRED'); END`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${quote('money_integer_'+suffix+'_update')}
        BEFORE UPDATE OF ${quote(row.column)} ON ${quote(row.table)}
        WHEN ${unsafe}
        BEGIN SELECT RAISE(ABORT,'MONEY_STORAGE_SAFE_INTEGER_REQUIRED'); END`);
    }
    db.exec('RELEASE SAVEPOINT '+savepoint);
    return Object.freeze({...report,installedTriggers:report.checkedColumns*2});
  }catch(error){
    try{db.exec('ROLLBACK TO SAVEPOINT '+savepoint)}catch{}
    try{db.exec('RELEASE SAVEPOINT '+savepoint)}catch{}
    throw error;
  }
}

module.exports=Object.freeze({MAX_SAFE_INTEGER,moneyColumns,inspectMoneyStorage,installMoneyStorageGuards});
