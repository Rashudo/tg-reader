const test = require('node:test');
const assert = require('node:assert');
const { createNotifier } = require('./notify');

function fake() {
  const calls = [];
  return { calls, request: async (url, body) => { calls.push({ url, body }); return { ok: true }; } };
}

test('без токена ничего не отправляется и ничего не падает', async () => {
  const t = fake();
  const notifier = createNotifier({ token: '', chatId: '123', request: t.request, log: () => {} });
  assert.strictEqual(await notifier.send('тревога'), false);
  assert.strictEqual(t.calls.length, 0);
});

test('без чата ничего не отправляется', async () => {
  const t = fake();
  const notifier = createNotifier({ token: 'abc', chatId: '', request: t.request, log: () => {} });
  assert.strictEqual(await notifier.send('тревога'), false);
  assert.strictEqual(t.calls.length, 0);
});

test('отправка идёт в sendMessage нужного бота и чата', async () => {
  const t = fake();
  const notifier = createNotifier({ token: 'ТОКЕН', chatId: '42', request: t.request, log: () => {} });
  assert.strictEqual(await notifier.send('тревога'), true);
  assert.strictEqual(t.calls.length, 1);
  assert.match(t.calls[0].url, /^https:\/\/api\.telegram\.org\/botТОКЕН\/sendMessage$/);
  assert.strictEqual(t.calls[0].body.chat_id, '42');
  assert.strictEqual(t.calls[0].body.text, 'тревога');
});

test('текст уведомления не отправляется без разметки', async () => {
  const t = fake();
  const notifier = createNotifier({ token: 'a', chatId: '1', request: t.request, log: () => {} });
  await notifier.send('цена 10__000');
  assert.strictEqual(t.calls[0].body.parse_mode, undefined);
  assert.strictEqual(t.calls[0].body.text, 'цена 10__000');
});

test('слишком длинный текст обрезается до лимита Telegram', async () => {
  const t = fake();
  const notifier = createNotifier({ token: 'a', chatId: '1', request: t.request, log: () => {} });
  await notifier.send('я'.repeat(5000));
  assert.ok(t.calls[0].body.text.length <= 4096);
});

test('недоступный Bot API не роняет вызывающий код', async () => {
  const logged = [];
  const notifier = createNotifier({
    token: 'a',
    chatId: '1',
    request: async () => { throw new Error('сеть недоступна'); },
    log: (m) => logged.push(m),
  });
  assert.strictEqual(await notifier.send('тревога'), false);
  assert.match(logged.join(' '), /сеть недоступна/);
});

test('отказ Bot API виден в логе', async () => {
  const logged = [];
  const notifier = createNotifier({
    token: 'a',
    chatId: '1',
    request: async () => ({ ok: false, description: 'chat not found' }),
    log: (m) => logged.push(m),
  });
  assert.strictEqual(await notifier.send('тревога'), false);
  assert.match(logged.join(' '), /chat not found/);
});

test('кнопки уходят в Bot API как inline-клавиатура', async () => {
  const calls = [];
  const notifier = createNotifier({
    token: 't',
    chatId: '7',
    request: async (url, body) => {
      calls.push({ url, body });
      return { ok: true };
    },
  });
  await notifier.send('готово', { buttons: [[{ text: 'Больше не отвечать', data: 'replies:off' }]] });
  assert.deepStrictEqual(calls[0].body.reply_markup, {
    inline_keyboard: [[{ text: 'Больше не отвечать', callback_data: 'replies:off' }]],
  });
});

test('без кнопок клавиатура не отправляется', async () => {
  const calls = [];
  const notifier = createNotifier({ token: 't', chatId: '7', request: async (url, body) => { calls.push(body); return { ok: true }; } });
  await notifier.send('готово');
  assert.strictEqual(calls[0].reply_markup, undefined);
});
