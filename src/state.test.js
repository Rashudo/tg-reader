const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createState, SENT_MEMORY, POSTED_MEMORY } = require('./state');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-state-')), 'state.json');
}

test('позиция сохраняется и переживает перезапуск', () => {
  const file = tmpFile();
  const state = createState(file);
  assert.strictEqual(state.lastId('-1001'), null);
  state.advance('-1001', 42);
  state.flush();
  assert.strictEqual(createState(file).lastId('-1001'), 42);
});

test('позиция только растёт', () => {
  const state = createState(tmpFile());
  state.advance('-1001', 42);
  state.advance('-1001', 10);
  assert.strictEqual(state.lastId('-1001'), 42);
});

test('битый файл не роняет запуск', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'не json');
  assert.strictEqual(createState(file).lastId('-1001'), null);
});

test('нечисловые значения игнорируются', () => {
  const state = createState(tmpFile());
  state.advance('-1001', undefined);
  state.advance('-1001', 1.5);
  assert.strictEqual(state.lastId('-1001'), null);
});

test('отправленное помнится после перезапуска — правка поста не даёт дубль', () => {
  const file = tmpFile();
  const state = createState(file);
  assert.strictEqual(state.wasSent('-1001', 500), false);
  state.markSent('-1001', 500);
  state.flush();

  const restarted = createState(file);
  assert.strictEqual(restarted.wasSent('-1001', 500), true);
  assert.strictEqual(restarted.wasSent('-1001', 501), false);
});

test('память об отправленных ограничена и вытесняет самое старое', () => {
  const state = createState(tmpFile());
  for (let id = 1; id <= SENT_MEMORY + 10; id += 1) state.markSent('-1001', id);
  assert.strictEqual(state.wasSent('-1001', 1), false);
  assert.strictEqual(state.wasSent('-1001', SENT_MEMORY + 10), true);
});

test('каналы не мешают друг другу', () => {
  const state = createState(tmpFile());
  state.markSent('-1001', 7);
  state.advance('-1001', 7);
  assert.strictEqual(state.wasSent('-1002', 7), false);
  assert.strictEqual(state.lastId('-1002'), null);
});

test('старый формат файла (просто число) читается без потери позиции', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ '-1001570959321': 692664 }));
  const state = createState(file);
  assert.strictEqual(state.lastId('-1001570959321'), 692664);
  assert.strictEqual(state.wasSent('-1001570959321', 692664), false);
});

test('время последнего сообщения запоминается и растёт только вперёд', () => {
  const state = createState(tmpFile());
  state.noteSeen('-1001', 1, 5000);
  state.noteSeen('-1001', 1, 3000);
  assert.strictEqual(state.lastMessageAt(), 5000);
});

test('время последнего сообщения — максимум по всем каналам', () => {
  const state = createState(tmpFile());
  state.noteSeen('-1001', 1, 5000);
  state.noteSeen('-1002', 1, 9000);
  assert.strictEqual(state.lastMessageAt(), 9000);
});

test('пока не видели ни одного сообщения, времени нет', () => {
  assert.strictEqual(createState(tmpFile()).lastMessageAt(), null);
});

test('счётчики проверенного и пересланного переживают перезапуск', () => {
  const file = tmpFile();
  const state = createState(file);
  state.noteSeen('-1001', 8, 1000);
  state.markSent('-1001', 500);
  state.markSent('-1001', 501);
  state.flush();
  assert.deepStrictEqual(createState(file).totals(), { checked: 8, forwarded: 2 });
});

test('счётчики суммируются по каналам', () => {
  const state = createState(tmpFile());
  state.noteSeen('-1001', 3, 1000);
  state.noteSeen('-1002', 4, 1000);
  assert.strictEqual(state.totals().checked, 7);
});

test('файл прежней версии читается, счётчики начинаются с нуля', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ '-1001': { lastId: 10, sent: [1, 2] } }));
  const state = createState(file);
  assert.strictEqual(state.lastId('-1001'), 10);
  assert.deepStrictEqual(state.totals(), { checked: 0, forwarded: 0 });
  assert.strictEqual(state.lastMessageAt(), null);
});

test('время старта сервиса хранится и переживает перезапуск', () => {
  const file = tmpFile();
  const state = createState(file);
  assert.strictEqual(state.startedAt(), null);
  state.setStartedAt(1700000000000);
  state.flush();
  assert.strictEqual(createState(file).startedAt(), 1700000000000);
});

test('служебная запись не попадает в счётчики и во время сообщений', () => {
  const file = tmpFile();
  const state = createState(file);
  state.setStartedAt(1700000000000);
  state.noteSeen('-1001', 2, 5000);
  state.flush();

  const restarted = createState(file);
  assert.deepStrictEqual(restarted.totals(), { checked: 2, forwarded: 0 });
  assert.strictEqual(restarted.lastMessageAt(), 5000);
  assert.strictEqual(restarted.lastId('_service'), null);
});

