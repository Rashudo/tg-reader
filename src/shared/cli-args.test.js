const test = require('node:test');
const assert = require('node:assert');
const { parseDigestArgs } = require('./cli-args');

test('без аргументов — обычный прогон', () => {
  assert.deepStrictEqual(parseDigestArgs([]), { dryRun: false, fromFile: null, error: null });
});

test('пробный прогон распознаётся', () => {
  assert.strictEqual(parseDigestArgs(['--dry-run']).dryRun, true);
});

test('файл берётся следующим аргументом', () => {
  assert.strictEqual(parseDigestArgs(['--from-file', 'сутки.json']).fromFile, 'сутки.json');
});

test('флаг без пути — ошибка, а не молчаливый боевой прогон', () => {
  const { error, fromFile } = parseDigestArgs(['--from-file']);
  assert.match(error, /путь/i);
  assert.strictEqual(fromFile, null);
});

test('вместо пути другой флаг — тоже ошибка', () => {
  assert.match(parseDigestArgs(['--from-file', '--dry-run']).error, /путь/i);
});

test('незнакомый флаг не проходит молча', () => {
  assert.match(parseDigestArgs(['--вжух']).error, /--вжух/);
});
