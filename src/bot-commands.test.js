const test = require('node:test');
const assert = require('node:assert');
const { createBotCommands } = require('./bot-commands');

function fakeState() {
  let enabled = true;
  let offset = 0;
  return {
    repliesEnabled: () => enabled,
    setRepliesEnabled: (on) => {
      enabled = on;
    },
    botOffset: () => offset,
    setBotOffset: (value) => {
      offset = value;
    },
    replyCounters: () => ({ addressed: 2, spontaneous: 1, lastAddressedAt: 0, lastSpontaneousAt: 0 }),
  };
}

function rig(updates, over = {}) {
  const calls = [];
  const state = over.state || fakeState();
  const bot = createBotCommands({
    token: 't',
    chatId: '7',
    state,
    timeZone: 'Europe/Belgrade',
    log: () => {},
    request: async (url, body) => {
      calls.push({ url, body });
      if (url.includes('getUpdates')) return { ok: true, result: updates };
      return { ok: true };
    },
    ...over.extra,
  });
  return { bot, state, calls };
}

test('«стоп» выключает ответы', async () => {
  const { bot, state } = rig([{ update_id: 1, message: { text: 'стоп', chat: { id: 7 } } }]);
  await bot.poll();
  assert.strictEqual(state.repliesEnabled(), false);
});

test('/start включает обратно', async () => {
  const state = fakeState();
  state.setRepliesEnabled(false);
  const { bot } = rig([{ update_id: 2, message: { text: '/start', chat: { id: 7 } } }], { state });
  await bot.poll();
  assert.strictEqual(state.repliesEnabled(), true);
});

test('кнопка под ответом выключает', async () => {
  const { bot, state, calls } = rig([
    { update_id: 3, callback_query: { id: 'cb1', data: 'replies:off', message: { chat: { id: 7 } } } },
  ]);
  await bot.poll();
  assert.strictEqual(state.repliesEnabled(), false);
  assert.ok(calls.some((call) => call.url.includes('answerCallbackQuery')));
});

test('чужой чат командовать не может', async () => {
  const { bot, state } = rig([{ update_id: 4, message: { text: 'стоп', chat: { id: 999 } } }]);
  await bot.poll();
  assert.strictEqual(state.repliesEnabled(), true);
});

test('статус отвечает состоянием и счётчиками', async () => {
  const { bot, calls } = rig([{ update_id: 9, message: { text: 'статус', chat: { id: 7 } } }]);
  await bot.poll();
  const answer = calls.find((call) => call.url.includes('sendMessage'));
  assert.match(answer.body.text, /включен/i);
  assert.match(answer.body.text, /2/);
});

test('offset двигается, старые команды не переигрываются', async () => {
  const { bot, state } = rig([{ update_id: 9, message: { text: 'статус', chat: { id: 7 } } }]);
  await bot.poll();
  assert.strictEqual(state.botOffset(), 10);
});

test('незнакомая команда не роняет опрос', async () => {
  const { bot } = rig([{ update_id: 5, message: { text: 'привет', chat: { id: 7 } } }]);
  await bot.poll();
});

test('ошибка сети не роняет опрос', async () => {
  const { bot } = rig([], {
    extra: {
      request: async () => {
        throw new Error('сеть');
      },
    },
  });
  await bot.poll();
});

test('без токена опрос не делается', async () => {
  const calls = [];
  const bot = createBotCommands({
    token: '',
    chatId: '',
    state: fakeState(),
    request: async (url) => {
      calls.push(url);
      return { ok: true, result: [] };
    },
    log: () => {},
  });
  await bot.poll();
  assert.strictEqual(calls.length, 0);
});
