const test = require('node:test');
const assert = require('node:assert');
const { checkSetup } = require('./preflight');

const base = { session: 'сессия', channels: ['@ch'], keywordsCount: 5, newsConfigured: false };

test('всё настроено — работает пересылка', () => {
  assert.deepStrictEqual(checkSetup(base), { error: null, warning: null, forwarding: true, news: false, replies: false });
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

test('автоответы сами по себе — уже повод запуститься', () => {
  const setup = checkSetup({ session: 'x', channels: [], keywordsCount: 0, newsConfigured: false, repliesConfigured: true });
  assert.strictEqual(setup.error, null);
  assert.strictEqual(setup.replies, true);
});

test('без автоответов и всего прочего сервису делать нечего', () => {
  const setup = checkSetup({ session: 'x', channels: [], keywordsCount: 0, newsConfigured: false, repliesConfigured: false });
  assert.match(setup.error, /Нечего делать/);
  assert.strictEqual(setup.replies, false);
});

test('пустые ключевые слова не мешают автоответам', () => {
  const setup = checkSetup({ session: 'x', channels: ['a'], keywordsCount: 0, newsConfigured: false, repliesConfigured: true });
  assert.strictEqual(setup.error, null);
  assert.match(setup.warning, /автоответы/i);
});

test('REPLY_ENABLED=off глушит ответы даже при заданном чате', () => {
  const setup = checkSetup({ session: 'x', channels: ['a'], keywordsCount: 1, newsConfigured: false, repliesConfigured: true, repliesEnabled: false });
  assert.strictEqual(setup.replies, false);
});
