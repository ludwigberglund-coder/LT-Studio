'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Db=require('../apps/api/database.js');
const Auth=require('../apps/api/auth.js');
const Accounting=require('../apps/api/accounting-store.js');

function seed(){const db=Db.openDatabase(':memory:');Accounting.initializeAccountingStore(db);const company=Db.createCompany(db,{legalName:'Journaltest AB',displayName:'Journaltest',orgNumber:'559900-3030'});const user=Db.createUser(db,{username:'journal',displayName:'Journal Test',passwordHash:Auth.hashPassword('Journal testlosenord 2026!')});return{db,company,user}}
function post(db,company,user,date,sourceId){return Accounting.postEntry(db,{companyId:company.id,postingDate:date,description:`Test ${sourceId}`,sourceType:'test',sourceId,createdBy:user.id,series:'A',lines:[{account:'1930',debitOre:10000,creditOre:0},{account:'2990',debitOre:0,creditOre:10000}]})}

test('verifikationsserien löper inom året och kan börja om nästa räkenskapsår',()=>{const {db,company,user}=seed();try{assert.equal(post(db,company,user,'2026-12-31','s1').entry.number,'A1');assert.equal(post(db,company,user,'2026-12-31','s2').entry.number,'A2');assert.equal(post(db,company,user,'2027-01-01','s3').entry.number,'A1');assert.equal(Accounting.listEntries(db,company.id).length,3);}finally{db.close()}});
test('samma källpost kan inte skapa dubbla verifikationer',()=>{const {db,company,user}=seed();try{const first=post(db,company,user,'2026-09-16','same');const second=post(db,company,user,'2026-09-16','same');assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);assert.equal(first.entry.id,second.entry.id);assert.equal(Accounting.listEntries(db,company.id).length,1);}finally{db.close()}});
test('obalanserad post och låst period stoppas',()=>{const {db,company,user}=seed();try{assert.throws(()=>Accounting.postEntry(db,{companyId:company.id,postingDate:'2026-09-16',description:'Obalanserad',sourceType:'test',sourceId:'bad',createdBy:user.id,lines:[{account:'1930',debitOre:10000,creditOre:0},{account:'2990',debitOre:0,creditOre:9000}]}),e=>e.code==='UNBALANCED_ENTRY');db.prepare(`INSERT INTO accounting_periods(company_id,period,status) VALUES(?,?,'locked')`).run(company.id,'2026-09');assert.throws(()=>post(db,company,user,'2026-09-16','locked'),e=>e.code==='PERIOD_LOCKED');}finally{db.close()}});

// Fault injection exercises the persistence boundary, not only validation.
function input(company, user, overrides = {}) {
  return {
    companyId: company.id, createdBy: user.id, postingDate: '2026-09-18',
    description: 'Pilot atomic posting', sourceType: 'pilot-test', sourceId: 'once', series: 'A',
    lines: [{account:'1930', debitOre:12500, creditOre:0}, {account:'1510', debitOre:0, creditOre:12500}],
    ...overrides
  };
}
function counts(db) {
  return {
    entries: db.prepare('SELECT COUNT(*) AS n FROM accounting_entries').get().n,
    lines: db.prepare('SELECT COUNT(*) AS n FROM accounting_entry_lines').get().n,
    sequence: db.prepare('SELECT last_number AS n FROM accounting_sequences').get()?.n || 0
  };
}
function failSecondLine(db) {
  db.exec(`CREATE TEMP TRIGGER fail_second_line BEFORE INSERT ON accounting_entry_lines
    WHEN NEW.line_number=2 BEGIN SELECT RAISE(ABORT, 'injected line failure'); END;`);
}

test('failed second line rolls back header, lines and sequence without caller transaction', () => {
  const {db, company, user} = seed();
  try {
    failSecondLine(db);
    assert.throws(() => Accounting.postEntry(db, input(company, user)), /injected line failure/);
    assert.deepEqual(counts(db), {entries:0, lines:0, sequence:0});
    db.exec('DROP TRIGGER fail_second_line');
    const retry = Accounting.postEntry(db, input(company, user));
    assert.equal(retry.duplicate, false);
    assert.equal(retry.entry.number, 'A1');
    assert.equal(retry.entry.lines.length, 2);
  } finally { db.close(); }
});

test('failed post preserves an existing sequence and retry takes the next number', () => {
  const {db, company, user} = seed();
  try {
    Accounting.postEntry(db, input(company, user, {sourceId:'first'}));
    failSecondLine(db);
    assert.throws(() => Accounting.postEntry(db, input(company, user)), /injected line failure/);
    assert.deepEqual(counts(db), {entries:1, lines:2, sequence:1});
    db.exec('DROP TRIGGER fail_second_line');
    assert.equal(Accounting.postEntry(db, input(company, user)).entry.number, 'A2');
  } finally { db.close(); }
});

