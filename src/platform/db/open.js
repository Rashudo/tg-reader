const { DatabaseSync } = require('node:sqlite');
const { apply, SCHEMA_VERSION } = require('./migrations');

function openDb(file, { readOnly = false } = {}) {
  const db = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
  if (readOnly) return db;
  db.exec('PRAGMA journal_mode = WAL');
  apply(db);
  return db;
}

module.exports = { openDb, SCHEMA_VERSION };
