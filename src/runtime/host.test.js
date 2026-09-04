const test = require('node:test');
const assert = require('node:assert');
const { createHost } = require('./host');

const job = (name, hooks = {}) => ({
  name,
  started: false,
  stopped: false,
  async start() { this.started = true; if (hooks.onStart) await hooks.onStart(); },
  async stop() { this.stopped = true; if (hooks.onStop) await hooks.onStop(); },
});

test('хост запускает все работы', async () => {
  const host = createHost({ log: () => {} });
  const a = job('a');
  const b = job('b');
  host.add(a); host.add(b);
  await host.start();
  assert.ok(a.started && b.started);
});

test('падение одной работы при старте не роняет остальные', async () => {
  const logged = [];
  const alerts = [];
  const host = createHost({ log: (line) => logged.push(line), notifier: { send: async (t) => alerts.push(t) } });
  const bad = job('плохая', { onStart: async () => { throw new Error('канал не открылся'); } });
  const good = job('хорошая');
  host.add(bad); host.add(good);
  await host.start();
  assert.strictEqual(good.started, true, 'исправная работа обязана подняться');
  assert.match(logged.join('\n'), /плохая/);
  assert.match(alerts.join('\n'), /плохая/);
});

test('порядок не важен: упавшая последней тоже не мешает', async () => {
  const host = createHost({ log: () => {} });
  const good = job('хорошая');
  const bad = job('плохая', { onStart: async () => { throw new Error('нет') } });
  host.add(good); host.add(bad);
  await host.start();
  assert.strictEqual(good.started, true);
});

test('stop останавливает всё, даже если одна работа бросила', async () => {
  const host = createHost({ log: () => {} });
  const bad = job('плохая', { onStop: async () => { throw new Error('не смогла'); } });
  const good = job('хорошая');
  host.add(bad); host.add(good);
  await host.start();
  await host.stop();
  assert.strictEqual(good.stopped, true);
});

test('stop без start ничего не ломает', async () => {
  const host = createHost({ log: () => {} });
  host.add(job('a'));
  await assert.doesNotReject(() => host.stop());
});

test('работа, не поднявшаяся при старте, не останавливается', async () => {
  const host = createHost({ log: () => {} });
  const bad = job('плохая', { onStart: async () => { throw new Error('нет') } });
  host.add(bad);
  await host.start();
  await host.stop();
  assert.strictEqual(bad.stopped, false, 'нечего останавливать — она не запускалась');
});

test('без уведомителя падение только логируется', async () => {
  const logged = [];
  const host = createHost({ log: (line) => logged.push(line) });
  host.add(job('плохая', { onStart: async () => { throw new Error('нет') } }));
  await assert.doesNotReject(() => host.start());
  assert.match(logged.join('\n'), /плохая/);
});
