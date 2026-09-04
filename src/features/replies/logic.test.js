const test = require('node:test');
const assert = require('node:assert');
const { rememberInto, supersededByOwner, splitDue, isStale, windowFor, delayFor } = require('./logic');

const msg = (id, extra = {}) => ({ id, from: '5', author: 'Аня', text: `текст ${id}`, replyTo: null, ...extra });

test('окно не растёт дальше потолка и выбрасывает самое старое', () => {
  const window = [];
  const byId = new Map();
  for (let id = 1; id <= 5; id += 1) rememberInto(window, byId, msg(id), 3);
  assert.deepStrictEqual(window.map((m) => m.id), [3, 4, 5]);
  assert.strictEqual(byId.has(1), false);
  assert.strictEqual(byId.has(5), true);
});

test('повтор того же id окно не засоряет', () => {
  const window = [];
  const byId = new Map();
  rememberInto(window, byId, msg(1), 10);
  rememberInto(window, byId, msg(1), 10);
  assert.strictEqual(window.length, 1);
});

test('хозяин ответил реплаем — снимается именно та заготовка', () => {
  const queue = [
    { trigger: msg(10), queuedAt: 0, dueAt: 100 },
    { trigger: msg(20), queuedAt: 0, dueAt: 100 },
  ];
  const dropped = supersededByOwner(queue, msg(99, { replyTo: 20 }), {
    at: 10 * 60 * 1000, ownerCancel: 'answer', ownerAnswerMs: 60 * 1000,
  });
  assert.deepStrictEqual(dropped, [20]);
});

test('хозяин заговорил сразу после триггера — заготовка снимается по времени', () => {
  const queue = [{ trigger: msg(10), queuedAt: 1000, dueAt: 100000 }];
  const dropped = supersededByOwner(queue, msg(99), { at: 30000, ownerCancel: 'answer', ownerAnswerMs: 60 * 1000 });
  assert.deepStrictEqual(dropped, [10]);
});

test('режим any снимает всё, что бы хозяин ни сказал', () => {
  const queue = [{ trigger: msg(10), queuedAt: 0, dueAt: 100 }];
  const dropped = supersededByOwner(queue, msg(99), { at: 10 ** 9, ownerCancel: 'any', ownerAnswerMs: 60 * 1000 });
  assert.deepStrictEqual(dropped, [10]);
});

test('давняя чужая реплика хозяина заготовку не снимает', () => {
  const queue = [{ trigger: msg(10), queuedAt: 0, dueAt: 100 }];
  const dropped = supersededByOwner(queue, msg(99), { at: 10 ** 9, ownerCancel: 'answer', ownerAnswerMs: 60 * 1000 });
  assert.deepStrictEqual(dropped, []);
});

test('очередь делится на созревшее и ждущее', () => {
  const queue = [
    { trigger: msg(1), queuedAt: 0, dueAt: 50 },
    { trigger: msg(2), queuedAt: 0, dueAt: 150 },
  ];
  const { due, waiting } = splitDue(queue, 100);
  assert.deepStrictEqual(due.map((i) => i.trigger.id), [1]);
  assert.deepStrictEqual(waiting.map((i) => i.trigger.id), [2]);
});

test('протухший вопрос узнаётся по возрасту', () => {
  const item = { trigger: msg(1), queuedAt: 0, dueAt: 0 };
  assert.strictEqual(isStale(item, 5 * 60 * 1000, 10 * 60 * 1000), false);
  assert.strictEqual(isStale(item, 11 * 60 * 1000, 10 * 60 * 1000), true);
});

test('в окно для модели попадает признак своих сообщений', () => {
  const window = [msg(1, { from: '5' }), msg(2, { from: '999' })];
  const shaped = windowFor(window, '999');
  assert.deepStrictEqual(shaped.map((m) => m.mine), [false, true]);
  assert.deepStrictEqual(Object.keys(shaped[0]).sort(), ['author', 'id', 'mine', 'text']);
});

test('задержка лежит между границами', () => {
  const limits = { delayMinMs: 120000, delayMaxMs: 240000 };
  assert.strictEqual(delayFor(limits, () => 0), 120000);
  assert.strictEqual(delayFor(limits, () => 1), 240000);
  assert.strictEqual(delayFor(limits, () => 0.5), 180000);
});

test('схлопнутые границы дают ровно минимум', () => {
  assert.strictEqual(delayFor({ delayMinMs: 5000, delayMaxMs: 1000 }, () => 1), 5000);
});
