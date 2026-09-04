const test = require('node:test');
const assert = require('node:assert');
const { decide } = require('./rules');

const HOUR = 60 * 60 * 1000;
const THRESHOLDS = { stallMs: 45 * 60 * 1000, repeatMs: HOUR, digestHour: 9, flappingRestarts: 3 };

const NOON = atLocalHour('2026-09-03', 12);
const EMPTY = { lastKind: null, lastAlertAt: 0, seenRestarts: 0, lastDigestAt: atLocalHour('2026-09-03', 9) };

function snapshot(over = {}) {
  return {
    now: NOON,
    serviceActive: true,
    restarts: 0,
    stateAgeMs: 60 * 1000,
    ...over,
  };
}

test('остановленный сервис — тревога', () => {
  const { alert } = decide(snapshot({ serviceActive: false }), EMPTY, THRESHOLDS);
  assert.strictEqual(alert.kind, 'dead');
});

test('та же тревога в течение часа не повторяется', () => {
  const s = snapshot({ serviceActive: false });
  const memory = { ...EMPTY, lastKind: 'dead', lastAlertAt: s.now - 10 * 60 * 1000 };
  assert.strictEqual(decide(s, memory, THRESHOLDS).alert, null);
});

test('через час та же тревога повторяется', () => {
  const s = snapshot({ serviceActive: false });
  const memory = { ...EMPTY, lastKind: 'dead', lastAlertAt: s.now - HOUR };
  assert.strictEqual(decide(s, memory, THRESHOLDS).alert.kind, 'dead');
});

test('здоровое состояние после тревоги ничего не шлёт', () => {
  const s = snapshot();
  const memory = { ...EMPTY, lastKind: 'dead', lastAlertAt: s.now - 5 * 60 * 1000 };
  assert.strictEqual(decide(s, memory, THRESHOLDS).alert, null);
});

test('после выздоровления новая тревога приходит сразу, а не через час', () => {
  const s = snapshot();
  const memory = { ...EMPTY, lastKind: 'dead', lastAlertAt: s.now - 5 * 60 * 1000 };
  const after = decide(s, memory, THRESHOLDS).memory;
  const next = decide(snapshot({ now: s.now + 60000, serviceActive: false }), after, THRESHOLDS);
  assert.strictEqual(next.alert.kind, 'dead');
});

test('сервис жив, но давно не видел сообщений — тревога о застое', () => {
  const s = snapshot({ stateAgeMs: 50 * 60 * 1000 });
  assert.strictEqual(decide(s, EMPTY, THRESHOLDS).alert.kind, 'stall');
});

test('свежая позиция чтения тревоги не даёт', () => {
  const s = snapshot({ stateAgeMs: 44 * 60 * 1000 });
  assert.strictEqual(decide(s, EMPTY, THRESHOLDS).alert, null);
});

test('сервис ни разу не видел сообщений — тоже застой', () => {
  const s = snapshot({ stateAgeMs: null });
  assert.strictEqual(decide(s, EMPTY, THRESHOLDS).alert.kind, 'stall');
});

test('мёртвый сервис важнее застоя', () => {
  const s = snapshot({ serviceActive: false, stateAgeMs: 50 * 60 * 1000 });
  assert.strictEqual(decide(s, EMPTY, THRESHOLDS).alert.kind, 'dead');
});

test('несколько перезапусков подряд — тревога о цикле', () => {
  const s = snapshot({ restarts: 3 });
  assert.strictEqual(decide(s, EMPTY, THRESHOLDS).alert.kind, 'flapping');
});

test('один перезапуск — это норма, не тревога', () => {
  const s = snapshot({ restarts: 1 });
  assert.strictEqual(decide(s, EMPTY, THRESHOLDS).alert, null);
});

test('счётчик перезапусков запоминается, старые не считаются заново', () => {
  const s = snapshot({ restarts: 4 });
  const after = decide(s, EMPTY, THRESHOLDS).memory;
  assert.strictEqual(after.seenRestarts, 4);
  const next = decide(snapshot({ now: s.now + 2 * HOUR, restarts: 5 }), after, THRESHOLDS);
  assert.notStrictEqual(next.alert && next.alert.kind, 'flapping');
});

test('прекратившийся цикл перезапусков не даёт никакой тревоги', () => {
  const s = snapshot({ restarts: 4 });
  const after = decide(s, EMPTY, THRESHOLDS).memory;
  const next = decide(snapshot({ now: s.now + 2 * HOUR, restarts: 5 }), after, THRESHOLDS);
  assert.strictEqual(next.alert, null);
});

