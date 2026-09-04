const test = require('node:test');
const assert = require('node:assert');
const { withTimeout } = require('./async');

const sleep = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('успевший промис возвращает результат', async () => {
  assert.strictEqual(await withTimeout(sleep(5, 'ok'), 200, 'таймаут'), 'ok');
});

test('зависший промис падает с понятным сообщением', async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 20, 'не удалось подключиться'),
    /не удалось подключиться/
  );
});

test('таймер снимается, и процесс не остаётся жить из-за него', async () => {
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  await withTimeout(sleep(5), 60 * 1000, 'таймаут');
  const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  assert.strictEqual(after, before);
});

test('ошибка исходного промиса пробрасывается как есть', async () => {
  await assert.rejects(() => withTimeout(Promise.reject(new Error('сеть')), 200, 'таймаут'), /сеть/);
});
