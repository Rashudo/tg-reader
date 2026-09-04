const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createStatusWriter, readStatus, STATUS_CONTRACT } = require('./status');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), 'state.db');
}

const snapshot = {
  startedAt: 1000,
  forwarding: true,
  digestEnabled: true,
  repliesEnabled: false,
  lastPostAt: 5000,
  probeOkAt: 6000,
  checked: 12,
  forwarded: 3,
};

test('записанный статус читается снаружи как есть', () => {
  const file = tempFile();
  const db = openDb(file);
  createStatusWriter(db).write(snapshot, 9000);
  db.close();
  const result = readStatus(file);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status.updatedAt, 9000);
  assert.strictEqual(result.status.forwarding, true);
  assert.strictEqual(result.status.repliesEnabled, false);
  assert.strictEqual(result.status.probeOkAt, 6000);
  assert.strictEqual(result.status.checked, 12);
});

test('статус переписывается, а не накапливается', () => {
  const file = tempFile();
  const db = openDb(file);
  const writer = createStatusWriter(db);
  writer.write(snapshot, 1);
  writer.write(snapshot, 2);
  assert.strictEqual({ ...db.prepare('SELECT COUNT(*) AS n FROM status').get() }.n, 1);
  db.close();
  assert.strictEqual(readStatus(file).status.updatedAt, 2);
});

test('незнакомая версия контракта — отказ, а не молчаливое согласие', () => {
  const file = tempFile();
  const db = openDb(file);
  createStatusWriter(db).write(snapshot, 9000);
  db.prepare('UPDATE status SET contract = ? WHERE id = 1').run(STATUS_CONTRACT + 1);
  db.close();
  const result = readStatus(file);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /контракт/i);
});

test('база без единой записи статуса — тоже отказ', () => {
  const file = tempFile();
  openDb(file).close();
  const result = readStatus(file);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /статус/i);
});

test('нечитаемый файл не роняет проверку', () => {
  const result = readStatus(path.join(os.tmpdir(), 'нет-такого-файла.db'));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(typeof result.reason, 'string');
});

test('readStatus открывает базу только на чтение', () => {
  const file = tempFile();
  const db = openDb(file);
  createStatusWriter(db).write(snapshot, 1);
  db.close();
  readStatus(file);
  const after = openDb(file, { readOnly: true });
  assert.strictEqual({ ...after.prepare('SELECT updated_at FROM status WHERE id=1').get() }.updated_at, 1);
});
