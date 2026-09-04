const test = require('node:test');
const assert = require('node:assert');
const { createManualClock, isDue, localDayOf } = require('./clock');

test('ручные часы не двигаются сами', () => {
  const clock = createManualClock(1000);
  assert.strictEqual(clock.now(), 1000);
});

test('after срабатывает ровно один раз и в свой момент', () => {
  const clock = createManualClock(0);
  const fired = [];
  clock.after(100, () => fired.push(clock.now()));
  clock.advance(99);
  assert.deepStrictEqual(fired, []);
  clock.advance(1);
  assert.deepStrictEqual(fired, [100]);
  clock.advance(1000);
  assert.deepStrictEqual(fired, [100]);
});

test('отменённый after не срабатывает', () => {
  const clock = createManualClock(0);
  let fired = false;
  const cancel = clock.after(10, () => { fired = true; });
  cancel();
  clock.advance(100);
  assert.strictEqual(fired, false);
});

test('every повторяется, пока его не отменят', () => {
  const clock = createManualClock(0);
  let ticks = 0;
  const cancel = clock.every(10, () => { ticks += 1; });
  clock.advance(35);
  assert.strictEqual(ticks, 3);
  cancel();
  clock.advance(100);
  assert.strictEqual(ticks, 3);
});

test('cancelAll снимает всё разом', () => {
  const clock = createManualClock(0);
  let ticks = 0;
  clock.every(10, () => { ticks += 1; });
  clock.after(15, () => { ticks += 1; });
  clock.cancelAll();
  clock.advance(100);
  assert.strictEqual(ticks, 0);
});

test('помощники времени переехали без изменений', () => {
  assert.strictEqual(localDayOf(Date.UTC(2026, 8, 4, 12), 'Europe/Belgrade'), '2026-9-4');
  assert.strictEqual(isDue(Date.UTC(2026, 8, 4, 12), { hour: 7, timeZone: 'UTC', lastRunAt: null }), true);
});
