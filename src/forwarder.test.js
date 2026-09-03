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

function harness({ forwardFails = false, sendFails = false } = {}) {
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
      getMessages: async () => harness.fetched || [],
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
    notifier: { send: async (t) => alerts.push(t) },
    log: (m) => logs.push(m),
    peerKeyOf: () => KEY,
    eventKeyOf: () => KEY,
    albumWindowMs: 10,
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

test('догрузка предупреждает, когда упёрлась в потолок', async () => {
  const h = harness();
  h.store.lastId = 100;
  harness.fetched = Array.from({ length: 3 }, (_, i) => msg(101 + i, 'ничего интересного'));
  await h.forwarder.backfill(SOURCE, { limit: 3 });
  assert.match(h.logs.join(' '), /больше 3/);
  harness.fetched = [];
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
