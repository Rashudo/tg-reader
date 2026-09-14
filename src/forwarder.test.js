const test = require('node:test');
const assert = require('node:assert');
const { createForwarder } = require('./forwarder');
const { prepare } = require('./matcher');

const KEYWORDS = prepare([{ group: 'ТВ', words: ['телевизор', { word: 'lg' }] }]);
const SOURCE = { id: 7, title: 'Барахолка', username: 'flea' };
const KEY = '-1007';

function msg(id, text, extra = {}) {
  return { id, message: text, ...extra };
}

function channelHistory(messages, { fails = false } = {}) {
  const calls = [];
  return {
    calls,
    getMessages: async (source, { limit = 100, minId = 0, offsetId = 0 } = {}) => {
      calls.push({ limit, minId, offsetId });
      if (fails) throw new Error('канал не ответил');
      return messages
        .filter((m) => m.id > minId && (!offsetId || m.id < offsetId))
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);
    },
  };
}

function harness({ forwardFails = false, sendFails = false, keywordsFor, history, extra = {} } = {}) {
  const sent = [];
  const alerts = [];
  const logs = [];
  const store = { lastId: null, sentIds: [], seen: [] };
  const forwarder = createForwarder({
    client: {
      forwardMessages: async (to, params) => {
        if (forwardFails) throw new Error('запрет пересылки');
        sent.push({ kind: 'forward', ids: params.messages });
      },
      sendMessage: async (to, params) => {
        if (sendFails) throw new Error('сеть');
        sent.push({ kind: 'copy', text: params.message, parseMode: params.parseMode });
      },
      getMessages: history ? history.getMessages : async () => harness.fetched || [],
    },
    state: {
      lastId: () => store.lastId,
      advance: (key, id) => { if (store.lastId === null || id > store.lastId) store.lastId = id; },
      wasSent: (key, id) => store.sentIds.includes(id),
      markSent: (key, id) => store.sentIds.push(id),
      noteSeen: (key, count) => store.seen.push(count),
    },
    sources: new Map([[KEY, SOURCE]]),
    target: 'получатель',
    keywords: KEYWORDS,
    ...(keywordsFor ? { keywordsFor } : {}),
    notifier: { send: async (t) => alerts.push(t) },
    log: (m) => logs.push(m),
    peerKeyOf: () => KEY,
    eventKeyOf: () => KEY,
    albumWindowMs: 10,
    ...extra,
  });
  return { forwarder, sent, alerts, logs, store };
}

test('совпадение пересылается получателю', async () => {
  const h = harness();
  await h.forwarder.onMessage({ message: msg(10, 'продам телевизор') });
  assert.deepStrictEqual(h.sent, [{ kind: 'forward', ids: [10] }]);
  assert.strictEqual(h.store.lastId, 10);
});

test('несовпадение не пересылается, но позиция двигается', async () => {
  const h = harness();
  await h.forwarder.onMessage({ message: msg(10, 'продам велосипед') });
  assert.deepStrictEqual(h.sent, []);
  assert.strictEqual(h.store.lastId, 10);
});

test('сообщение из чужого чата игнорируется', async () => {
  const h = harness();
  const forwarder = createForwarder({
    client: {}, state: {}, sources: new Map(), target: 't', keywords: KEYWORDS,
    notifier: { send: async () => {} }, log: () => {}, peerKeyOf: () => KEY, eventKeyOf: () => 'чужой',
  });
  await forwarder.onMessage({ message: msg(10, 'телевизор') });
  assert.deepStrictEqual(h.sent, []);
});

test('просмотренными считаются только новые сообщения, а не повторы', async () => {
  const h = harness();
  await h.forwarder.onMessage({ message: msg(10, 'велосипед') });
  await h.forwarder.onMessage({ message: msg(10, 'велосипед') });
  await h.forwarder.onMessage({ message: msg(11, 'самокат') });
  assert.deepStrictEqual(h.store.seen, [1, 0, 1], 'повтор не должен увеличивать счётчик');
});

