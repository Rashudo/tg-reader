const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createState, SENT_MEMORY } = require('./state');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-state-')), 'state.json');
}

test('позиция сохраняется и переживает перезапуск', () => {
  const file = tmpFile();
  const state = createState(file);
  assert.strictEqual(state.lastId('-1001'), null);
  state.advance('-1001', 42);
  state.flush();
  assert.strictEqual(createState(file).lastId('-1001'), 42);
});

test('позиция только растёт', () => {
  const state = createState(tmpFile());
  state.advance('-1001', 42);
  state.advance('-1001', 10);
  assert.strictEqual(state.lastId('-1001'), 42);
});

test('битый файл не роняет запуск', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'не json');
  assert.strictEqual(createState(file).lastId('-1001'), null);
});

test('нечисловые значения игнорируются', () => {
  const state = createState(tmpFile());
  state.advance('-1001', undefined);
  state.advance('-1001', 1.5);
  assert.strictEqual(state.lastId('-1001'), null);
});

test('отправленное помнится после перезапуска — правка поста не даёт дубль', () => {
  const file = tmpFile();
  const state = createState(file);
  assert.strictEqual(state.wasSent('-1001', 500), false);
  state.markSent('-1001', 500);
  state.flush();

  const restarted = createState(file);
  assert.strictEqual(restarted.wasSent('-1001', 500), true);
  assert.strictEqual(restarted.wasSent('-1001', 501), false);
});

test('память об отправленных ограничена и вытесняет самое старое', () => {
  const state = createState(tmpFile());
  for (let id = 1; id <= SENT_MEMORY + 10; id += 1) state.markSent('-1001', id);
  assert.strictEqual(state.wasSent('-1001', 1), false);
  assert.strictEqual(state.wasSent('-1001', SENT_MEMORY + 10), true);
});

test('каналы не мешают друг другу', () => {
  const state = createState(tmpFile());
  state.markSent('-1001', 7);
  state.advance('-1001', 7);
  assert.strictEqual(state.wasSent('-1002', 7), false);
  assert.strictEqual(state.lastId('-1002'), null);
});

test('старый формат файла (просто число) читается без потери позиции', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ '-1001570959321': 692664 }));
  const state = createState(file);
  assert.strictEqual(state.lastId('-1001570959321'), 692664);
  assert.strictEqual(state.wasSent('-1001570959321', 692664), false);
});

test('время последнего сообщения запоминается и растёт только вперёд', () => {
  const state = createState(tmpFile());
  state.noteSeen('-1001', 1, 5000);
  state.noteSeen('-1001', 1, 3000);
  assert.strictEqual(state.lastMessageAt(), 5000);
});

test('время последнего сообщения — максимум по всем каналам', () => {
  const state = createState(tmpFile());
  state.noteSeen('-1001', 1, 5000);
  state.noteSeen('-1002', 1, 9000);
  assert.strictEqual(state.lastMessageAt(), 9000);
});

test('пока не видели ни одного сообщения, времени нет', () => {
  assert.strictEqual(createState(tmpFile()).lastMessageAt(), null);
});

test('счётчики проверенного и пересланного переживают перезапуск', () => {
  const file = tmpFile();
  const state = createState(file);
  state.noteSeen('-1001', 8, 1000);
  state.markSent('-1001', 500);
  state.markSent('-1001', 501);
  state.flush();
  assert.deepStrictEqual(createState(file).totals(), { checked: 8, forwarded: 2 });
});

test('счётчики суммируются по каналам', () => {
  const state = createState(tmpFile());
  state.noteSeen('-1001', 3, 1000);
  state.noteSeen('-1002', 4, 1000);
  assert.strictEqual(state.totals().checked, 7);
});

test('файл прежней версии читается, счётчики начинаются с нуля', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ '-1001': { lastId: 10, sent: [1, 2] } }));
  const state = createState(file);
  assert.strictEqual(state.lastId('-1001'), 10);
  assert.deepStrictEqual(state.totals(), { checked: 0, forwarded: 0 });
  assert.strictEqual(state.lastMessageAt(), null);
});

test('время старта сервиса хранится и переживает перезапуск', () => {
  const file = tmpFile();
  const state = createState(file);
  assert.strictEqual(state.startedAt(), null);
  state.setStartedAt(1700000000000);
  state.flush();
  assert.strictEqual(createState(file).startedAt(), 1700000000000);
});

test('служебная запись не попадает в счётчики и во время сообщений', () => {
  const file = tmpFile();
  const state = createState(file);
  state.setStartedAt(1700000000000);
  state.noteSeen('-1001', 2, 5000);
  state.flush();

  const restarted = createState(file);
  assert.deepStrictEqual(restarted.totals(), { checked: 2, forwarded: 0 });
  assert.strictEqual(restarted.lastMessageAt(), 5000);
  assert.strictEqual(restarted.lastId('_service'), null);
});
