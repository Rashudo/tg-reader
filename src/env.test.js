const test = require('node:test');
const assert = require('node:assert');
const { numFromEnv, hourOrOff } = require('./env');

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

const { listFromEnv } = require('./env');

test('список через запятую разбирается, пробелы обрезаются', () => {
  assert.deepStrictEqual(listFromEnv(' Телевизоры , Клавишные '), ['Телевизоры', 'Клавишные']);
});

test('пустые элементы и лишние запятые отбрасываются', () => {
  assert.deepStrictEqual(listFromEnv('А,,Б,'), ['А', 'Б']);
});

test('незаданная переменная даёт пустой список', () => {
  assert.deepStrictEqual(listFromEnv(undefined), []);
  assert.deepStrictEqual(listFromEnv(''), []);
  assert.deepStrictEqual(listFromEnv('  ,  '), []);
});

test('час суточной сводки выключен, пока его не задали', () => {
  assert.strictEqual(hourOrOff(undefined), null);
  assert.strictEqual(hourOrOff(''), null);
  assert.strictEqual(hourOrOff('off'), null);
  assert.strictEqual(hourOrOff('9'), 9);
  assert.strictEqual(hourOrOff('0'), 0);
  assert.strictEqual(hourOrOff('25'), null);
});
