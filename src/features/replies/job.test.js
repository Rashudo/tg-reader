const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createManualClock } = require('../../platform/clock');
const { createFakeGateway } = require('../../platform/telegram/fake');
const { createFakeNotifier } = require('../../platform/notify/fake');
const { createRepliesStore } = require('./store');
const { createRepliesJob } = require('./job');

const ME = 'me';
const NOON = new Date('2026-09-04T12:00:00+02:00').getTime();
const MIN = 60 * 1000;
const CHAT = { key: '-100111', title: 'Чат', username: 'chat', id: 111 };

function freshStore() {
  return createRepliesStore(openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rj-')), 'state.db')));
}

function rig(over = {}) {
  const alerts = [];
  const logs = [];
  const clock = createManualClock(NOON);
  const gateway = createFakeGateway({ clock });
  gateway.addChat('@chat', CHAT);
  const store = over.store || freshStore();
  const notifier = createFakeNotifier({ chatId: '7' });
  notifier.send = async (text, options = {}) => {
    alerts.push({ text, ...options });
    return true;
  };

  const replier = createRepliesJob({
    gateway,
    chat: CHAT,
    store,
    llm: { call: async () => ({ json: { reply: true, text: 'ага', replyToId: 11 }, text: '', usage: {}, cost: 0 }) },
    notifier,
    meId: ME,
    meName: 'Стас',
    model: 'claude-opus-4-8',
    aliases: ['стас'],
    compose: over.compose || (async () => ({ reply: true, text: 'ага', replyToId: 11 })),
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
      maxChars: 160,
    },
    clock,
    log: (line) => logs.push(line),
    random: () => 0.5,
    ...over.extra,
  });

  const sent = {
    get length() {
      return gateway.sent.length;
    },
  };
  const view = (post) => ({ message: post.text, replyTo: post.replyTo, parseMode: false, chat: CHAT });
  Object.defineProperty(sent, 0, { get: () => view(gateway.sent[0]) });
  Object.defineProperty(sent, 1, { get: () => view(gateway.sent[1]) });
  Object.defineProperty(sent, 2, { get: () => view(gateway.sent[2]) });

  return { replier, sent, alerts, logs, clock, store, gateway };
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
  const { replier, sent, clock, store } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  store.setEnabled(false);
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 0);
});