test('inner posting does not commit the surrounding business transaction', () => {
  const {db, company, user} = seed();
  try {
    assert.throws(() => Db.transaction(db, () => {
      Accounting.postEntry(db, input(company, user));
      throw new Error('business operation failed after posting');
    }), /business operation failed/);
    assert.deepEqual(counts(db), {entries:0, lines:0, sequence:0});
    assert.equal(Accounting.postEntry(db, input(company, user)).entry.number, 'A1');
  } finally { db.close(); }
});

test('caught posting failure leaves unrelated work in outer transaction intact', () => {
  const {db, company, user} = seed();
  try {
    Db.transaction(db, () => {
      Db.createCustomer(db, {companyId:company.id, customerNumber:'TEST-1', name:'Test customer'});
      failSecondLine(db);
      assert.throws(() => Accounting.postEntry(db, input(company, user)), /injected line failure/);
      assert.deepEqual(counts(db), {entries:0, lines:0, sequence:0});
      db.exec('DROP TRIGGER fail_second_line');
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 1);
    assert.equal(Accounting.postEntry(db, input(company, user)).entry.number, 'A1');
  } finally { db.close(); }
});

test('same source with changed amount, accounts, date, text or series is a conflict', () => {
  const {db, company, user} = seed();
  try {
    const first = Accounting.postEntry(db, input(company, user)).entry;
    const variants = [
      {postingDate:'2026-09-19'}, {description:'Changed description'}, {series:'B'},
      {lines:[{account:'1930', debitOre:13000}, {account:'1510', creditOre:13000}]},
      {lines:[{account:'1910', debitOre:12500}, {account:'1510', creditOre:12500}]},
      {lines:[{account:'1930', text:'Changed line text', debitOre:12500}, {account:'1510', creditOre:12500}]}
    ];
    for (const overrides of variants) {
      assert.throws(() => Accounting.postEntry(db, input(company, user, overrides)), error =>
        error.code === 'IDEMPOTENCY_CONFLICT' && error.statusCode === 409);
    }
    assert.deepEqual(counts(db), {entries:1, lines:2, sequence:1});
    assert.deepEqual(Accounting.entryBySource(db, company.id, 'pilot-test', 'once'), first);
    assert.equal(Accounting.postEntry(db, input(company, user)).duplicate, true);
  } finally { db.close(); }
});

test('exact retry after a period lock returns original instead of booking again', () => {
  const {db, company, user} = seed();
  try {
    const first = Accounting.postEntry(db, input(company, user)).entry;
    db.prepare("INSERT INTO accounting_periods(company_id,period,status) VALUES(?,?,'locked')").run(company.id, '2026-09');
    const retry = Accounting.postEntry(db, input(company, user));
    assert.equal(retry.duplicate, true);
    assert.equal(retry.entry.id, first.id);
    assert.deepEqual(counts(db), {entries:1, lines:2, sequence:1});
  } finally { db.close(); }
});

test('incomplete previously stored journal is not reported as a successful retry', () => {
  const {db, company, user} = seed();
  try {
    const first = Accounting.postEntry(db, input(company, user)).entry;
    // Simulates a pre-existing damaged file; this is not an application action.
    db.exec('DROP TRIGGER history_accounting_entry_lines_delete'); // Offline corruption fixture only.
    db.prepare('DELETE FROM accounting_entry_lines WHERE entry_id=? AND line_number=2').run(first.id);
    assert.throws(() => Accounting.postEntry(db, input(company, user)), error => error.code === 'STORED_ENTRY_INTEGRITY_ERROR');
    assert.deepEqual(counts(db), {entries:1, lines:1, sequence:1});
  } finally { db.close(); }
});

test('unsafe aggregate amounts and nonnumeric input are rejected without writes', () => {
  const {db, company, user} = seed();
  try {
    const large = Number.MAX_SAFE_INTEGER;
    const overflow = [
      {account:'1930',debitOre:large}, {account:'1930',debitOre:1},
      {account:'1510',creditOre:large}, {account:'1510',creditOre:1}
    ];
    assert.throws(() => Accounting.postEntry(db, input(company, user, {lines:overflow})), error => error.code === 'ENTRY_TOTAL_TOO_LARGE');
    for (const invalid of ['12500', true, NaN, Infinity, 12.5, -1]) {
      assert.throws(() => Accounting.postEntry(db, input(company, user, {
        lines:[{account:'1930',debitOre:invalid}, {account:'1510',creditOre:12500}]
      })), error => error.code === 'INVALID_ENTRY_AMOUNT');
    }
    assert.deepEqual(counts(db), {entries:0, lines:0, sequence:0});
  } finally { db.close(); }
});
