const test = require('node:test');
const assert = require('node:assert');
const { createWatchdog } = require('./watchdog');

function setup(limitMs = 5000) {
  const logs = [];
  const events = { gaveUp: 0 };
  let connected = true;
  let clock = 1000;
  const watchdog = createWatchdog({
    isConnected: () => connected,
    onGiveUp: () => { events.gaveUp += 1; },
    log: (message) => logs.push(message),
    limitMs,
    intervalMs: 1000,
    now: () => clock,
  });
  return {
    watchdog,
    logs,
    events,
    setConnected: (value) => { connected = value; },
    advance: (ms) => { clock += ms; },
  };
}

test('пока связь есть — молчит и не выходит', () => {
  const s = setup();
  for (let i = 0; i < 10; i += 1) {
    assert.strictEqual(s.watchdog.tick(), false);
    s.advance(60000);
  }
  assert.deepStrictEqual(s.logs, []);
  assert.strictEqual(s.events.gaveUp, 0);
});

test('короткий обрыв переживаем без выхода', () => {
  const s = setup(5000);
  s.setConnected(false);
  s.watchdog.tick();
  s.advance(4000);
  assert.strictEqual(s.watchdog.tick(), false);
  s.setConnected(true);
  assert.strictEqual(s.watchdog.tick(), false);
  assert.strictEqual(s.events.gaveUp, 0);
  assert.deepStrictEqual(s.logs, [
    'Связь с Telegram потеряна, жду восстановления',
    'Связь с Telegram восстановлена',
  ]);
});

test('затяжной обрыв приводит к выходу ровно один раз за эпизод', () => {
  const s = setup(5000);
  s.setConnected(false);
  s.watchdog.tick();
  s.advance(5000);
  assert.strictEqual(s.watchdog.tick(), true);
  assert.strictEqual(s.events.gaveUp, 1);
});

test('после восстановления отсчёт начинается заново', () => {
  const s = setup(5000);
  s.setConnected(false);
  s.watchdog.tick();
  s.advance(4000);
  s.watchdog.tick();
  s.setConnected(true);
  s.watchdog.tick();
  s.setConnected(false);
  s.watchdog.tick();
  s.advance(4000);
  assert.strictEqual(s.watchdog.tick(), false);
  assert.strictEqual(s.events.gaveUp, 0);
});

const { createStallWatchdog } = require('./watchdog');

function stallSetup({ probe } = {}) {
  const events = { reconnects: 0, gaveUp: 0, probes: 0 };
  const logs = [];
  let clock = 1000;
  let lastMessageAt = 1000;
  const watchdog = createStallWatchdog({
    lastMessageAt: () => lastMessageAt,
    probe: probe && (async () => { events.probes += 1; return probe(); }),
    now: () => clock,
    onReconnect: () => { events.reconnects += 1; },
    onGiveUp: () => { events.gaveUp += 1; },
    log: (m) => logs.push(m),
    reconnectAfterMs: 30 * 60 * 1000,
    giveUpAfterMs: 45 * 60 * 1000,
  });
  return {
    watchdog, events, logs,
    advance: (ms) => { clock += ms; },
    messageArrived: () => { lastMessageAt = clock; },
  };
}

test('пока сообщения идут, сторож застоя молчит', async () => {
  const s = stallSetup();
  for (let i = 0; i < 20; i += 1) {
    s.advance(60000);
    s.messageArrived();
    await s.watchdog.tick();
  }
  assert.strictEqual(s.events.reconnects, 0);
  assert.strictEqual(s.events.gaveUp, 0);
});

test('полчаса тишины — принудительный реконнект', async () => {
  const s = stallSetup();
  s.advance(30 * 60 * 1000);
  await s.watchdog.tick();
  assert.strictEqual(s.events.reconnects, 1);
  assert.strictEqual(s.events.gaveUp, 0);
});

test('реконнект не повторяется на каждом тике', async () => {
  const s = stallSetup();
  s.advance(30 * 60 * 1000);
  await s.watchdog.tick();
  s.advance(60000);
  await s.watchdog.tick();
  assert.strictEqual(s.events.reconnects, 1);
});

