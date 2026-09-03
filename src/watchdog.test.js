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
