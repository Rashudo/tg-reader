const test = require('node:test');
const assert = require('node:assert');
const { serviceSetup } = require('./config');

const base = {
  session: 'сессия',
  channels: ['@ch'],
  keywordsCount: 5,
  anthropicKey: '',
  newsChannels: [],
  repliesChat: '',
  repliesEnabled: true,
};

test('всё настроено — работает пересылка', () => {
  const setup = serviceSetup(base);
  assert.strictEqual(setup.error, null);
  assert.strictEqual(setup.warning, null);
  assert.strictEqual(setup.features.forwarding.on, true);
  assert.strictEqual(setup.features.digest.on, false);
  assert.strictEqual(setup.features.replies.on, false);
});

test('без сессии не работает ничего', () => {
  assert.match(serviceSetup({ ...base, session: '' }).error, /TG_SESSION/);
});

test('слов нет, сводки нет — это ошибка настройки', () => {
  assert.match(serviceSetup({ ...base, keywordsCount: 0 }).error, /ключевого слова/i);
});

test('слов нет, но сводка настроена — работаем без пересылки и предупреждаем', () => {
  const setup = serviceSetup({ ...base, keywordsCount: 0, anthropicKey: 'k', newsChannels: ['@n'] });
  assert.strictEqual(setup.error, null, 'рабочую сводку нельзя убивать из-за выключенных слов');
  assert.match(setup.warning, /ключев/i);
  assert.strictEqual(setup.features.forwarding.on, false);
  assert.strictEqual(setup.features.digest.on, true);
});

test('только сводка, CHANNEL пуст — молча и правильно', () => {
  const setup = serviceSetup({ ...base, channels: [], keywordsCount: 0, anthropicKey: 'k', newsChannels: ['@n'] });
  assert.strictEqual(setup.error, null);
  assert.strictEqual(setup.warning, null, 'пустой CHANNEL — это не «слова выключены»');
  assert.strictEqual(setup.features.forwarding.on, false);
});

test('не настроено ничего — ошибка со всеми тремя именами переменных', () => {
  const { error } = serviceSetup({ ...base, channels: [], keywordsCount: 0 });
  assert.match(error, /CHANNEL/);
  assert.match(error, /NEWS_CHANNELS/);
  assert.match(error, /REPLY_CHAT/);
});

test('автоответы сами по себе — уже повод запуститься', () => {
  const setup = serviceSetup({ ...base, channels: [], keywordsCount: 0, anthropicKey: 'k', repliesChat: '@chat' });
  assert.strictEqual(setup.error, null);
  assert.strictEqual(setup.features.replies.on, true);
});

test('пустые ключевые слова не мешают автоответам', () => {
  const setup = serviceSetup({ ...base, keywordsCount: 0, anthropicKey: 'k', repliesChat: '@chat' });
  assert.strictEqual(setup.error, null);
  assert.match(setup.warning, /автоответы/i);
});

test('REPLY_ENABLED=off глушит ответы даже при заданном чате', () => {
  const setup = serviceSetup({ ...base, anthropicKey: 'k', repliesChat: '@chat', repliesEnabled: false });
  assert.strictEqual(setup.features.replies.on, false);
  assert.match(setup.features.replies.why, /REPLY_ENABLED/);
});

test('у каждой выключенной фичи есть причина, а у включённой её нет', () => {
  const setup = serviceSetup(base);
  assert.strictEqual(setup.features.forwarding.why, null);
  assert.match(setup.features.digest.why, /ANTHROPIC_API_KEY/);
  assert.match(setup.features.replies.why, /REPLY_CHAT/);
});

test('сводка без ключа модели выключена по причине ключа, а не каналов', () => {
  const setup = serviceSetup({ ...base, newsChannels: ['@n'] });
  assert.match(setup.features.digest.why, /ANTHROPIC_API_KEY/);
});

test('автоответы без ключа модели выключены по причине ключа', () => {
  const setup = serviceSetup({ ...base, repliesChat: '@chat' });
  assert.match(setup.features.replies.why, /ANTHROPIC_API_KEY/);
});
