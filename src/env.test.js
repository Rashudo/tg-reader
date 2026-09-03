const test = require('node:test');
const assert = require('node:assert');
const { numFromEnv } = require('./env');

test('число из строки читается', () => {
  assert.strictEqual(numFromEnv('30', 15), 30);
});

test('ноль — допустимое значение, а не «пусто»', () => {
  assert.strictEqual(numFromEnv('0', 9), 0);
});

test('незаданная переменная даёт значение по умолчанию', () => {
  assert.strictEqual(numFromEnv(undefined, 15), 15);
  assert.strictEqual(numFromEnv('', 15), 15);
  assert.strictEqual(numFromEnv('   ', 15), 15);
});

test('мусор не превращается в NaN, а откатывается к умолчанию', () => {
  assert.strictEqual(numFromEnv('abc', 15), 15);
  assert.strictEqual(numFromEnv('30мин', 15), 15);
});

test('отрицательные и дробные значения отвергаются', () => {
  assert.strictEqual(numFromEnv('-5', 15), 15);
  assert.strictEqual(numFromEnv('1.5', 15), 15);
});
