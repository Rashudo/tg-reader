const test = require('node:test');
const assert = require('node:assert');
const { cut, messageLink, TELEGRAM_LIMIT } = require('./text');

test('короткий текст не трогаем', () => {
  assert.strictEqual(cut('привет'), 'привет');
});

test('длинный текст обрезается до лимита с многоточием', () => {
  const result = cut('a'.repeat(TELEGRAM_LIMIT + 100));
  assert.strictEqual(result.length, TELEGRAM_LIMIT);
  assert.ok(result.endsWith('…'));
});

test('суррогатная пара не разрубается пополам', () => {
  const text = 'a'.repeat(9) + '😀' + 'b'.repeat(10);
  const result = cut(text, 11);
  assert.ok(result.length <= 11);
  assert.strictEqual(result, 'aaaaaaaaa…');
  assert.ok(!/[\ud800-\udbff]$/.test(result.slice(0, -1)));
});

test('ссылка на пост публичного и приватного канала', () => {
  assert.strictEqual(messageLink({ username: 'durov' }, 7), 'https://t.me/durov/7');
  assert.strictEqual(messageLink({ id: 123 }, 7), 'https://t.me/c/123/7');
  assert.strictEqual(messageLink(null, 7), '');
});

test('без username и id ссылки нет', () => {
  assert.strictEqual(messageLink({}, 42), '');
});

test('лимит Telegram объявлен здесь и больше нигде', () => {
  assert.strictEqual(TELEGRAM_LIMIT, 4096);
});
