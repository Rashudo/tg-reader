const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createRepliesStore } = require('./store');

const DAY_MS = 24 * 60 * 60 * 1000;

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rep-')), 'state.db');
}

function store() {
  return createRepliesStore(openDb(tempFile()));
}

test('по умолчанию автоответы включены', () => {
  assert.strictEqual(store().enabled(), true);
});

test('выключение переживает пересоздание store на том же файле', () => {
  const file = tempFile();
  createRepliesStore(openDb(file)).setEnabled(false);
  assert.strictEqual(createRepliesStore(openDb(file)).enabled(), false);
});

test('счётчики обнуляются при смене суток', () => {
  const s = store();
  s.noteReply('addressed', 1000, '2026-9-4');
  assert.strictEqual(s.counters('2026-9-4').addressed, 1);
  assert.deepStrictEqual(s.counters('2026-9-5'), { addressed: 0, spontaneous: 0, lastAddressedAt: 0, lastSpontaneousAt: 0 });
});

test('спонтанные и адресные считаются раздельно', () => {
  const s = store();
  s.noteReply('addressed', 1000, 'd');
  s.noteReply('spontaneous', 2000, 'd');
  const counters = s.counters('d');
  assert.strictEqual(counters.addressed, 1);
  assert.strictEqual(counters.spontaneous, 1);
  assert.strictEqual(counters.lastAddressedAt, 1000);
  assert.strictEqual(counters.lastSpontaneousAt, 2000);
});

test('новые сутки обнуляют счётчик, а не продолжают его', () => {
  const s = store();
  s.noteReply('addressed', 1000, 'вчера');
  s.noteReply('addressed', 2000, 'сегодня');
  assert.strictEqual(s.counters('сегодня').addressed, 1);
});

test('сброс обнуляет счётчики, не трогая флаг', () => {
  const s = store();
  s.noteReply('addressed', 1000, 'd');
  s.resetCounters();
  assert.strictEqual(s.counters('d').addressed, 0);
  assert.strictEqual(s.enabled(), true);
});

test('на сообщение отвечают один раз, и это переживает перезапуск', () => {
  const file = tempFile();
  const first = createRepliesStore(openDb(file));
  assert.strictEqual(first.wasAnswered(42), false);
  first.noteAnswered(42, 1000);
  assert.strictEqual(createRepliesStore(openDb(file)).wasAnswered(42), true);
});

test('память об отвеченных чистится по возрасту', () => {
  const s = store();
  s.noteAnswered(1, 1000);
  s.noteAnswered(2, 1000 + 200 * DAY_MS);
  assert.strictEqual(s.wasAnswered(1), false);
  assert.strictEqual(s.wasAnswered(2), true);
});

test('помнятся восемь последних реплик, новейшие первыми', () => {
  const s = store();
  for (let i = 1; i <= 10; i += 1) s.noteSaid(`реплика ${i}`, i);
  const recent = s.recent(8);
  assert.strictEqual(recent.length, 8);
  assert.strictEqual(recent[0], 'реплика 10');
  assert.ok(!recent.includes('реплика 1'));
});

test('пустая реплика не запоминается', () => {
  const s = store();
  s.noteSaid('   ', 1);
  s.noteSaid('', 2);
  assert.deepStrictEqual(s.recent(8), []);
});

test('смещение бота хранится и переживает перезапуск', () => {
  const file = tempFile();
  const first = createRepliesStore(openDb(file));
  assert.strictEqual(first.botOffset(), 0);
  first.setBotOffset(12345);
  assert.strictEqual(createRepliesStore(openDb(file)).botOffset(), 12345);
});
