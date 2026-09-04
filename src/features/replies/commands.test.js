const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createFakeNotifier } = require('../../platform/notify/fake');
const { createRepliesStore } = require('./store');
const { commandOf, pollCommands, OFF_DATA } = require('./commands');

const NOW = Date.UTC(2026, 8, 4, 12);

function store() {
  return createRepliesStore(openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-')), 'state.db')));
}

function rig(updates, { chatId = '7', over = {} } = {}) {
  const s = over.store || store();
  const notifier = createFakeNotifier({ chatId, queued: [updates] });
  const logs = [];
  const poll = () => pollCommands({ notifier, store: s, now: () => NOW, timeZone: 'Europe/Belgrade', log: (m) => logs.push(m) });
  return { poll, store: s, notifier, logs };
}

const said = (text, chatId = '7', id = 1) => ({ update_id: id, message: { chat: { id: chatId }, text } });

test('«стоп» выключает ответы', async () => {
  const r = rig([said('стоп')]);
  await r.poll();
  assert.strictEqual(r.store.enabled(), false);
  assert.match(r.notifier.sent.map((m) => m.text).join(' '), /Молчу/);
});

test('/start включает обратно', async () => {
  const r = rig([said('/start')]);
  r.store.setEnabled(false);
  await r.poll();
  assert.strictEqual(r.store.enabled(), true);
});

test('кнопка под ответом выключает', async () => {
  const r = rig([{ update_id: 1, callback_query: { id: 'q1', data: OFF_DATA, message: { chat: { id: '7' } } } }]);
  await r.poll();
  assert.strictEqual(r.store.enabled(), false);
  assert.deepStrictEqual(r.notifier.confirmed, [{ id: 'q1', text: 'Молчу' }]);
});

test('чужой чат командовать не может', async () => {
  const r = rig([said('стоп', '999')]);
  await r.poll();
  assert.strictEqual(r.store.enabled(), true);
});

test('кнопка из чужого чата тоже не проходит', async () => {
  const r = rig([{ update_id: 1, callback_query: { id: 'q1', data: OFF_DATA, message: { chat: { id: '999' } } } }]);
  await r.poll();
  assert.strictEqual(r.store.enabled(), true);
});

test('статус отвечает состоянием и счётчиками', async () => {
  const r = rig([said('статус')]);
  await r.poll();
  assert.match(r.notifier.sent[0].text, /Ответы включены/);
  assert.match(r.notifier.sent[0].text, /на обращения 0/);
});

test('offset двигается, старые команды не переигрываются', async () => {
  const r = rig([said('стоп', '7', 42)]);
  await r.poll();
  assert.strictEqual(r.store.botOffset(), 43);
});

test('незнакомая команда не роняет опрос', async () => {
  const r = rig([said('здорово, бот')]);
  await assert.doesNotReject(() => r.poll());
  assert.deepStrictEqual(r.notifier.sent, []);
});

test('ошибка сети не роняет опрос', async () => {
  const s = store();
  const notifier = createFakeNotifier({ chatId: '7' });
  notifier.updates = async () => { throw new Error('сеть'); };
  const logs = [];
  await assert.doesNotReject(() =>
    pollCommands({ notifier, store: s, now: () => NOW, timeZone: 'UTC', log: (m) => logs.push(m) })
  );
  assert.match(logs.join(' '), /не удалось прочитать команды/);
});

test('выключенный бот опрос не делает', async () => {
  const s = store();
  const notifier = createFakeNotifier({ chatId: '7' });
  notifier.enabled = false;
  let asked = false;
  notifier.updates = async () => { asked = true; return { updates: [], nextOffset: 0 }; };
  await pollCommands({ notifier, store: s, now: () => NOW, timeZone: 'UTC', log: () => {} });
  assert.strictEqual(asked, false);
});

test('«сброс» обнуляет счётчики за сутки', async () => {
  const r = rig([said('сброс')]);
  r.store.noteReply('addressed', NOW, '2026-9-4');
  await r.poll();
  assert.strictEqual(r.store.counters('2026-9-4').addressed, 0);
  assert.match(r.notifier.sent[0].text, /Счётчики обнулены/);
});

test('/reset делает то же самое', async () => {
  const r = rig([said('/reset')]);
  r.store.noteReply('spontaneous', NOW, '2026-9-4');
  await r.poll();
  assert.strictEqual(r.store.counters('2026-9-4').spontaneous, 0);
});

test('сброс из чужого чата не проходит', async () => {
  const r = rig([said('сброс', '999')]);
  r.store.noteReply('addressed', NOW, '2026-9-4');
  await r.poll();
  assert.strictEqual(r.store.counters('2026-9-4').addressed, 1);
});

test('сброс не трогает флаг включённости', async () => {
  const r = rig([said('сброс')]);
  r.store.setEnabled(false);
  await r.poll();
  assert.strictEqual(r.store.enabled(), false);
});

test('все написания команд узнаются', () => {
  assert.strictEqual(commandOf('стоп'), 'off');
  assert.strictEqual(commandOf('/stop'), 'off');
  assert.strictEqual(commandOf('МОЛЧИ'), 'off');
  assert.strictEqual(commandOf('старт'), 'on');
  assert.strictEqual(commandOf('/status'), 'status');
  assert.strictEqual(commandOf('обнули'), 'reset');
  assert.strictEqual(commandOf('что-то ещё'), null);
});