test('если реконнект не помог — выход на перезапуск', async () => {
  const s = stallSetup();
  s.advance(30 * 60 * 1000);
  await s.watchdog.tick();
  s.advance(15 * 60 * 1000);
  await s.watchdog.tick();
  assert.strictEqual(s.events.gaveUp, 1);
});

test('выход запрашивается один раз, а не на каждом тике', async () => {
  const s = stallSetup();
  s.advance(45 * 60 * 1000);
  await s.watchdog.tick();
  s.advance(60000);
  await s.watchdog.tick();
  assert.strictEqual(s.events.gaveUp, 1);
});

test('пришедшее сообщение сбрасывает отсчёт', async () => {
  const s = stallSetup();
  s.advance(30 * 60 * 1000);
  await s.watchdog.tick();
  s.messageArrived();
  await s.watchdog.tick();
  s.advance(29 * 60 * 1000);
  await s.watchdog.tick();
  assert.strictEqual(s.events.reconnects, 1);
  s.advance(60000);
  await s.watchdog.tick();
  assert.strictEqual(s.events.reconnects, 2);
  assert.strictEqual(s.events.gaveUp, 0);
});

test('тихий канал застоем не считается: проверка показала, что нового нет', async () => {
  const s = stallSetup({ probe: () => false });
  s.advance(30 * 60 * 1000);
  assert.strictEqual(await s.watchdog.tick(), false);
  assert.strictEqual(s.events.probes, 1, 'должны были сходить и спросить');
  assert.strictEqual(s.events.reconnects, 0, 'переподключаться незачем — в канале правда тихо');

  s.advance(30 * 60 * 1000);
  assert.strictEqual(await s.watchdog.tick(), false, 'отсчёт пошёл заново от успешной проверки');
  assert.strictEqual(s.events.gaveUp, 0);
});

test('канал живёт, а мы его не видим — это застой', async () => {
  const s = stallSetup({ probe: () => true });
  s.advance(30 * 60 * 1000);
  await s.watchdog.tick();
  assert.strictEqual(s.events.reconnects, 1);
  s.advance(15 * 60 * 1000);
  await s.watchdog.tick();
  assert.strictEqual(s.events.gaveUp, 1);
});

test('шестичасовая ночная тишина не приводит ни к чему', async () => {
  const s = stallSetup({ probe: () => false });
  for (let minutes = 0; minutes < 6 * 60; minutes += 30) {
    s.advance(30 * 60 * 1000);
    await s.watchdog.tick();
  }
  assert.strictEqual(s.events.reconnects, 0);
  assert.strictEqual(s.events.gaveUp, 0);
});

test('упавшая проверка трактуется как застой — лучше перезапуститься, чем ослепнуть', async () => {
  const s = stallSetup({ probe: () => { throw new Error('нет связи'); } });
  s.advance(30 * 60 * 1000);
  await s.watchdog.tick();
  assert.strictEqual(s.events.reconnects, 1);
  assert.match(s.logs.join(' '), /нет связи/);
});

test('без проверки поведение прежнее — по молчанию', async () => {
  const s = stallSetup();
  s.advance(45 * 60 * 1000);
  await s.watchdog.tick();
  assert.strictEqual(s.events.gaveUp, 1);
});

test('подтверждённая тишина сообщается наружу, чтоб её увидела внешняя проверка', async () => {
  const quiet = [];
  const dog = createStallWatchdog({
    lastMessageAt: () => 0,
    probe: async () => false,
    onQuiet: (at) => quiet.push(at),
    onReconnect: () => {},
    onGiveUp: () => {},
    log: () => {},
    reconnectAfterMs: 30 * 60 * 1000,
    giveUpAfterMs: 45 * 60 * 1000,
    now: () => 60 * 60 * 1000,
  });
  await dog.tick();
  assert.deepStrictEqual(quiet, [60 * 60 * 1000]);
});
