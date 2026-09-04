const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('./open');
const { importLegacyState } = require('./import-state-json');
const { createForwardingStore } = require('../../features/forwarding/store');
const { createDigestStore } = require('../../features/digest/store');
const { createRepliesStore } = require('../../features/replies/store');

function bench(legacy) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  const jsonFile = path.join(dir, 'state.json');
  fs.writeFileSync(jsonFile, JSON.stringify(legacy));
  return { db: openDb(path.join(dir, 'state.db')), jsonFile };
}

const legacy = {
  '-100111': {
    lastId: 900, sent: [898, 899, 900], lastMessageAt: 1700000000000,
    checked: 40, forwarded: 3, digestUpToId: null, digestRunAt: null,
  },
  '-100222': {
    lastId: null, sent: [], lastMessageAt: null,
    checked: 0, forwarded: 0, digestUpToId: 555, digestRunAt: 1700000100000,
  },
  _service: {
    startedAt: 1699999000000,
    lastDigestRunAt: 1699999900000,
    forwarding: true,
    replies: {
      enabled: false, day: '2026-9-4', addressed: 2, spontaneous: 1,
      lastAddressedAt: 1700000200000, lastSpontaneousAt: 1700000300000,
      answered: [11, 12], said: ['раз', 'два'], botOffset: 777,
    },
  },
};

test('курсоры и счётчики пересылки переносятся до последнего числа', () => {
  const { db, jsonFile } = bench(legacy);
  importLegacyState(db, jsonFile);
  const store = createForwardingStore(db);
  assert.strictEqual(store.lastId('-100111'), 900);
  assert.strictEqual(store.wasSent('-100111', 899), true);
  assert.strictEqual(store.wasSent('-100111', 1), false);
  assert.deepStrictEqual(store.totals(), { checked: 40, forwarded: 3 });
  assert.strictEqual(store.lastMessageAt(), 1700000000000);
});

test('курсор сводки переносится', () => {
  const { db, jsonFile } = bench(legacy);
  importLegacyState(db, jsonFile);
  assert.strictEqual(createDigestStore(db).upTo('-100222'), 555);
});

test('канал без своего digestRunAt берёт общий из _service', () => {
  const { db, jsonFile } = bench(legacy);
  importLegacyState(db, jsonFile);
  assert.strictEqual(createDigestStore(db).lastRunAt('-100111'), 1699999900000);
});

test('ВЫКЛЮЧЕННЫЕ АВТООТВЕТЫ ОСТАЮТСЯ ВЫКЛЮЧЕННЫМИ', () => {
  const { db, jsonFile } = bench(legacy);
  importLegacyState(db, jsonFile);
  assert.strictEqual(createRepliesStore(db).enabled(), false);
});

test('отсутствующий ключ enabled означает «включено»', () => {
  const { db, jsonFile } = bench({ _service: { replies: { botOffset: 1 } } });
  importLegacyState(db, jsonFile);
  assert.strictEqual(createRepliesStore(db).enabled(), true);
});

test('счётчики, отвеченные, сказанное и смещение бота переносятся', () => {
  const { db, jsonFile } = bench(legacy);
  importLegacyState(db, jsonFile);
  const store = createRepliesStore(db);
  const counters = store.counters('2026-9-4');
  assert.strictEqual(counters.addressed, 2);
  assert.strictEqual(counters.spontaneous, 1);
  assert.strictEqual(counters.lastAddressedAt, 1700000200000);
  assert.strictEqual(store.wasAnswered(11), true);
  assert.deepStrictEqual(store.recent(8), ['два', 'раз']);
  assert.strictEqual(store.botOffset(), 777);
});

test('перенос выполняется один раз', () => {
  const { db, jsonFile } = bench(legacy);
  assert.strictEqual(importLegacyState(db, jsonFile).imported, true);
  createForwardingStore(db).advance('-100111', 1200);
  assert.strictEqual(importLegacyState(db, jsonFile).imported, false);
  assert.strictEqual(createForwardingStore(db).lastId('-100111'), 1200, 'повторный перенос откатил бы курсор назад');
});

test('перенос не изменяет файл', () => {
  const { db, jsonFile } = bench(legacy);
  const before = fs.readFileSync(jsonFile, 'utf8');
  const stat = fs.statSync(jsonFile);
  importLegacyState(db, jsonFile);
  assert.strictEqual(fs.readFileSync(jsonFile, 'utf8'), before);
  assert.strictEqual(fs.statSync(jsonFile).mtimeMs, stat.mtimeMs);
});

test('отсутствие файла — не ошибка, а первый запуск', () => {
  const { db } = bench(legacy);
  const result = importLegacyState(db, path.join(os.tmpdir(), 'нет-такого.json'));
  assert.strictEqual(result.imported, false);
  assert.strictEqual(createRepliesStore(db).enabled(), true);
});

test('битый файл не роняет запуск', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  const jsonFile = path.join(dir, 'state.json');
  fs.writeFileSync(jsonFile, '{ это не json');
  const db = openDb(path.join(dir, 'state.db'));
  assert.doesNotThrow(() => importLegacyState(db, jsonFile, { log: () => {} }));
});