test('позиция сводки хранится отдельно от позиции поиска по словам', () => {
  const file = tmpFile();
  const state = createState(file);
  state.advance('-1001', 500);
  state.setDigestUpTo('-1001', 480);
  state.flush();

  const restarted = createState(file);
  assert.strictEqual(restarted.lastId('-1001'), 500);
  assert.strictEqual(restarted.digestUpTo('-1001'), 480);
});

test('позиция сводки только растёт', () => {
  const state = createState(tmpFile());
  state.setDigestUpTo('-1001', 480);
  state.setDigestUpTo('-1001', 100);
  assert.strictEqual(state.digestUpTo('-1001'), 480);
});

test('до первой сводки позиции нет', () => {
  assert.strictEqual(createState(tmpFile()).digestUpTo('-1001'), null);
});

test('время последней сводки переживает перезапуск', () => {
  const file = tmpFile();
  const state = createState(file);
  assert.strictEqual(state.lastDigestRunAt('-1001'), null);
  state.setDigestRunAt('-1001', 1788000000000);
  state.flush();
  assert.strictEqual(createState(file).lastDigestRunAt('-1001'), 1788000000000);
});

test('чтение состояния не создаёт записей', () => {
  const file = tmpFile();
  const state = createState(file);
  state.lastId('-1009');
  state.wasSent('-1009', 5);
  state.digestUpTo('-1009');
  state.flush();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(Object.keys(saved).filter((k) => k !== '_service'), []);
});

test('отметка о суточном прогоне хранится по каналу', () => {
  const file = tmpFile();
  const state = createState(file);
  state.setDigestRunAt('-1001', 1788000000000);
  state.flush();

  const restarted = createState(file);
  assert.strictEqual(restarted.lastDigestRunAt('-1001'), 1788000000000);
  assert.strictEqual(restarted.lastDigestRunAt('-1002'), null, 'второй канал живёт своей жизнью');
});

test('старая общая отметка читается как отметка любого канала — апгрейд не даёт двойной сводки', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ _service: { lastDigestRunAt: 1788000000000 } }));
  const state = createState(file);
  assert.strictEqual(state.lastDigestRunAt('-1001'), 1788000000000);
});

test('новая отметка по каналу перекрывает старую общую', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({
    '-1001': { digestRunAt: 1788009999999 },
    _service: { lastDigestRunAt: 1788000000000 },
  }));
  assert.strictEqual(createState(file).lastDigestRunAt('-1001'), 1788009999999);
});

test('режим работы сервиса виден снаружи и переживает перезапуск', () => {
  const file = tmpFile();
  const state = createState(file);
  assert.strictEqual(state.forwarding(), true, 'по умолчанию считаем, что пересылка есть');
  state.setForwarding(false);
  state.flush();
  assert.strictEqual(createState(file).forwarding(), false);
});

test('момент подтверждённой тишины переживает перезапуск', () => {
  const file = tmpFile();
  const first = createState(file);
  first.setProbeOkAt(1700000000000);
  first.flush();
  assert.strictEqual(createState(file).probeOkAt(), 1700000000000);
});

test('выключённые ответы переживают перезапуск', () => {
  const file = tmpFile();
  const first = createState(file);
  first.setRepliesEnabled(false);
  first.flush();
  assert.strictEqual(createState(file).repliesEnabled(), false);
});

test('по умолчанию ответы включены', () => {
  assert.strictEqual(createState(tmpFile()).repliesEnabled(), true);
});

test('счётчики ответов обнуляются со сменой суток', () => {
  const s = createState(tmpFile());
  s.noteReply('spontaneous', 1000, '2026-09-04');
  s.noteReply('addressed', 1000, '2026-09-04');
  assert.strictEqual(s.replyCounters('2026-09-04').spontaneous, 1);
  assert.strictEqual(s.replyCounters('2026-09-04').addressed, 1);
  assert.strictEqual(s.replyCounters('2026-09-05').spontaneous, 0);
});

test('момент последнего ответа виден по видам отдельно', () => {
  const s = createState(tmpFile());
  s.noteReply('spontaneous', 5000, '2026-09-04');
  assert.strictEqual(s.replyCounters('2026-09-04').lastSpontaneousAt, 5000);
  assert.strictEqual(s.replyCounters('2026-09-04').lastAddressedAt, 0);
});

test('на одно сообщение отвечаем один раз даже после перезапуска', () => {
  const file = tmpFile();
  const s = createState(file);
  s.noteAnswered(42);
  s.flush();
  assert.strictEqual(createState(file).wasAnswered(42), true);
  assert.strictEqual(createState(file).wasAnswered(43), false);
});

test('смещение бота хранится между запусками', () => {
  const file = tmpFile();
  const s = createState(file);
  s.setBotOffset(17);
  s.flush();
  assert.strictEqual(createState(file).botOffset(), 17);
});

