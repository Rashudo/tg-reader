const test = require('node:test');
const assert = require('node:assert');

const { parseUnitStatus } = require('./systemd');

test('вывод systemctl разбирается в состояние и число перезапусков', () => {
  const status = parseUnitStatus('ActiveState=active\nNRestarts=3\n');
  assert.deepStrictEqual(status, { activeState: 'active', restarts: 3 });
});

test('порядок строк не важен', () => {
  assert.deepStrictEqual(parseUnitStatus('NRestarts=7\nActiveState=failed'), {
    activeState: 'failed',
    restarts: 7,
  });
});

test('отсутствующие поля и мусор не роняют проверку', () => {
  assert.deepStrictEqual(parseUnitStatus(''), { activeState: 'unknown', restarts: 0 });
  assert.deepStrictEqual(parseUnitStatus('чепуха'), { activeState: 'unknown', restarts: 0 });
  assert.deepStrictEqual(parseUnitStatus('ActiveState=active\nNRestarts=x'), {
    activeState: 'active',
    restarts: 0,
  });
});
