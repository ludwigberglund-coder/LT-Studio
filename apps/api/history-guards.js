'use strict';

// Schema identifiers only; never call this helper with HTTP input.
const quote = value => `"${String(value).replaceAll('"', '""')}"`;
function protectAppendOnly(db, table) {
  if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid history table');
  const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all();
  if (!columns.length) throw new Error(`History table missing: ${table}`);
  const keys = [columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name)];
  for (const index of db.prepare(`PRAGMA index_list(${quote(table)})`).all()) {
    if (!index.unique || index.partial) continue;
    const key = db.prepare(`PRAGMA index_info(${quote(index.name)})`).all().map(c => c.name);
    if (key.every(Boolean)) keys.push(key);
  }
  // BEFORE INSERT also catches INSERT OR REPLACE, even on connections where
  // SQLite's recursive delete triggers are disabled. Include explicit rowid.
  const conflicts = ['rowid=NEW.rowid', ...keys.filter(key => key.length).map(key =>
    `(${key.map(c => `${quote(c)}=NEW.${quote(c)}`).join(' AND ')})`)];
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${quote(`history_${table}_update`)} BEFORE UPDATE ON ${quote(table)}
      BEGIN SELECT RAISE(ABORT, 'HISTORY_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS ${quote(`history_${table}_delete`)} BEFORE DELETE ON ${quote(table)}
      BEGIN SELECT RAISE(ABORT, 'HISTORY_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS ${quote(`history_${table}_replace`)} BEFORE INSERT ON ${quote(table)}
      WHEN EXISTS (SELECT 1 FROM ${quote(table)} WHERE ${conflicts.join(' OR ')})
      BEGIN SELECT RAISE(ABORT, 'HISTORY_IMMUTABLE'); END;
  `);
}
module.exports = Object.freeze({protectAppendOnly});
