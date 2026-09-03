const test = require('node:test');
const assert = require('node:assert');
const { checkSetup } = require('./preflight');

const base = { session: 'сессия', channels: ['@ch'], keywordsCount: 5, newsConfigured: false };

test('всё настроено — работает пересылка', () => {
  assert.deepStrictEqual(checkSetup(base), { error: null, warning: null, forwarding: true, news: false });
});

test('без сессии не работает ничего', () => {
  assert.match(checkSetup({ ...base, session: '' }).error, /TG_SESSION/);
});

test('слов нет, сводки нет — это ошибка настройки', () => {
  assert.match(checkSetup({ ...base, keywordsCount: 0 }).error, /ключевого слова/i);
});

test('слов нет, но сводка настроена — работаем без пересылки и предупреждаем', () => {
  const result = checkSetup({ ...base, keywordsCount: 0, newsConfigured: true });
  assert.strictEqual(result.error, null, 'рабочую сводку нельзя убивать из-за выключенных слов');
  assert.match(result.warning, /ключев/i);
  assert.strictEqual(result.forwarding, false);
  assert.strictEqual(result.news, true);
});

test('только сводка, CHANNEL пуст — молча и правильно', () => {
  const result = checkSetup({ ...base, channels: [], keywordsCount: 0, newsConfigured: true });
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.forwarding, false);
});

test('не настроено ничего — ошибка с обоими именами переменных', () => {
  const { error } = checkSetup({ ...base, channels: [], keywordsCount: 0, newsConfigured: false });
  assert.match(error, /CHANNEL/);
  assert.match(error, /NEWS_CHANNELS/);
});
