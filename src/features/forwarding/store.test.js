const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createForwardingStore } = require('./store');

const DAY_MS = 24 * 60 * 60 * 1000;

function store() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fwd-')), 'state.db');
  return createForwardingStore(openDb(file));
}

test('незнакомый чат не имеет курсора', () => {
  assert.strictEqual(store().lastId('c1'), null);
});

test('курсор двигается только вперёд', () => {
  const s = store();
  s.advance('c1', 10);
  s.advance('c1', 5);
  assert.strictEqual(s.lastId('c1'), 10);
});

test('нечисловые значения курсор не двигают', () => {
  const s = store();
  s.advance('c1', undefined);
  s.advance('c1', 1.5);
  assert.strictEqual(s.lastId('c1'), null);
});

test('отправленное помнится по первичному ключу, а не поиском в массиве', () => {
  const s = store();
  assert.strictEqual(s.wasSent('c1', 42), false);
  s.commitForward('c1', { ids: [42], newestId: 42, at: 1000 });
  assert.strictEqual(s.wasSent('c1', 42), true);
  assert.strictEqual(s.wasSent('c2', 42), false);
});

test('пересылка и продвижение курсора — одна транзакция', () => {
  const s = store();
  s.commitForward('c1', { ids: [7, 8], newestId: 9, at: 1000 });
  assert.strictEqual(s.lastId('c1'), 9);
  assert.strictEqual(s.wasSent('c1', 7), true);
  assert.strictEqual(s.wasSent('c1', 8), true);
  assert.strictEqual(s.totals().forwarded, 2);
});

test('повторная отметка не удваивает счётчик', () => {
  const s = store();
  s.commitForward('c1', { ids: [7], newestId: 7, at: 1000 });
  s.commitForward('c1', { ids: [7], newestId: 7, at: 2000 });
  assert.strictEqual(s.totals().forwarded, 1);
});

test('счётчики и время последнего сообщения складываются по всем чатам', () => {
  const s = store();
  s.noteSeen('c1', 3, 1000);
  s.noteSeen('c2', 4, 2000);
  assert.deepStrictEqual(s.totals(), { checked: 7, forwarded: 0 });
  assert.strictEqual(s.lastMessageAt(), 2000);
});

test('пустая база не врёт про время последнего сообщения', () => {
  assert.strictEqual(store().lastMessageAt(), null);
});

test('память об отправленных чистится по возрасту, а не по счётчику', () => {
  const s = store();
  s.commitForward('c1', { ids: [1], newestId: 1, at: 1000 });
  s.commitForward('c1', { ids: [2], newestId: 2, at: 1000 + 200 * DAY_MS });
  assert.strictEqual(s.wasSent('c1', 1), false, 'старое забыто');
  assert.strictEqual(s.wasSent('c1', 2), true, 'свежее помнится');
});

test('счётчик пересланного не уменьшается вместе с забытыми записями', () => {
  const s = store();
  s.commitForward('c1', { ids: [1], newestId: 1, at: 1000 });
  s.commitForward('c1', { ids: [2], newestId: 2, at: 1000 + 200 * DAY_MS });
  assert.strictEqual(s.totals().forwarded, 2);
});
