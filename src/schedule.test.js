const test = require('node:test');
const assert = require('node:assert');
const { isDue, dueMomentOf } = require('./schedule');

const BELGRADE = 'Europe/Belgrade';
const at = (iso) => Date.parse(iso);

test('до назначенного часа сводка не собирается', () => {
  const now = at('2026-09-03T04:00:00Z');
  assert.strictEqual(isDue(now, { hour: 7, timeZone: BELGRADE, lastRunAt: null }), false);
});

test('после назначенного часа собирается', () => {
  const now = at('2026-09-03T05:01:00Z');
  assert.strictEqual(isDue(now, { hour: 7, timeZone: BELGRADE, lastRunAt: null }), true);
});

test('второй раз за сутки не собирается', () => {
  const now = at('2026-09-03T05:01:00Z');
  const ranToday = at('2026-09-03T05:00:30Z');
  assert.strictEqual(isDue(now, { hour: 7, timeZone: BELGRADE, lastRunAt: ranToday }), false);
});

test('на следующий день собирается снова', () => {
  const now = at('2026-09-04T05:01:00Z');
  const ranYesterday = at('2026-09-03T05:00:30Z');
  assert.strictEqual(isDue(now, { hour: 7, timeZone: BELGRADE, lastRunAt: ranYesterday }), true);
});

test('зимой час остаётся местным, а не уезжает вместе с UTC', () => {
  const opts = { hour: 7, timeZone: BELGRADE, lastRunAt: null };
  assert.strictEqual(isDue(at('2026-12-03T05:30:00Z'), opts), false, '06:30 по Белграду — рано');
  assert.strictEqual(isDue(at('2026-12-03T06:01:00Z'), opts), true, '07:01 по Белграду — пора');
});

test('летом и зимой момент сводки отличается на час по UTC', () => {
  const summer = dueMomentOf(at('2026-09-03T12:00:00Z'), 7, BELGRADE);
  const winter = dueMomentOf(at('2026-12-03T12:00:00Z'), 7, BELGRADE);
  assert.strictEqual(new Date(summer).toISOString(), '2026-09-03T05:00:00.000Z');
  assert.strictEqual(new Date(winter).toISOString(), '2026-12-03T06:00:00.000Z');
});

test('сутки считаются по местной зоне: после полуночи ждём нового назначенного часа', () => {
  const opts = { hour: 7, timeZone: BELGRADE, lastRunAt: null };
  assert.strictEqual(isDue(at('2026-09-03T22:30:00Z'), opts), false, 'в Белграде это 4 сентября, 00:30 — до семи утра');
});

test('пропущенный час навёрстывается в тот же день', () => {
  const ranYesterday = at('2026-09-02T05:00:00Z');
  const nineInTheMorning = at('2026-09-03T07:00:00Z');
  assert.strictEqual(
    isDue(nineInTheMorning, { hour: 7, timeZone: BELGRADE, lastRunAt: ranYesterday }),
    true,
    'сервис лежал в семь утра и поднялся в девять — сводка всё равно должна уйти'
  );
});

test('неизвестная зона не роняет сервис', () => {
  assert.doesNotThrow(() => isDue(Date.now(), { hour: 7, timeZone: 'Тудым/Сюдым', lastRunAt: null }));
});

test('второй опрос за сутки не случится, даже если час сводки переставили днём', () => {
  const ranAtSeven = at('2026-09-03T05:00:00Z');
  const eightInTheEvening = at('2026-09-03T18:00:00Z');
  assert.strictEqual(
    isDue(eightInTheEvening, { hour: 20, timeZone: BELGRADE, lastRunAt: ranAtSeven, minIntervalMs: 20 * 3600 * 1000 }),
    false,
    'час поменяли с 7 на 20 — но сутки ещё не прошли'
  );
});

test('через сутки после прошлого опроса — можно', () => {
  const ranYesterday = at('2026-09-02T05:00:00Z');
  const now = at('2026-09-03T05:01:00Z');
  assert.strictEqual(
    isDue(now, { hour: 7, timeZone: BELGRADE, lastRunAt: ranYesterday, minIntervalMs: 20 * 3600 * 1000 }),
    true
  );
});

test('без указания минимального промежутка поведение прежнее', () => {
  const ranYesterday = at('2026-09-02T05:00:00Z');
  assert.strictEqual(isDue(at('2026-09-03T05:01:00Z'), { hour: 7, timeZone: BELGRADE, lastRunAt: ranYesterday }), true);
});
