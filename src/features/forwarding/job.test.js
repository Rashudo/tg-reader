const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createManualClock } = require('../../platform/clock');
const { createFakeGateway } = require('../../platform/telegram/fake');
const { createForwardingStore } = require('./store');
const { prepare } = require('./matcher');
const { createForwardingJob } = require('./job');

const KEYWORDS = prepare([{ group: 'ТВ', words: ['телевизор', { word: 'lg' }] }]);
const KEY = '-100111';

function bench({ forwardFails = false, sendFails = false } = {}) {
  const clock = createManualClock(1000);
  const gateway = createFakeGateway({ clock });
  const chat = { key: KEY, title: 'Барахолка', username: 'one', id: 111 };
  gateway.addChat('@one', chat);
  gateway.addChat('получатель', { key: '-100999', title: 'Избранное', username: null, id: 999 });
  if (forwardFails) gateway.forward = async () => { throw new Error('запрет пересылки'); };
  if (sendFails) gateway.sendText = async () => { throw new Error('сеть'); };

  const store = createForwardingStore(openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'job-')), 'state.db')));
  const alerts = [];
  const logs = [];
  const job = createForwardingJob({
    gateway,
    store,
    sources: new Map([[KEY, chat]]),
    target: 'получатель',
    keywords: KEYWORDS,
    notifier: { send: async (t) => alerts.push(t) },
    clock,
    log: (m) => logs.push(m),
  });
  const post = (id, text, extra = {}) => ({
    id, chatKey: KEY, at: 2000, text, from: '5', author: null, replyTo: null, groupId: null, link: `l${id}`, ...extra,
  });
  return { job, gateway, store, alerts, logs, chat, post, clock };
}

test('совпадение пересылается получателю', async () => {
  const h = bench();
  await h.job.handle(h.chat, [h.post(10, 'продам телевизор')]);
  assert.deepStrictEqual(h.gateway.forwarded, [{ targetRef: 'получатель', chatKey: KEY, ids: [10] }]);
  assert.strictEqual(h.store.lastId(KEY), 10);
});

test('несовпадение не пересылается, но позиция двигается', async () => {
  const h = bench();
  await h.job.handle(h.chat, [h.post(10, 'продам велосипед')]);
  assert.deepStrictEqual(h.gateway.forwarded, []);
  assert.strictEqual(h.store.lastId(KEY), 10);
});

test('сообщение из чужого чата игнорируется', async () => {
  const h = bench();
  await h.job.start();
  h.gateway.forwarded.length = 0;
  h.gateway.emit({ chatRef: '@one', id: 10, text: 'телевизор' });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(h.gateway.forwarded.length, 1, 'свой чат обрабатывается');

  const other = bench();
  other.job.stop();
  const job = createForwardingJob({
    gateway: other.gateway, store: other.store, sources: new Map(), target: 't',
    keywords: KEYWORDS, notifier: { send: async () => {} }, clock: other.clock, log: () => {},
  });
  await job.start();
  other.gateway.forwarded.length = 0;
  other.gateway.emit({ chatRef: '@one', id: 11, text: 'телевизор' });
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(other.gateway.forwarded, [], 'чужой чат не обрабатывается');
});

test('просмотренными считаются только новые сообщения, а не повторы', async () => {
  const h = bench();
  await h.job.handle(h.chat, [h.post(10, 'велосипед')]);
  await h.job.handle(h.chat, [h.post(10, 'велосипед')]);
  await h.job.handle(h.chat, [h.post(11, 'самокат')]);
  assert.strictEqual(h.store.totals().checked, 2, 'повтор не должен увеличивать счётчик');
});

test('уже отправленное повторно не уходит', async () => {
  const h = bench();
  await h.job.handle(h.chat, [h.post(10, 'телевизор')]);
  await h.job.handle(h.chat, [h.post(10, 'телевизор, дополнено')]);
  assert.strictEqual(h.gateway.forwarded.length, 1);
});

test('альбом уходит одной пачкой', async () => {
  const h = bench();
  await h.job.handle(h.chat, [h.post(10, 'продам телевизор', { groupId: 'g5' }), h.post(11, '', { groupId: 'g5' })]);
  assert.deepStrictEqual(h.gateway.forwarded, [{ targetRef: 'получатель', chatKey: KEY, ids: [10, 11] }]);
});

test('при запрете пересылки уходит копия без разметки', async () => {
  const h = bench({ forwardFails: true });
  await h.job.handle(h.chat, [h.post(10, 'продам телевизор за 10__000')]);
  assert.strictEqual(h.gateway.sent.length, 1);
  assert.match(h.gateway.sent[0].text, /10__000/);
  assert.strictEqual(h.store.wasSent(KEY, 10), true);
});

test('когда не вышло ни то ни другое — громкая потеря и тревога', async () => {
  const h = bench({ forwardFails: true, sendFails: true });
  await h.job.handle(h.chat, [h.post(10, 'продам телевизор')]);
  assert.match(h.logs.join(' '), /ПОТЕРЯНО/);
  assert.match(h.alerts.join(' '), /не удалось переслать/);
  assert.strictEqual(h.store.wasSent(KEY, 10), false, 'неотправленное не помечается отправленным');
  assert.strictEqual(h.store.lastId(KEY), 10, 'курсор всё равно двигается — иначе канал встанет');
});

test('догрузка предупреждает, когда упёрлась в потолок', async () => {
  const h = bench();
  h.store.advance(KEY, 100);
  h.gateway.seed(KEY, [101, 102, 103].map((id) => h.post(id, 'ничего интересного')));
  await h.job.backfill(h.chat, { limit: 3 });
  assert.match(h.logs.join(' '), /больше 3/);
});

test('первый запуск начинает с текущего момента, не перебирая историю', async () => {
  const h = bench();
  h.gateway.seed(KEY, [1, 2, 3].map((id) => h.post(id, 'продам телевизор')));
  await h.job.backfill(h.chat);
  assert.deepStrictEqual(h.gateway.forwarded, [], 'старое не пересылается');
  assert.strictEqual(h.store.lastId(KEY), 3);
});

test('в канале ничего нового — мы не отстали', async () => {
  const h = bench();
  h.gateway.seed(KEY, [h.post(100, 'что-то')]);
  h.store.advance(KEY, 100);
  assert.strictEqual(await h.job.isBehind(h.chat), false);
});

test('в канале есть сообщение свежее нашей позиции — мы отстали', async () => {
  const h = bench();
  h.gateway.seed(KEY, [h.post(105, 'что-то')]);
  h.store.advance(KEY, 100);
  assert.strictEqual(await h.job.isBehind(h.chat), true);
});

test('пустой канал отставанием не считается', async () => {
  const h = bench();
  h.gateway.seed(KEY, []);
  h.store.advance(KEY, 100);
  assert.strictEqual(await h.job.isBehind(h.chat), false);
});

test('до первой позиции любое сообщение считается непрочитанным', async () => {
  const h = bench();
  h.gateway.seed(KEY, [h.post(1, 'что-то')]);
  assert.strictEqual(await h.job.isBehind(h.chat), true);
});

test('после stop сообщения из чата больше не обрабатываются', async () => {
  const h = bench();
  await h.job.start();
  await h.job.stop();
  h.gateway.forwarded.length = 0;
  h.gateway.emit({ chatRef: '@one', id: 50, text: 'продам телевизор' });
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(h.gateway.forwarded, []);
});
