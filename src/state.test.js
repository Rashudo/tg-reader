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
