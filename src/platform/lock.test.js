const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { takeLock } = require('./lock');

const tempLock = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lock-')), 'tg.lock');

test('свободный замок берётся', () => {
  const taken = takeLock(tempLock());
  assert.strictEqual(taken.ok, true);
  taken.release();
});

test('занятый живым процессом замок не отдаётся', () => {
  const file = tempLock();
  const first = takeLock(file);
  const second = takeLock(file);
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.holder, process.pid);
  first.release();
});

test('после release замок свободен', () => {
  const file = tempLock();
  takeLock(file).release();
  assert.strictEqual(takeLock(file).ok, true);
});

test('протухший замок мёртвого процесса перехватывается', () => {
  const file = tempLock();
  fs.writeFileSync(file, '999999');
  assert.strictEqual(takeLock(file).ok, true, 'pid, которого нет, не должен держать сессию вечно');
});

test('мусор вместо pid не блокирует запуск навсегда', () => {
  const file = tempLock();
  fs.writeFileSync(file, 'непонятно что');
  assert.strictEqual(takeLock(file).ok, true);
});

test('каталог замка создаётся сам', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lock-')), 'run');
  const taken = takeLock(path.join(dir, 'tg.lock'));
  assert.strictEqual(taken.ok, true);
  taken.release();
});

test('повторный release не падает', () => {
  const taken = takeLock(tempLock());
  taken.release();
  assert.doesNotThrow(() => taken.release());
});