test('уже отправленное повторно не уходит', async () => {
  const h = harness();
  await h.forwarder.onMessage({ message: msg(10, 'телевизор') });
  await h.forwarder.onMessage({ message: msg(10, 'телевизор, дополнено') });
  assert.strictEqual(h.sent.length, 1);
});

test('альбом уходит одной пачкой', async () => {
  const h = harness();
  await h.forwarder.onMessage({ message: msg(10, 'продам телевизор', { groupedId: 5 }) });
  await h.forwarder.onMessage({ message: msg(11, '', { groupedId: 5 }) });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(h.sent, [{ kind: 'forward', ids: [10, 11] }]);
});

test('при запрете пересылки уходит копия без разметки', async () => {
  const h = harness({ forwardFails: true });
  await h.forwarder.onMessage({ message: msg(10, 'продам телевизор за 10__000') });
  assert.strictEqual(h.sent[0].kind, 'copy');
  assert.strictEqual(h.sent[0].parseMode, false);
  assert.match(h.sent[0].text, /10__000/);
});

test('когда не вышло ни то ни другое — громкая потеря и тревога', async () => {
  const h = harness({ forwardFails: true, sendFails: true });
  await h.forwarder.onMessage({ message: msg(10, 'продам телевизор') });
  assert.match(h.logs.join(' '), /ПОТЕРЯНО/);
  assert.match(h.alerts.join(' '), /не удалось переслать/);
  assert.strictEqual(h.store.sentIds.length, 0, 'неотправленное не помечается отправленным');
});

function quiet(from, to) {
  return Array.from({ length: to - from + 1 }, (_, i) => msg(from + i, 'ничего интересного'));
}

test('догрузка проходит все пропущенные, а не последние полсотни', async () => {
  const history = channelHistory([...quiet(101, 104), msg(105, 'продам телевизор'), ...quiet(106, 220)]);
  const h = harness({ history, extra: { pageSize: 50 } });
  h.store.lastId = 100;
  await h.forwarder.backfill(SOURCE);
  assert.deepStrictEqual(h.sent, [{ kind: 'forward', ids: [105] }]);
  assert.strictEqual(h.store.lastId, 220);
  assert.strictEqual(h.alerts.length, 0);
});

test('догрузка, упёршаяся в потолок, говорит о потере вслух', async () => {
  const history = channelHistory([msg(101, 'продам телевизор'), ...quiet(102, 220)]);
  const h = harness({ history, extra: { pageSize: 50, catchUpCap: 100 } });
  h.store.lastId = 100;
  await h.forwarder.backfill(SOURCE);
  assert.deepStrictEqual(h.sent, []);
  assert.match(h.logs.join(' '), /больше 100/);
  assert.match(h.alerts.join(' '), /пропущен/);
  assert.strictEqual(h.store.lastId, 220);
});

test('живое сообщение после слепого окна сначала проверяет пропущенное', async () => {
  const history = channelHistory([msg(101, 'продам телевизор'), ...quiet(102, 102), msg(103, 'привет')]);
  const h = harness({ history });
  h.store.lastId = 100;
  await h.forwarder.onMessage({ message: msg(103, 'привет') });
  assert.deepStrictEqual(h.sent, [{ kind: 'forward', ids: [101] }]);
  assert.strictEqual(h.store.lastId, 103);
});

test('сообщение сразу за позицией лишних запросов не делает', async () => {
  const history = channelHistory([msg(101, 'продам телевизор')]);
  const h = harness({ history });
  h.store.lastId = 100;
  await h.forwarder.onMessage({ message: msg(101, 'продам телевизор') });
  assert.strictEqual(history.calls.length, 0);
  assert.deepStrictEqual(h.sent, [{ kind: 'forward', ids: [101] }]);
});

