const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../platform/db/open');
const { createManualClock } = require('../platform/clock');
const { createFakeGateway } = require('../platform/telegram/fake');
const { createFakeNotifier } = require('../platform/notify/fake');
const { createForwardingStore } = require('../features/forwarding/store');
const { createForwardingJob } = require('../features/forwarding/job');
const { createRepliesStore } = require('../features/replies/store');
const { createStatusWriter, createStatusJob, readStatus } = require('../features/health/status');
const { decide } = require('../features/health/rules');
const { prepare } = require('../features/forwarding/matcher');
const { createHost } = require('./host');
const { installShutdown } = require('./shutdown');

const KEY = '-100111';
const NOW = Date.UTC(2026, 8, 4, 12);

function bench() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wire-')), 'state.db');
  const db = openDb(file);
  const clock = createManualClock(NOW);
  const gateway = createFakeGateway({ clock });
  const chat = { key: KEY, title: 'Барахолка', username: 'one', id: 111 };
  gateway.addChat('@one', chat);
  gateway.addChat('me', { key: '-100999', title: 'Избранное', username: null, id: 999 });

  const forwardingStore = createForwardingStore(db);
  const repliesStore = createRepliesStore(db);
  const notifier = createFakeNotifier({ chatId: '7' });
  const logs = [];
  const log = (line) => logs.push(line);

  const host = createHost({ log, notifier });
  const forwarding = createForwardingJob({
    gateway,
    store: forwardingStore,
    sources: new Map([[KEY, chat]]),
    target: 'me',
    keywords: prepare(['телевизор']),
    notifier,
    clock,
    log,
  });
  host.add(forwarding);
  host.add(
    createStatusJob({
      writer: createStatusWriter(db),
      clock,
      everyMs: 30 * 1000,
      log,
      snapshot: () => {
        const totals = forwardingStore.totals();
        return {
          startedAt: NOW,
          forwarding: true,
          digestEnabled: false,
          repliesEnabled: repliesStore.enabled(),
          lastPostAt: forwardingStore.lastMessageAt(),
          probeOkAt: null,
          checked: totals.checked,
          forwarded: totals.forwarded,
        };
      },
    })
  );

  return { db, file, clock, gateway, host, forwardingStore, repliesStore, notifier, logs, chat };
}

test('сообщение из канала доходит до получателя и до строки состояния', async () => {
  const h = bench();
  await h.host.start();

  h.gateway.emit({ chatRef: '@one', id: 500, text: 'продам телевизор' });
  await new Promise((r) => setImmediate(r));
  h.clock.advance(30 * 1000);

  assert.deepStrictEqual(h.gateway.forwarded, [{ targetRef: 'me', chatKey: KEY, ids: [500] }]);

  const result = readStatus(h.file);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status.forwarded, 1);
  assert.strictEqual(result.status.checked, 1);
  await h.host.stop();
});

test('внешняя проверка читает то, что записал сервис, и не бьёт тревогу', async () => {
  const h = bench();
  await h.host.start();
  h.gateway.emit({ chatRef: '@one', id: 500, text: 'продам телевизор' });
  await new Promise((r) => setImmediate(r));
  h.clock.advance(30 * 1000);
  await h.host.stop();

  const { status } = readStatus(h.file);
  const since = Math.max(status.lastPostAt || 0, status.startedAt || 0, status.probeOkAt || 0);
  const snapshot = {
    now: NOW + 60 * 1000,
    activeState: 'active',
    serviceState: 'active',
    restarts: 0,
    stateAgeMs: NOW + 60 * 1000 - since,
    forwarding: status.forwarding,
    checked: status.checked,
    forwarded: status.forwarded,
  };
  const memory = { lastKind: null, lastAlertAt: 0, seenRestarts: 0, lastDigestAt: 0, lastDigestCounters: null };
  const { alert } = decide(snapshot, memory, {
    stallMs: 45 * 60 * 1000,
    repeatMs: 60 * 60 * 1000,
    digestHour: null,
    flappingRestarts: 3,
  });
  assert.strictEqual(alert, null, 'живой сервис не повод для тревоги');
});

test('после остановки хоста таймеры сняты и события не обрабатываются', async () => {
  const h = bench();
  await h.host.start();
  await h.host.stop();

  h.gateway.forwarded.length = 0;
  h.gateway.emit({ chatRef: '@one', id: 600, text: 'продам телевизор' });
  await new Promise((r) => setImmediate(r));
  h.clock.advance(10 * 60 * 1000);
  assert.deepStrictEqual(h.gateway.forwarded, []);
  assert.strictEqual(h.clock.pending(), 0, 'ни одного живого таймера после остановки');
});

test('SIGTERM доводит остановку до конца и выходит с нулём', async () => {
  const h = bench();
  await h.host.start();

  const codes = [];
  let closed = false;
  const shutdown = installShutdown({
    host: h.host,
    telegram: { close: async () => { closed = true; } },
    state: { close: () => h.db.close() },
    log: () => {},
    exit: (code) => codes.push(code),
  });

  await shutdown(0);
  assert.deepStrictEqual(codes, [0]);
  assert.strictEqual(closed, true, 'Telegram отключён');
  assert.strictEqual(h.clock.pending(), 0, 'таймеры сняты');
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
});

test('незнакомая версия контракта останавливает внешнюю проверку, а не обманывает её', async () => {
  const h = bench();
  await h.host.start();
  h.clock.advance(30 * 1000);
  await h.host.stop();

  h.db.prepare('UPDATE status SET contract = 99 WHERE id = 1').run();
  h.db.close();
  const result = readStatus(h.file);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /контракт/i);
});