function atLocalHour(day, hour, minute = 0) {
  const d = new Date(`${day}T00:00:00`);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

test('после назначенного часа приходит суточная сводка', () => {
  const s = snapshot({ now: atLocalHour('2026-09-03', 9, 5) });
  const memory = { ...EMPTY, lastDigestAt: atLocalHour('2026-09-02', 9) };
  assert.strictEqual(decide(s, memory, THRESHOLDS).alert.kind, 'digest');
});

test('до назначенного часа сводки нет', () => {
  const s = snapshot({ now: atLocalHour('2026-09-03', 8, 30) });
  const memory = { ...EMPTY, lastDigestAt: atLocalHour('2026-09-02', 9) };
  assert.strictEqual(decide(s, memory, THRESHOLDS).alert, null);
});

test('вторая сводка за сутки не отправляется', () => {
  const s = snapshot({ now: atLocalHour('2026-09-03', 9, 5) });
  const memory = { ...EMPTY, lastDigestAt: atLocalHour('2026-09-02', 9) };
  const after = decide(s, memory, THRESHOLDS).memory;
  const next = decide(snapshot({ now: atLocalHour('2026-09-03', 15) }), after, THRESHOLDS);
  assert.strictEqual(next.alert, null);
});

test('тревога важнее сводки', () => {
  const s = snapshot({ now: atLocalHour('2026-09-03', 9, 5), serviceActive: false });
  const memory = { ...EMPTY, lastDigestAt: atLocalHour('2026-09-02', 9) };
  assert.strictEqual(decide(s, memory, THRESHOLDS).alert.kind, 'dead');
});

test('сводка показывает, сколько прошло за сутки, а не за всё время', () => {
  const memory = {
    ...EMPTY,
    lastDigestAt: atLocalHour('2026-09-02', 9),
    lastDigestCounters: { checked: 1000, forwarded: 5 },
  };
  const s = snapshot({ now: atLocalHour('2026-09-03', 9, 5), checked: 2400, forwarded: 8 });
  const { alert, memory: after } = decide(s, memory, THRESHOLDS);
  assert.strictEqual(alert.checkedDelta, 1400);
  assert.strictEqual(alert.forwardedDelta, 3);
  assert.deepStrictEqual(after.lastDigestCounters, { checked: 2400, forwarded: 8 });
});

test('первая в жизни сводка считает от нуля', () => {
  const memory = { ...EMPTY, lastDigestAt: 0, lastDigestCounters: null };
  const s = snapshot({ now: atLocalHour('2026-09-03', 9, 5), checked: 42, forwarded: 1 });
  const { alert } = decide(s, memory, THRESHOLDS);
  assert.strictEqual(alert.checkedDelta, 42);
  assert.strictEqual(alert.forwardedDelta, 1);
});

test('перезапускающийся юнит — ещё не «упал»', () => {
  for (const activeState of ['activating', 'reloading']) {
    const { alert } = decide(snapshot({ serviceActive: undefined, activeState }), EMPTY, THRESHOLDS);
    assert.notStrictEqual(alert && alert.kind, 'dead');
  }
});

test('состояния failed и inactive — это «упал»', () => {
  for (const activeState of ['failed', 'inactive', 'unknown']) {
    const { alert } = decide(snapshot({ serviceActive: undefined, activeState }), EMPTY, THRESHOLDS);
    assert.strictEqual(alert.kind, 'dead');
  }
});

test('когда пересылка выключена, застой не проверяется — сообщениям неоткуда взяться', () => {
  const s = snapshot({ stateAgeMs: 10 * 60 * 60 * 1000, forwarding: false });
  assert.strictEqual(decide(s, EMPTY, THRESHOLDS).alert, null);
});

test('при включённой пересылке застой проверяется как раньше', () => {
  const s = snapshot({ stateAgeMs: 10 * 60 * 60 * 1000, forwarding: true });
  assert.strictEqual(decide(s, EMPTY, THRESHOLDS).alert.kind, 'stall');
});

test('без указания режима поведение прежнее', () => {
  assert.strictEqual(decide(snapshot({ stateAgeMs: 50 * 60 * 1000 }), EMPTY, THRESHOLDS).alert.kind, 'stall');
});

test('остановленный сервис важнее выключенной пересылки', () => {
  const s = snapshot({ serviceActive: false, forwarding: false });
  assert.strictEqual(decide(s, EMPTY, THRESHOLDS).alert.kind, 'dead');
});

test('без часа суточной сводки её не шлём вовсе', () => {
  const s = snapshot({ now: atLocalHour('2026-09-03', 9, 5) });
  const memory = { ...EMPTY, lastDigestAt: atLocalHour('2026-09-02', 9) };
  const quiet = { ...THRESHOLDS, digestHour: null };
  assert.strictEqual(decide(s, memory, quiet).alert, null);
});
