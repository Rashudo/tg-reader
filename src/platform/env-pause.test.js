const test = require('node:test');
const assert = require('node:assert');
const { pauseMsFrom } = require('./config');

test('пауза берётся из секунд, когда они заданы', () => {
  assert.strictEqual(pauseMsFrom('30', undefined, 5), 30000);
});

test('без секунд пауза считается из минут', () => {
  assert.strictEqual(pauseMsFrom(undefined, '2', 5), 120000);
});

test('без обеих переменных берётся значение по умолчанию в минутах', () => {
  assert.strictEqual(pauseMsFrom(undefined, undefined, 5), 300000);
});

test('нулевая пауза разрешена и означает «без паузы»', () => {
  assert.strictEqual(pauseMsFrom('0', undefined, 5), 0);
});

test('мусор в секундах не ломает настройку', () => {
  assert.strictEqual(pauseMsFrom('быстро', undefined, 5), 300000);
});
