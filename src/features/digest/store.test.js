const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createDigestStore } = require('./store');

function store() {
  return createDigestStore(openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dig-')), 'state.db')));
}

test('незнакомый канал не имеет ни курсора, ни времени прогона', () => {
  const s = store();
  assert.strictEqual(s.upTo('c1'), null);
  assert.strictEqual(s.lastRunAt('c1'), null);
});

test('курсор сводки двигается только вперёд', () => {
  const s = store();
  s.setUpTo('c1', 100);
  s.setUpTo('c1', 50);
  assert.strictEqual(s.upTo('c1'), 100);
});

test('время прогона перезаписывается как есть', () => {
  const s = store();
  s.setRunAt('c1', 1000);
  s.setRunAt('c1', 500);
  assert.strictEqual(s.lastRunAt('c1'), 500);
});

test('каналы не мешают друг другу', () => {
  const s = store();
  s.setUpTo('c1', 100);
  assert.strictEqual(s.upTo('c2'), null);
});