test('сказанное ботом переживает перезапуск', () => {
  const file = tmpFile();
  const first = createState(file);
  first.noteSaid('только на рот парня');
  first.noteSaid('два рта в одном тимуре');
  first.flush();
  assert.deepStrictEqual(createState(file).recentReplies(), ['только на рот парня', 'два рта в одном тимуре']);
});

test('память о сказанном не растёт бесконечно', () => {
  const s = createState(tmpFile());
  for (let i = 0; i < 20; i += 1) s.noteSaid(`реплика ${i}`);
  const kept = s.recentReplies();
  assert.strictEqual(kept.length, 8);
  assert.strictEqual(kept.at(-1), 'реплика 19');
});

test('сброс обнуляет счётчики, но не трогает память о сказанном', () => {
  const s = createState(tmpFile());
  s.noteReply('addressed', 1000, '2026-09-04');
  s.noteSaid('была такая реплика');
  s.noteAnswered(7);
  s.resetReplyCounters();
  const counters = s.replyCounters('2026-09-04');
  assert.strictEqual(counters.addressed, 0);
  assert.strictEqual(counters.lastAddressedAt, 0);
  assert.deepStrictEqual(s.recentReplies(), ['была такая реплика']);
  assert.strictEqual(s.wasAnswered(7), true);
});

test('сброс переживает перезапуск', () => {
  const file = tmpFile();
  const first = createState(file);
  first.noteReply('spontaneous', 1000, '2026-09-04');
  first.resetReplyCounters();
  first.flush();
  assert.strictEqual(createState(file).replyCounters('2026-09-04').spontaneous, 0);
});

test('отправленная реплика запоминается вместе с id уведомления', () => {
  const s = createState(tmpFile());
  s.notePosted({ id: 174912, noteId: 55, text: 'ну да, конечно', at: 1000 });
  assert.deepStrictEqual(s.postedReplies(), [
    { id: 174912, noteId: 55, text: 'ну да, конечно', at: 1000, chat: { good: 0, bad: 0 }, note: { good: 0, bad: 0 } },
  ]);
});

test('оценка из чата ложится на нужную реплику', () => {
  const s = createState(tmpFile());
  s.notePosted({ id: 1, noteId: 11, text: 'первая', at: 1000 });
  s.notePosted({ id: 2, noteId: 12, text: 'вторая', at: 2000 });
  const hit = s.gradeFromChat(2, { good: 3, bad: 0 });
  assert.strictEqual(hit.text, 'вторая');
  assert.deepStrictEqual(s.postedReplies()[1].chat, { good: 3, bad: 0 });
  assert.deepStrictEqual(s.postedReplies()[0].chat, { good: 0, bad: 0 });
});

test('оценка из лички находит реплику по id уведомления', () => {
  const s = createState(tmpFile());
  s.notePosted({ id: 1, noteId: 11, text: 'первая', at: 1000 });
  const hit = s.gradeFromNote(11, { good: 0, bad: 1 });
  assert.strictEqual(hit.text, 'первая');
  assert.deepStrictEqual(s.postedReplies()[0].note, { good: 0, bad: 1 });
});

test('оценка по незнакомому сообщению никого не задевает', () => {
  const s = createState(tmpFile());
  s.notePosted({ id: 1, noteId: 11, text: 'первая', at: 1000 });
  assert.strictEqual(s.gradeFromChat(999, { good: 1, bad: 0 }), null);
  assert.strictEqual(s.gradeFromNote(999, { good: 1, bad: 0 }), null);
  assert.deepStrictEqual(s.postedReplies()[0].chat, { good: 0, bad: 0 });
});

test('память об отправленных репликах ограничена', () => {
  const s = createState(tmpFile());
  for (let i = 1; i <= POSTED_MEMORY + 5; i += 1) s.notePosted({ id: i, noteId: null, text: `реплика ${i}`, at: i });
  const posted = s.postedReplies();
  assert.strictEqual(posted.length, POSTED_MEMORY);
  assert.strictEqual(posted[0].id, 6);
});

test('оценки переживают перезапуск', () => {
  const file = tmpFile();
  const first = createState(file);
  first.notePosted({ id: 1, noteId: 11, text: 'первая', at: 1000 });
  first.gradeFromChat(1, { good: 2, bad: 0 });
  first.flush();
  assert.deepStrictEqual(createState(file).postedReplies()[0].chat, { good: 2, bad: 0 });
});

test('снятая реакция обнуляет прежнюю оценку', () => {
  const s = createState(tmpFile());
  s.notePosted({ id: 1, noteId: 11, text: 'первая', at: 1000 });
  s.gradeFromChat(1, { good: 2, bad: 0 });
  s.gradeFromChat(1, { good: 0, bad: 0 });
  assert.deepStrictEqual(s.postedReplies()[0].chat, { good: 0, bad: 0 });
});

test('состояние без раздела оценок читается как пустое', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ _service: { replies: { said: ['привет'] } } }));
  const s = createState(file);
  assert.deepStrictEqual(s.postedReplies(), []);
  assert.deepStrictEqual(s.recentReplies(), ['привет']);
});
