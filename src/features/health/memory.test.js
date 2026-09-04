const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadMemory, saveMemory, EMPTY_MEMORY } = require('./memory');

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-')), 'alert-state.json');

test('отсутствующий файл даёт пустую память, а не исключение', () => {
  assert.deepStrictEqual(loadMemory(path.join(os.tmpdir(), 'нет-такого.json')), EMPTY_MEMORY);
});

test('битый файл тоже даёт пустую память', () => {
  const file = tempFile();
  fs.writeFileSync(file, '{ это не json');
  assert.deepStrictEqual(loadMemory(file), EMPTY_MEMORY);
});

test('записанное читается обратно', () => {
  const file = tempFile();
  saveMemory({ ...EMPTY_MEMORY, lastKind: 'stall', lastAlertAt: 1000 }, file);
  const memory = loadMemory(file);
  assert.strictEqual(memory.lastKind, 'stall');
  assert.strictEqual(memory.lastAlertAt, 1000);
});

test('незнакомые поля из файла не затирают известные', () => {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify({ lastKind: 'dead' }));
  const memory = loadMemory(file);
  assert.strictEqual(memory.lastKind, 'dead');
  assert.strictEqual(memory.seenRestarts, 0, 'недостающие поля берутся из пустой памяти');
});

test('запись атомарна — временный файл не остаётся', () => {
  const file = tempFile();
  saveMemory(EMPTY_MEMORY, file);
  assert.strictEqual(fs.existsSync(`${file}.tmp`), false);
  assert.strictEqual(fs.existsSync(file), true);
});
