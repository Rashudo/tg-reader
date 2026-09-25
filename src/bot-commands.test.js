const test = require('node:test');
const assert = require('node:assert');
const { createBotCommands } = require('./bot-commands');

function fakeState() {
  let enabled = true;
  let offset = 0;
  let posted = [];
  let memesOn = true;
  let botId = null;
  return {
    botId: () => botId,
    setBotId: (id) => {
      botId = id;
    },
    repliesEnabled: () => enabled,
    setRepliesEnabled: (on) => {
      enabled = on;
    },
    botOffset: () => offset,
    setBotOffset: (value) => {
      offset = value;
    },
    replyCounters: () => ({ addressed: 2, spontaneous: 1, lastAddressedAt: 0, lastSpontaneousAt: 0 }),
    postedReplies: () => posted,
    memesEnabled: () => memesOn,
    setMemesEnabled: (on) => {
      memesOn = on;
    },
    setPosted: (items) => {
      posted = items;
    },
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

test('«сброс» обнуляет счётчики за сутки', async () => {
  let reset = 0;
  const state = fakeState();
  state.resetReplyCounters = () => {
    reset += 1;
  };
  const { bot, calls } = rig([{ update_id: 11, message: { text: 'сброс', chat: { id: 7 } } }], { state });
  await bot.poll();
  assert.strictEqual(reset, 1);
  assert.match(calls.at(-1).body.text, /обнул/i);
});

test('/reset делает то же самое', async () => {
  let reset = 0;
  const state = fakeState();
  state.resetReplyCounters = () => {
    reset += 1;
  };
  const { bot } = rig([{ update_id: 12, message: { text: '/reset', chat: { id: 7 } } }], { state });
  await bot.poll();
  assert.strictEqual(reset, 1);
});

test('сброс из чужого чата не проходит', async () => {
  let reset = 0;
  const state = fakeState();
  state.resetReplyCounters = () => {
    reset += 1;
  };
  const { bot } = rig([{ update_id: 13, message: { text: 'сброс', chat: { id: 999 } } }], { state });
  await bot.poll();
  assert.strictEqual(reset, 0);
});

test('поллер просит у Bot API реакции', async () => {
  const { bot, calls } = rig([]);
  await bot.poll();
  const poll = calls.find((call) => call.url.includes('getUpdates'));
  assert.ok(poll.body.allowed_updates.includes('message_reaction'));
});

test('реакция в личке уходит в ответчик', async () => {
  const seen = [];
  const { bot } = rig(
    [
      {
        update_id: 9,
        message_reaction: {
          chat: { id: 7 },
          message_id: 55,
          new_reaction: [{ type: 'emoji', emoji: '💯' }],
        },
      },
    ],
    { extra: { onReaction: (event) => seen.push(event) } }
  );
  await bot.poll();
  assert.deepStrictEqual(seen, [{ noteId: 55, reactions: [{ type: 'emoji', emoji: '💯' }] }]);
});

test('реакция в чужом чате игнорируется', async () => {
  const seen = [];
  const { bot } = rig(
    [{ update_id: 10, message_reaction: { chat: { id: 999 }, message_id: 55, new_reaction: [] } }],
    { extra: { onReaction: (event) => seen.push(event) } }
  );
  await bot.poll();
  assert.deepStrictEqual(seen, []);
});

test('«оценки» показывают последние реплики с их реакциями', async () => {
  const state = fakeState();
  state.setPosted([
    { id: 1, noteId: 11, text: 'первая', at: 1000, chat: { good: 2, bad: 0 }, note: { good: 0, bad: 0 } },
    { id: 2, noteId: 12, text: 'вторая', at: 2000, chat: { good: 0, bad: 0 }, note: { good: 0, bad: 1 } },
    { id: 3, noteId: 13, text: 'третья', at: 3000, chat: { good: 0, bad: 0 }, note: { good: 0, bad: 0 } },
  ]);
  const { bot, calls } = rig([{ update_id: 11, message: { text: 'оценки', chat: { id: 7 } } }], { state });
  await bot.poll();
  const said = calls.find((call) => call.url.includes('sendMessage')).body.text;
  assert.match(said, /👍 «первая»/);
  assert.match(said, /👎 «вторая»/);
  assert.match(said, /третья/);
});

test('«оценки» без единой реплики не притворяются, что они есть', async () => {
  const { bot, calls } = rig([{ update_id: 12, message: { text: 'оценки', chat: { id: 7 } } }]);
  await bot.poll();
  const said = calls.find((call) => call.url.includes('sendMessage')).body.text;
  assert.match(said, /Оценок пока нет/);
});

test('статус подсчитывает оценки', async () => {
  const state = fakeState();
  state.setPosted([
    { id: 1, noteId: 11, text: 'первая', at: 1000, chat: { good: 2, bad: 0 }, note: { good: 0, bad: 0 } },
    { id: 2, noteId: 12, text: 'вторая', at: 2000, chat: { good: 0, bad: 0 }, note: { good: 0, bad: 1 } },
  ]);
  const { bot, calls } = rig([{ update_id: 13, message: { text: 'статус', chat: { id: 7 } } }], { state });
  await bot.poll();
  const said = calls.find((call) => call.url.includes('sendMessage')).body.text;
  assert.match(said, /Оценки: 👍 1, 👎 1/);
});

test('«мемы стоп» выключает картинки, «мемы старт» возвращает', async () => {
  const { bot, state } = rig([
    { update_id: 1, message: { text: 'мемы стоп', chat: { id: 7 } } },
  ]);
  await bot.poll();
  assert.strictEqual(state.memesEnabled(), false);

  const back = rig([{ update_id: 2, message: { text: 'мемы старт', chat: { id: 7 } } }], { state });
  await back.bot.poll();
  assert.strictEqual(state.memesEnabled(), true);
});

test('«мемы» переключает состояние', async () => {
  const { bot, state } = rig([{ update_id: 1, message: { text: 'мемы', chat: { id: 7 } } }]);
  await bot.poll();
  assert.strictEqual(state.memesEnabled(), false);
});

test('кнопка под картинкой выключает только картинки', async () => {
  const { bot, state, calls } = rig([
    { update_id: 1, callback_query: { id: 'c1', data: 'memes:off', message: { chat: { id: 7 } } } },
  ]);
  await bot.poll();
  assert.strictEqual(state.memesEnabled(), false);
  assert.strictEqual(state.repliesEnabled(), true);
  const answered = calls.find((call) => call.url.includes('answerCallbackQuery'));
  assert.match(answered.body.text, /картинок/i);
});

test('статус говорит и про картинки', async () => {
  const { bot, state, calls } = rig([{ update_id: 1, message: { text: 'статус', chat: { id: 7 } } }]);
  state.setMemesEnabled(false);
  await bot.poll();
  const said = calls.find((call) => call.url.includes('sendMessage'));
  assert.match(said.body.text, /Картинки выключены/);
});

test('конфликт с другим опросчиком виден в журнале', async () => {
  const logs = [];
  const { bot } = rig([], { extra: {
    log: (line) => logs.push(line),
    request: async (url) => (url.includes('getUpdates')
      ? { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running' }
      : { ok: true }),
  } });
  await bot.poll();
  assert.match(logs.join(' '), /опрашивает кто-то ещё/i);
});

test('о конфликте не пишется в журнал на каждом опросе', async () => {
  const logs = [];
  let now = 0;
  const { bot } = rig([], { extra: {
    log: (line) => logs.push(line),
    now: () => now,
    request: async (url) => (url.includes('getUpdates')
      ? { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' }
      : { ok: true }),
  } });
  await bot.poll();
  now += 60 * 1000;
  await bot.poll();
  assert.strictEqual(logs.filter((line) => /опрашивает кто-то ещё/i.test(line)).length, 1);
  now += 31 * 60 * 1000;
  await bot.poll();
  assert.strictEqual(logs.filter((line) => /опрашивает кто-то ещё/i.test(line)).length, 2);
});

test('прочая ошибка Bot API тоже попадает в журнал', async () => {
  const logs = [];
  const { bot } = rig([], { extra: {
    log: (line) => logs.push(line),
    request: async (url) => (url.includes('getUpdates')
      ? { ok: false, error_code: 401, description: 'Unauthorized' }
      : { ok: true }),
  } });
  await bot.poll();
  assert.match(logs.join(' '), /Unauthorized/);
});

test('смена токена сбрасывает позицию чтения обновлений', async () => {
  const state = fakeState();
  state.setBotId('111');
  state.setBotOffset(999999);
  const logs = [];
  const { bot } = rig([], { state, extra: { token: '222:secret', log: (line) => logs.push(line) } });
  await bot.poll();
  assert.strictEqual(state.botOffset(), 0);
  assert.strictEqual(state.botId(), '222');
  assert.match(logs.join(' '), /токен сменился/i);
});

test('тот же токен позицию не сбрасывает', async () => {
  const state = fakeState();
  state.setBotId('t');
  state.setBotOffset(500);
  const { bot } = rig([], { state });
  await bot.poll();
  assert.strictEqual(state.botOffset(), 500);
});

test('на первом запуске бот просто запоминается', async () => {
  const state = fakeState();
  state.setBotOffset(500);
  const { bot } = rig([], { state });
  await bot.poll();
  assert.strictEqual(state.botOffset(), 500);
  assert.strictEqual(state.botId(), 't');
});