test('ошибка модели гасится: молчим и не роняем сервис', async () => {
  const { replier, sent, clock, logs } = rig({
    compose: async () => {
        throw new Error('502');
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
  const { replier, sent, clock } = rig({ compose: async () => ({ reply: false, text: '', replyToId: null }) });
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
    compose: async (input) => {
        seen.push(input);
        return { reply: true, text: 'ага', replyToId: 11 };
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

test('своя отправленная реплика попадает в окно разговора', async () => {
  const { replier, clock, gateway } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();
  const postedId = gateway.sent[0].id;
  const own = replier.window().find((msg) => msg.id === postedId);
  assert.ok(own, 'отправленная реплика должна быть в окне');
  assert.strictEqual(own.from, ME);
  assert.strictEqual(own.text, 'ага');
});

test('ответ на реплику бота — такое же обращение, как ответ на слова хозяина', async () => {
  const { replier, sent, clock, gateway } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 1);
  await replier.onMessage({ id: 20, from: 'other', author: 'Женя', replyTo: gateway.sent[0].id, text: 'да ладно?' });
  assert.strictEqual(replier.pending(), 1);
});

test('пришедшее следом событие о своей же реплике не дублирует окно', async () => {
  const { replier, clock } = rig();
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();
  await replier.onMessage({ id: 901, from: ME, author: 'Стас', replyTo: 11, text: 'ага' });
  assert.strictEqual(replier.window().filter((msg) => msg.id === 901).length, 1);
});

test('после старта окно наполняется историей, но отвечать по ней не начинает', async () => {
  const { replier } = rig();
  replier.seed([
    { id: 5, from: ME, author: 'Стас', replyTo: null, text: 'я в деле' },
    { id: 6, from: 'other', author: 'Тимур', replyTo: 5, text: 'ну как?' },
  ]);
  assert.strictEqual(replier.window().length, 2);
  assert.strictEqual(replier.pending(), 0);
});

test('ответ на сообщение хозяина, сказанное до перезапуска, распознаётся', async () => {
  const { replier } = rig();
  replier.seed([{ id: 5, from: ME, author: 'Стас', replyTo: null, text: 'я в деле' }]);
  await replier.onMessage({ id: 7, from: 'other', author: 'Тимур', replyTo: 5, text: 'а точно?' });
  assert.strictEqual(replier.pending(), 1);
});

test('история без текста в окно не идёт', async () => {
  const { replier } = rig();
  replier.seed([{ id: 5, from: ME, author: 'Стас', replyTo: null, text: '' }]);
  assert.strictEqual(replier.window().length, 0);
});

test('повтор собственной шутки не отправляется', async () => {
  let text = 'только на рот парня';
  const { replier, sent, clock, logs } = rig({
    compose: async () => ({ reply: true, text, replyToId: 11 }),
  });
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 1);

  text = 'тесто, сахар и твой рот парня для замеса';
  await replier.onMessage({ id: 20, from: 'other', author: 'Женя', replyTo: 10, text: 'а рецепт?' });
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 1);
  assert.ok(logs.some((line) => /повтор/i.test(line)));
});

test('новая мысль после повтора проходит', async () => {
  let text = 'только на рот парня';
  const { replier, sent, clock } = rig({
    compose: async () => ({ reply: true, text, replyToId: 11 }),
  });
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();

  text = 'бери противень поменьше, иначе не пропечётся';
  await replier.onMessage({ id: 20, from: 'other', author: 'Женя', replyTo: 10, text: 'а рецепт?' });
  clock.advance(5 * MIN);
  await replier.flush();
  assert.strictEqual(sent.length, 2);
});

test('оркестратор отдаёт модели список уже сказанного', async () => {
  const seen = [];
  let text = 'только на рот парня';
  const { replier, clock } = rig({
    compose: async (input) => {
        seen.push(input);
        return { reply: true, text, replyToId: 11 };
      },
  });
  await replier.onMessage(MINE);
  await replier.onMessage(ASK);
  clock.advance(5 * MIN);
  await replier.flush();

  text = 'бери противень поменьше';
  await replier.onMessage({ id: 20, from: 'other', author: 'Женя', replyTo: 10, text: 'а рецепт?' });
  clock.advance(5 * MIN);
  await replier.flush();

  assert.deepStrictEqual(seen[0].avoid, []);
  assert.deepStrictEqual(seen[1].avoid, ['только на рот парня']);
});

test('при старте свои реплики из истории попадают в память о сказанном', async () => {
  const { replier, store } = rig();
  replier.seed([
    { id: 1, from: 'other', author: 'Тимур', replyTo: null, text: 'а пирог будет?' },
    { id: 2, from: ME, author: 'Стас', replyTo: 1, text: 'только на рот парня' },
    { id: 3, from: ME, author: 'Стас', replyTo: null, text: 'два рта в одном тимуре' },
  ]);
  assert.deepStrictEqual(store.recent(8).reverse(), ['только на рот парня', 'два рта в одном тимуре']);
});

test('после старта модель сразу знает, что уже было сказано', async () => {
  const seen = [];
  const { replier, clock } = rig({
    compose: async (input) => {
        seen.push(input);
        return { reply: false, text: '', replyToId: null };
      },
  });
  replier.seed([{ id: 2, from: ME, author: 'Стас', replyTo: null, text: 'только на рот парня' }]);
  await replier.onMessage({ id: 5, from: 'other', author: 'Женя', replyTo: 2, text: 'опять?' });
  clock.advance(5 * MIN);
  await replier.flush();
  assert.deepStrictEqual(seen[0].avoid, ['только на рот парня']);
});
