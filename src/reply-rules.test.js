const test = require('node:test');
const assert = require('node:assert');
const { isAddressed, inQuietHours, decideAddressed, decideSpontaneous } = require('./reply-rules');

const TZ = 'Europe/Belgrade';
const QUIET = { from: 23, to: 9, timeZone: TZ };
const NOON = new Date('2026-09-04T12:00:00+02:00').getTime();
const MIN = 60 * 1000;

const BASE = {
  now: NOON,
  enabled: true,
  quiet: QUIET,
  freshCount: 9,
  minFresh: 5,
  ownerSpokeAt: NOON - 60 * MIN,
  ownerSilenceMs: 15 * MIN,
  used: 0,
  budget: 4,
  lastAt: 0,
  pauseMs: 90 * MIN,
};

const ADDR = {
  now: NOON,
  enabled: true,
  quiet: QUIET,
  used: 0,
  budget: 10,
  lastAt: 0,
  pauseMs: 5 * MIN,
};

test('ответ на моё сообщение — обращение', () => {
  const messageById = new Map([[10, { id: 10, from: 'me' }]]);
  const msg = { id: 11, from: 'other', replyTo: 10, text: 'ну как?' };
  assert.strictEqual(isAddressed(msg, { meId: 'me', aliases: [], messageById }), true);
});

test('ответ на чужое сообщение обращением не считается', () => {
  const messageById = new Map([[10, { id: 10, from: 'third' }]]);
  const msg = { id: 11, from: 'other', replyTo: 10, text: 'ну как?' };
  assert.strictEqual(isAddressed(msg, { meId: 'me', aliases: [], messageById }), false);
});

test('упоминание по прозвищу — обращение', () => {
  const msg = { id: 11, from: 'other', replyTo: null, text: 'стас, ты где' };
  assert.strictEqual(isAddressed(msg, { meId: 'me', aliases: ['стас'], messageById: new Map() }), true);
});

test('прозвище внутри слова не считается', () => {
  const msg = { id: 11, from: 'other', replyTo: null, text: 'стасик тут ни при чём' };
  assert.strictEqual(isAddressed(msg, { meId: 'me', aliases: ['стас'], messageById: new Map() }), false);
});

test('чужой разговор — не обращение', () => {
  const msg = { id: 11, from: 'other', replyTo: null, text: 'вчера было душно' };
  assert.strictEqual(isAddressed(msg, { meId: 'me', aliases: ['стас'], messageById: new Map() }), false);
});

test('своё сообщение обращением не считается', () => {
  const msg = { id: 11, from: 'me', replyTo: null, text: 'стас молодец' };
  assert.strictEqual(isAddressed(msg, { meId: 'me', aliases: ['стас'], messageById: new Map() }), false);
});

test('пустой текст без медиа обращением не считается', () => {
  const msg = { id: 11, from: 'other', replyTo: null, text: '' };
  assert.strictEqual(isAddressed(msg, { meId: 'me', aliases: ['стас'], messageById: new Map() }), false);
});

test('тихие часы считаются через полночь', () => {
  assert.strictEqual(inQuietHours(new Date('2026-09-04T23:30:00+02:00').getTime(), QUIET), true);
  assert.strictEqual(inQuietHours(new Date('2026-09-04T03:00:00+02:00').getTime(), QUIET), true);
  assert.strictEqual(inQuietHours(new Date('2026-09-04T08:59:00+02:00').getTime(), QUIET), true);
  assert.strictEqual(inQuietHours(new Date('2026-09-04T09:01:00+02:00').getTime(), QUIET), false);
  assert.strictEqual(inQuietHours(NOON, QUIET), false);
});

test('тихие часы считаются в своей зоне, а не в UTC', () => {
  assert.strictEqual(inQuietHours(new Date('2026-09-04T22:30:00Z').getTime(), QUIET), true);
});

test('спонтанная реплика ждёт пяти новых сообщений', () => {
  const d = decideSpontaneous({ ...BASE, freshCount: 3 });
  assert.strictEqual(d.allow, false);
  assert.match(d.why, /мало новых/);
});

test('спонтанная реплика молчит, пока хозяин говорит', () => {
  const d = decideSpontaneous({ ...BASE, ownerSpokeAt: BASE.now - MIN });
  assert.strictEqual(d.allow, false);
  assert.match(d.why, /сам/);
});

test('исчерпанный суточный бюджет запрещает реплику', () => {
  const d = decideSpontaneous({ ...BASE, used: 4 });
  assert.strictEqual(d.allow, false);
  assert.match(d.why, /бюджет/);
});

test('полтора часа после прошлой реплики — молчим', () => {
  const d = decideSpontaneous({ ...BASE, lastAt: BASE.now - 30 * MIN });
  assert.strictEqual(d.allow, false);
  assert.match(d.why, /пауза/);
});

test('в тихие часы спонтанная реплика запрещена', () => {
  const d = decideSpontaneous({ ...BASE, now: new Date('2026-09-04T02:00:00+02:00').getTime() });
  assert.strictEqual(d.allow, false);
  assert.match(d.why, /тих/);
});

test('все условия сошлись — говорим', () => {
  assert.strictEqual(decideSpontaneous(BASE).allow, true);
});

test('обращения подчиняются своему бюджету', () => {
  assert.strictEqual(decideAddressed({ ...ADDR, used: 10 }).allow, false);
});

test('обращения подчиняются своей паузе', () => {
  assert.strictEqual(decideAddressed({ ...ADDR, lastAt: ADDR.now - MIN }).allow, false);
});

test('обращение в рабочие часы с запасом — отвечаем', () => {
  assert.strictEqual(decideAddressed(ADDR).allow, true);
});

test('выключённые ответы запрещают оба контура', () => {
  assert.strictEqual(decideAddressed({ ...ADDR, enabled: false }).allow, false);
  assert.strictEqual(decideSpontaneous({ ...BASE, enabled: false }).allow, false);
  assert.match(decideSpontaneous({ ...BASE, enabled: false }).why, /выключен/);
});

test('хозяин ни разу не говорил — это не повод молчать', () => {
  assert.strictEqual(decideSpontaneous({ ...BASE, ownerSpokeAt: null }).allow, true);
});
