const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb, SCHEMA_VERSION } = require('./open');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tgdb-')), 'state.db');
}

test('новая база получает схему и номер версии', () => {
  const db = openDb(tempFile());
  assert.strictEqual({ ...db.prepare('PRAGMA user_version').get() }.user_version, SCHEMA_VERSION);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
  assert.ok(tables.includes('forward_cursor'));
  assert.ok(tables.includes('reply_answered'));
  assert.ok(tables.includes('status'));
  db.close();
});

test('повторное открытие не пересоздаёт таблицы и не теряет данные', () => {
  const file = tempFile();
  const first = openDb(file);
  first.prepare('INSERT INTO forward_cursor(chat_key, last_id) VALUES(?, ?)').run('c1', 7);
  first.close();
  const second = openDb(file);
  assert.strictEqual({ ...second.prepare('SELECT last_id FROM forward_cursor WHERE chat_key=?').get('c1') }.last_id, 7);
  second.close();
});

test('база открывается в режиме WAL', () => {
  const db = openDb(tempFile());
  assert.strictEqual({ ...db.prepare('PRAGMA journal_mode').get() }.journal_mode, 'wal');
  db.close();
});

test('readOnly отбивает запись', () => {
  const file = tempFile();
  openDb(file).close();
  const db = openDb(file, { readOnly: true });
  assert.throws(() => db.prepare('INSERT INTO forward_cursor(chat_key) VALUES(?)').run('c1'), /readonly/i);
  db.close();
});
