const initial = require('./001-initial');

const ALL = [initial];
const SCHEMA_VERSION = ALL[ALL.length - 1].version;

function apply(db) {
  const current = Number({ ...db.prepare('PRAGMA user_version').get() }.user_version) || 0;
  const pending = ALL.filter((migration) => migration.version > current);
  if (pending.length === 0) return current;
  db.exec('BEGIN');
  try {
    for (const migration of pending) db.exec(migration.sql);
    db.exec(`PRAGMA user_version = ${pending[pending.length - 1].version}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return pending[pending.length - 1].version;
}

module.exports = { apply, SCHEMA_VERSION };
