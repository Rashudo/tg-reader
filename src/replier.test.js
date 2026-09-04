const test = require('node:test');
const assert = require('node:assert');
const { createReplier } = require('./replier');

const ME = 'me';
const NOON = new Date('2026-09-04T12:00:00+02:00').getTime();
const MIN = 60 * 1000;

function fakeState() {
  let enabled = true;
  const answered = new Set();
  const counters = { addressed: 0, spontaneous: 0, lastAddressedAt: 0, lastSpontaneousAt: 0 };
  return {
    repliesEnabled: () => enabled,
    setRepliesEnabled: (on) => {
      enabled = on;
    },
    replyCounters: () => ({ ...counters }),
    noteReply: (kind, at) => {
      counters[kind] += 1;
      counters[kind === 'addressed' ? 'lastAddressedAt' : 'lastSpontaneousAt'] = at;
    },
    wasAnswered: (id) => answered.has(id),
    noteAnswered: (id) => answered.add(id),
  };
}

function rig(over = {}) {
  const sent = [];
  const alerts = [];
  const logs = [];
  let now = NOON;

  const clock = {
    advance(ms) {
      now += ms;
    },
  };

  const replier = createReplier({
    client: {
      sendMessage: async (chat, options) => {
        sent.push({ chat, ...options });
        return { id: 900 + sent.length };
      },
    },
    chat: 'чат',
    state: over.state || fakeState(),
    responder: over.responder || { compose: async () => ({ reply: true, text: 'ага', replyToId: 11 }) },
    notifier: { send: async (text, options) => alerts.push({ text, ...options }) },
    meId: ME,
    aliases: ['стас'],
    limits: {
      dailyBudget: 4,
      addressedBudget: 10,
      spontaneousPauseMs: 90 * MIN,
      addressedPauseMs: 5 * MIN,
      delayMinMs: 2 * MIN,
      delayMaxMs: 4 * MIN,
      quiet: { from: 23, to: 9, timeZone: 'Europe/Belgrade' },
      context: 30,
      minFresh: 5,
      ownerSilenceMs: 15 * MIN,
    },
    log: (line) => logs.push(line),
    now: () => now,
    random: () => 0.5,
    ...over.extra,
  });

  return { replier, sent, alerts, logs, clock, state: over.state };
}

const ASK = { id: 11, from: 'other', author: 'Тимур', replyTo: 10, text: 'ну как?' };
const MINE = { id: 10, from: ME, author: 'Стас', replyTo: null, text: 'сейчас гляну' };

test('обращение ставится в очередь, а не шлётся сразу', async () => {
  const { replier, sent } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(replier.pending(), 1);
});

test('через задержку ответ уходит реплаем на триггер', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].replyTo, 11);
  assert.strictEqual(sent[0].parseMode, false);
  assert.strictEqual(sent[0].message, 'ага');
});

test('до задержки ничего не уходит', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
});

test('если хозяин ответил сам, очередь отменяется', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  await replier.onMessage({ id: 12, from: ME, author: 'Стас', replyTo: 11, text: 'нормально' });
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
});

test('на одно сообщение не отвечаем дважды', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 1);
});

test('копия отправленного уходит в бота с кнопкой выключения', async () => {
  const { replier, alerts, clock } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();
  assert.match(alerts[0].text, /ответил/i);
  assert.ok(alerts[0].buttons.length > 0);
});

test('выключённые ответы не отправляются даже из очереди', async () => {
  const state = fakeState();
  const { replier, sent, clock } = rig({ state });
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  state.setRepliesEnabled(false);
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
});

test('ошибка модели гасится: молчим и не роняем сервис', async () => {
  const { replier, sent, clock, logs } = rig({
    responder: {
      compose: async () => {
        throw new Error('502');
      },
    },
  });
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
  assert.ok(logs.some((line) => /502/.test(line)));
});

test('решение модели промолчать уважается', async () => {
  const { replier, sent, clock } = rig({ responder: { compose: async () => ({ reply: false, text: '', replyToId: null }) } });
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
});

test('чужой разговор в очередь не попадает', async () => {
  const { replier } = rig();
  await replier.onMessage({ id: 20, from: 'other', author: 'Тимур', replyTo: null, text: 'вчера было душно' });
  assert.strictEqual(replier.pending(), 0);
});

test('спонтанная реплика уходит, когда все правила сошлись', async () => {
  const { replier, sent, clock } = rig();
  for (let i = 0; i < 6; i += 1) {
    await replier.onMessage({ id: 30 + i, from: 'other', author: 'Тимур', replyTo: null, text: `реплика ${i}` });
  }
  clock.advance(20 * MIN);
  await replier.tick();
  assert.strictEqual(sent.length, 1);
});