test('сорванная проверка пропуска не сдвигает позицию за него', async () => {
  const history = channelHistory([], { fails: true });
  const h = harness({ history });
  h.store.lastId = 100;
  await h.forwarder.onMessage({ message: msg(110, 'продам телевизор') });
  assert.deepStrictEqual(h.sent, [{ kind: 'forward', ids: [110] }]);
  assert.strictEqual(h.store.lastId, 100);
  assert.match(h.logs.join(' '), /не двигаю/);
});

test('два живых сообщения после пропуска не пересылают находку дважды', async () => {
  const history = channelHistory([msg(101, 'продам телевизор'), msg(102, 'а'), msg(103, 'б')]);
  const h = harness({ history });
  h.store.lastId = 100;
  await Promise.all([
    h.forwarder.onMessage({ message: msg(102, 'а') }),
    h.forwarder.onMessage({ message: msg(103, 'б') }),
  ]);
  assert.deepStrictEqual(h.sent, [{ kind: 'forward', ids: [101] }]);
  assert.strictEqual(h.store.lastId, 103);
});

test('альбом после слепого окна тоже сначала проверяет пропущенное', async () => {
  const history = channelHistory([msg(101, 'продам телевизор'), msg(105, 'фото', { groupedId: 9 }), msg(106, '', { groupedId: 9 })]);
  const h = harness({ history });
  h.store.lastId = 100;
  await h.forwarder.onMessage({ message: msg(105, 'фото', { groupedId: 9 }) });
  await h.forwarder.onMessage({ message: msg(106, '', { groupedId: 9 }) });
  await new Promise((done) => setTimeout(done, 40));
  assert.deepStrictEqual(h.sent, [{ kind: 'forward', ids: [101] }]);
  assert.strictEqual(h.store.lastId, 106);
});

function probeHarness(newest, known) {
  return createForwarder({
    client: { getMessages: async () => (newest === null ? [] : [msg(newest, 'что-то')]) },
    state: { lastId: () => known },
    sources: new Map(), target: 't', keywords: KEYWORDS,
    notifier: { send: async () => {} }, log: () => {},
    peerKeyOf: () => KEY, eventKeyOf: () => KEY,
  });
}

test('в канале ничего нового — мы не отстали', async () => {
  assert.strictEqual(await probeHarness(100, 100).isBehind(SOURCE), false);
});

test('в канале есть сообщение свежее нашей позиции — мы отстали', async () => {
  assert.strictEqual(await probeHarness(105, 100).isBehind(SOURCE), true);
});

test('пустой канал отставанием не считается', async () => {
  assert.strictEqual(await probeHarness(null, 100).isBehind(SOURCE), false);
});

test('до первой позиции любое сообщение считается непрочитанным', async () => {
  assert.strictEqual(await probeHarness(1, null).isBehind(SOURCE), true);
});

test('у источника может быть свой набор ключей', async () => {
  const scooters = prepare([{ group: 'Электросамокаты', words: ['электросамокат'] }]);
  const h = harness({ keywordsFor: () => scooters });
  await h.forwarder.onMessage({ message: msg(10, 'продам телевизор') });
  assert.deepStrictEqual(h.sent, []);
  assert.strictEqual(h.store.lastId, 10);

  await h.forwarder.onMessage({ message: msg(11, 'продам электросамокат') });
  assert.deepStrictEqual(h.sent, [{ kind: 'forward', ids: [11] }]);
});

test('альбом, часть которого уже переслана, второй раз не уходит', async () => {
  const history = channelHistory([
    msg(101, 'продам телевизор', { groupedId: 7 }),
    msg(102, '', { groupedId: 7 }),
  ]);
  const h = harness({ history });
  h.store.lastId = 100;
  h.store.sentIds.push(101);
  await h.forwarder.backfill(SOURCE);
  assert.deepStrictEqual(h.sent, []);
  assert.ok(h.store.sentIds.includes(102));
  assert.strictEqual(h.store.lastId, 102);
});
