const test = require('node:test');
const assert = require('node:assert');
const { botTurns, isFiller } = require('./thread');

const ME = 'me';
const mine = (msg) => String(msg.from) === ME;

function chain(...messages) {
  return new Map(messages.map((msg) => [msg.id, msg]));
}

test('сообщение без реплая не продолжает ветку', () => {
  const msg = { id: 5, from: 'other', replyTo: null };
  assert.strictEqual(botTurns(msg, { messageById: chain(), mine }), 0);
});

test('реплай на чужое сообщение веткой бота не считается', () => {
  const parent = { id: 4, from: 'other', replyTo: null };
  const msg = { id: 5, from: 'other', replyTo: 4 };
  assert.strictEqual(botTurns(msg, { messageById: chain(parent), mine }), 0);
});

test('реплай на реплику бота — один круг', () => {
  const answer = { id: 4, from: ME, replyTo: 3 };
  const started = { id: 3, from: 'other', replyTo: null };
  const msg = { id: 5, from: 'other', replyTo: 4 };
  assert.strictEqual(botTurns(msg, { messageById: chain(started, answer), mine }), 1);
});

test('второй круг считает обе реплики бота', () => {
  const started = { id: 3, from: 'other', replyTo: null };
  const first = { id: 4, from: ME, replyTo: 3 };
  const back = { id: 5, from: 'other', replyTo: 4 };
  const second = { id: 6, from: ME, replyTo: 5 };
  const msg = { id: 7, from: 'other', replyTo: 6 };
  assert.strictEqual(botTurns(msg, { messageById: chain(started, first, back, second), mine }), 2);
});

test('оборванная цепочка не роняет счёт', () => {
  const msg = { id: 9, from: 'other', replyTo: 8 };
  assert.strictEqual(botTurns(msg, { messageById: chain(), mine }), 0);
});

test('кольцо в цепочке не зацикливает обход', () => {
  const a = { id: 1, from: ME, replyTo: 2 };
  const b = { id: 2, from: ME, replyTo: 1 };
  const msg = { id: 3, from: 'other', replyTo: 1 };
  assert.strictEqual(botTurns(msg, { messageById: chain(a, b), mine }), 2);
});

test('пустышки распознаются', () => {
  for (const text of ['ага', 'Ага!', 'угу', 'ок', '+', '++', 'да', 'понял', 'спс', 'лол', 'ахахах', '😂', '👍🔥', 'ну да', '...']) {
    assert.strictEqual(isFiller(text), true, text);
  }
});

test('содержательные продолжения пустышками не считаются', () => {
  for (const text of ['да, но во сколько?', 'ага, только я не поеду', 'а ты сам пробовал', 'да?', 'нет, там закрыто']) {
    assert.strictEqual(isFiller(text), false, text);
  }
});

test('вопрос не пустышка, даже короткий', () => {
  assert.strictEqual(isFiller('и?'), false);
});