test('спонтанный контур молчит, пока хозяин говорит', async () => {
  const { replier, sent, clock, logs } = rig();
  for (let i = 0; i < 6; i += 1) {
    await replier.onMessage({ id: 30 + i, from: 'other', author: 'Тимур', replyTo: null, text: `реплика ${i}` });
  }
  await replier.onMessage({ id: 40, from: ME, author: 'Стас', replyTo: null, text: 'да ладно' });
  clock.advance(5 * MIN);
  await replier.tick();
  assert.strictEqual(sent.length, 0);
  assert.ok(logs.some((line) => /сам/.test(line)));
});

test('спонтанный контур молчит, если новых сообщений мало', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage({ id: 30, from: 'other', author: 'Тимур', replyTo: null, text: 'ага' });
  clock.advance(20 * MIN);
  await replier.tick();
  assert.strictEqual(sent.length, 0);
});

test('счётчик свежих сообщений обнуляется после проверки', async () => {
  const { replier, sent, clock } = rig();
  for (let i = 0; i < 6; i += 1) {
    await replier.onMessage({ id: 30 + i, from: 'other', author: 'Тимур', replyTo: null, text: `реплика ${i}` });
  }
  clock.advance(20 * MIN);
  await replier.tick();
  clock.advance(120 * MIN);
  await replier.tick();
  assert.strictEqual(sent.length, 1);
});

test('окно контекста не растёт бесконечно', async () => {
  const { replier } = rig();
  for (let i = 0; i < 50; i += 1) {
    await replier.onMessage({ id: 100 + i, from: 'other', author: 'Тимур', replyTo: null, text: `реплика ${i}` });
  }
  assert.strictEqual(replier.window().length, 30);
});

test('сообщения без текста в окно не идут', async () => {
  const { replier } = rig();
  await replier.onMessage({ id: 60, from: 'other', author: 'Тимур', replyTo: null, text: '' });
  assert.strictEqual(replier.window().length, 0);
});

test('несозревшее обращение остаётся в очереди, а не теряется', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(4 * MIN);
  await replier.onMessage({ id: 15, from: 'other', author: 'Женя', replyTo: 10, text: 'а ты?' });
  await replier.flush();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(replier.pending(), 1);
  clock.advance(6 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 2);
});

test('по умолчанию очередь снимает только ответ хозяина на сам вопрос', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(90 * 1000);
  await replier.onMessage({ id: 13, from: ME, author: 'Стас', replyTo: null, text: 'кстати про другое' });
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 1);
});

test('ответ хозяина именно на вопрос очередь снимает', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  await replier.onMessage({ id: 13, from: ME, author: 'Стас', replyTo: 11, text: 'нормально' });
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
});

test('реплика хозяина сразу после вопроса тоже считается ответом', async () => {
  const { replier, sent, clock } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(30 * 1000);
  await replier.onMessage({ id: 13, from: ME, author: 'Стас', replyTo: null, text: 'да норм' });
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
});

test('строгий режим снимает очередь на любое слово хозяина', async () => {
  const { replier, sent, clock } = rig({ extra: { ownerCancel: 'any' } });
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(90 * 1000);
  await replier.onMessage({ id: 13, from: ME, author: 'Стас', replyTo: null, text: 'кстати про другое' });
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
});

test('оркестратор помечает свои сообщения, чтобы модель не путала себя с другими', async () => {
  const seen = [];
  const { replier, clock } = rig({
    responder: {
      compose: async (input) => {
        seen.push(input);
        return { reply: true, text: 'ага', replyToId: 11 };
      },
    },
  });
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();
  const window = seen[0].window;
  assert.strictEqual(window.find((msg) => msg.id === 10).mine, true);
  assert.strictEqual(window.find((msg) => msg.id === 11).mine, false);
});

test('заготовка, упёршаяся в паузу, ждёт следующей проверки, а не выбрасывается', async () => {
  const { replier, sent, clock } = rig({
    extra: {
      limits: {
        dailyBudget: 4,
        addressedBudget: 10,
        spontaneousPauseMs: 90 * MIN,
        addressedPauseMs: 30 * 1000,
        delayMinMs: 2 * MIN,
        delayMaxMs: 4 * MIN,
        quiet: { from: 23, to: 9, timeZone: 'Europe/Belgrade' },
        context: 30,
        minFresh: 5,
        ownerSilenceMs: 15 * MIN,
      },
    },
  });
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  await replier.onMessage({ id: 12, from: 'other', author: 'Женя', replyTo: 10, text: 'а ты как?' });
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(replier.pending(), 1);
  clock.advance(31 * 1000);
  await replier.flush();
  assert.strictEqual(sent.length, 2);
});

test('слишком старая заготовка выбрасывается, а не отвечает невпопад', async () => {
  const { replier, sent, clock, logs } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(20 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(replier.pending(), 0);
  assert.ok(logs.some((line) => /устарел/.test(line)));
});
