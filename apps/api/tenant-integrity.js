'use strict';

const crypto = require('node:crypto');
const MoneyStorage=require('./money-storage-guards.js');
// These tables are intentionally not scoped by company_id.
// companies is the tenant registry; users/auth attempt state exists above a single company.
const ROOT_SCOPE_TABLES = Object.freeze(['schema_migrations','companies','users','mfa_used_steps','login_attempts','security_events','platform_operators','platform_operator_sessions','platform_operator_mfa_used_steps','platform_operator_audit_events']);
// Identifiers come only from SQLite's schema, never from HTTP input.
const quote = value => `"${String(value).replaceAll('"', '""')}"`;
function failure(message) {
  const error = new Error(message);
  error.code = 'TENANT_INTEGRITY_ERROR';
  return error;
}
function schema(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
  const columns = new Map(tables.map(table => [table, db.prepare(`PRAGMA table_info(${quote(table)})`).all()]));
  const foreignKeys = new Map(tables.map(table => [table, db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all()]));
  const tenants = tables.filter(table => columns.get(table).some(column => column.name === 'company_id'));
  const relations = [];
  for (const table of tenants) {
    for (const fk of foreignKeys.get(table)) {
      if (!columns.get(fk.table)?.some(column => column.name === 'company_id')) continue;
      // Existing schema uses single-column IDs. Do not silently accept a future
      // composite relationship unless its tenant component is explicit.
      const group = foreignKeys.get(table).filter(row => row.id === fk.id);
      if (group.length > 1) {
        if (!group.some(row => row.from === 'company_id' && row.to === 'company_id')) {
          throw failure(`Tenant component missing from composite relationship in ${table}.`);
        }
        continue;
      }
      const pk = columns.get(fk.table).filter(column => column.pk);
      const targetColumn = fk.to || (pk.length === 1 ? pk[0].name : null);
      if (!targetColumn) throw failure(`Cannot resolve relationship in ${table}.`);
      relations.push({table, column:fk.from, targetTable:fk.table, targetColumn});
    }
  }
  return {tables, tenants, columns, foreignKeys, relations};
}
function inspectTenantCoverage(db) {
  const structure = schema(db);
  const roots = new Set(ROOT_SCOPE_TABLES.filter(table => structure.tables.includes(table)));
  const direct = new Set(structure.tenants);
  const inherited = new Map();
  const ambiguousInheritedTables = [];
  for (const table of structure.tables) {
    if (roots.has(table) || direct.has(table)) continue;
    const tableColumns = new Map(structure.columns.get(table).map(column => [column.name,column]));
    const via = structure.foreignKeys.get(table)
      .filter(fk => {
        const column = tableColumns.get(fk.from);
        return Boolean(column && (column.notnull || column.pk) && direct.has(fk.table));
      })
      .map(fk => {
        const targetColumns=structure.columns.get(fk.table);
        const pk=targetColumns.filter(column=>column.pk);
        return {column:fk.from,targetTable:fk.table,targetColumn:fk.to || (pk.length===1?pk[0].name:null)};
      })
      .filter(row=>row.targetColumn);
    if (via.length === 1) inherited.set(table,{table,via});
    else if (via.length > 1) ambiguousInheritedTables.push({table,via});
  }
  const unscopedTables = structure.tables.filter(table => !roots.has(table) && !direct.has(table) && !inherited.has(table));
  return {
    ok:unscopedTables.length===0 && ambiguousInheritedTables.length===0,
    rootTables:[...roots].sort(),
    directTenantTables:[...direct].sort(),
    inheritedTenantTables:[...inherited.values()].sort((a,b)=>a.table.localeCompare(b.table)),
    ambiguousInheritedTables:ambiguousInheritedTables.sort((a,b)=>a.table.localeCompare(b.table)),
    unscopedTables:unscopedTables.sort()
  };
}
function mismatchQuery({table, column, targetTable, targetColumn}) {
  return `SELECT COUNT(*) AS count FROM ${quote(table)} child WHERE child.${quote(column)} IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ${quote(targetTable)} parent WHERE parent.${quote(targetColumn)}=child.${quote(column)} AND parent.company_id=child.company_id)`;
}
function inspectTenantRelations(db) {
  const structure = schema(db);
  const violations = structure.relations.map(relation => ({...relation, count:db.prepare(mismatchQuery(relation)).get().count})).filter(row => row.count > 0);
  return {ok:violations.length === 0, checkedRelations:structure.relations.length, violations};
}
function installTenantGuards(db) {
  const savepoint = `tenant_guards_${crypto.randomBytes(8).toString('hex')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const coverage = inspectTenantCoverage(db);
    if (!coverage.ok) {
      const names=[...coverage.unscopedTables,...coverage.ambiguousInheritedTables.map(row=>row.table)];
      throw failure(`Tenant scope is undefined or ambiguous for: ${names.join(', ')}. Add company_id, exactly one NOT NULL foreign key to a tenant-owned parent, or explicitly classify a truly global platform table.`);
    }
    const report = inspectTenantRelations(db);
    if (!report.ok) {
      // Preserve every historical row for investigation; never repair by deletion.
      throw failure(`Existing cross-company or orphan references in: ${[...new Set(report.violations.map(row => row.table))].join(', ')}. Startup stopped; review a backup before repair.`);
    }
    const moneyStorage=MoneyStorage.installMoneyStorageGuards(db);
    const {tenants, columns, relations} = schema(db);
    for (const inherited of coverage.inheritedTenantTables) {
      const owner=inherited.via[0];
      const suffix=crypto.createHash('sha256').update(JSON.stringify({table:inherited.table,...owner})).digest('hex').slice(0,20);
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${quote(`tenant_inherited_owner_${suffix}`)} BEFORE UPDATE OF ${quote(owner.column)} ON ${quote(inherited.table)}
        WHEN NEW.${quote(owner.column)} IS NOT OLD.${quote(owner.column)} AND NOT EXISTS (
          SELECT 1 FROM ${quote(owner.targetTable)} old_parent
          JOIN ${quote(owner.targetTable)} new_parent ON new_parent.company_id=old_parent.company_id
          WHERE old_parent.${quote(owner.targetColumn)}=OLD.${quote(owner.column)}
            AND new_parent.${quote(owner.targetColumn)}=NEW.${quote(owner.column)})
        BEGIN SELECT RAISE(ABORT, 'TENANT_INHERITED_OWNER_MISMATCH'); END`);
    }
    for (const relation of relations) {
      const {table, column, targetTable, targetColumn} = relation;
      const suffix = crypto.createHash('sha256').update(JSON.stringify(relation)).digest('hex').slice(0, 20);
      for (const [kind, event] of [['insert', 'INSERT'], ['update', `UPDATE OF company_id, ${quote(column)}`]]) {
        db.exec(`CREATE TRIGGER IF NOT EXISTS ${quote(`tenant_fk_${suffix}_${kind}`)} BEFORE ${event} ON ${quote(table)}
          WHEN NEW.${quote(column)} IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM ${quote(targetTable)} parent WHERE parent.${quote(targetColumn)}=NEW.${quote(column)} AND parent.company_id=NEW.company_id)
          BEGIN SELECT RAISE(ABORT, 'TENANT_RELATION_MISMATCH'); END`);
      }
    }
    // A tenant-owned object cannot be moved to another company after creation.
    // User membership records are different: users can belong to several companies.
    for (const table of tenants) {
      const hasId = columns.get(table).some(column => column.name === 'id');
      if (!hasId) continue;
      const suffix = crypto.createHash('sha256').update(table).digest('hex').slice(0, 20);
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${quote(`tenant_owner_${suffix}`)} BEFORE UPDATE OF company_id, id ON ${quote(table)}
        WHEN NEW.company_id IS NOT OLD.company_id OR NEW.id IS NOT OLD.id
        BEGIN SELECT RAISE(ABORT, 'TENANT_OBJECT_IDENTITY_IMMUTABLE'); END`);
    }
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return {...report,coverage,moneyStorage};
  } catch (error) {
    try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch {}
    try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch {}
    throw error;
  }
}
module.exports = Object.freeze({ROOT_SCOPE_TABLES,inspectTenantCoverage,inspectTenantRelations,installTenantGuards});
