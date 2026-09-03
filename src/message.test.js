const test = require('node:test');
const assert = require('node:assert');
const { formatAlert } = require('./message');

const snapshot = { stateAgeMs: 50 * 60 * 1000, restarts: 7, serviceState: 'failed' };

test('о мёртвом сервисе сказано прямо и с состоянием юнита', () => {
  const text = formatAlert({ kind: 'dead' }, snapshot);
  assert.match(text, /не работает/i);
  assert.match(text, /failed/);
});

test('в тревоге о цикле перезапусков есть их число', () => {
  assert.match(formatAlert({ kind: 'flapping' }, snapshot), /7/);
});

test('в тревоге о застое есть, сколько минут тишины', () => {
  assert.match(formatAlert({ kind: 'stall' }, snapshot), /50 мин/);
});

test('восстановление сообщается отдельно', () => {
  assert.match(formatAlert({ kind: 'recovered' }, snapshot), /норм/i);
});

test('в сводке есть обе цифры за сутки', () => {
  const text = formatAlert({ kind: 'digest', checkedDelta: 1400, forwardedDelta: 3 }, snapshot);
  assert.match(text, /1400/);
  assert.match(text, /3/);
});

test('неизвестный вид не роняет отправку', () => {
  assert.strictEqual(typeof formatAlert({ kind: 'что-то новое' }, snapshot), 'string');
});
