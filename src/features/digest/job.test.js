const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../../platform/db/open');
const { createManualClock } = require('../../platform/clock');
const { createFakeGateway } = require('../../platform/telegram/fake');
const { createFakeLlm } = require('../../platform/llm/fake');
const { createDigestStore } = require('./store');
const { createDigestJob, resolveChats } = require('./job');

const KEY = '-100111';
const NOW = Date.UTC(2026, 8, 4, 12);
const GOOD = JSON.stringify({ groups: [{ topic: 'Город', items: [{ text: 'Открыли мост' }] }], dropped: 0 });

function bench({ answers = [GOOD], errors = [] } = {}) {
  const clock = createManualClock(NOW);
  const gateway = createFakeGateway({ clock });
  const chat = { key: KEY, title: 'Новости', username: 'news', id: 111 };
  gateway.addChat('@news', chat);
  gateway.addChat('получатель', { key: '-100999', title: 'Избранное', username: null, id: 999 });
  const store = createDigestStore(openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dj-')), 'state.db')));
  const llm = createFakeLlm({ answers, errors });
  const logs = [];
  const alerts = [];
  const job = createDigestJob({
    gateway, store, llm, chats: [chat], target: 'получатель',
    model: 'claude-haiku-4-5', maxItems: 20, maxMessages: 100,
    timeZone: 'UTC', hour: 7, includeLinks: false, clock,
    log: (m) => logs.push(m), notify: async (t) => alerts.push(t),
  });
  const post = (id, text, at = NOW) => ({
    id, chatKey: KEY, at, text, from: '5', author: null, replyTo: null, groupId: null, link: `l${id}`,
  });
  return { job, gateway, store, llm, logs, alerts, chat, post, clock };
}

test('сводка собирается, отправляется и двигает курсор', async () => {
  const h = bench();
  h.gateway.seed(KEY, [h.post(10, 'Мост открыли'), h.post(11, 'Дождь')]);
  await h.job.run();
  assert.strictEqual(h.gateway.sent.length, 1);
  assert.match(h.gateway.sent[0].text, /Открыли мост/);
  assert.strictEqual(h.store.upTo(KEY), 11);
});

test('время прогона ставится до сборки, а не после успеха', async () => {
  const h = bench({ answers: [GOOD], errors: [new Error('модель легла')] });
  h.gateway.seed(KEY, [h.post(10, 'Мост открыли')]);
  await h.job.run();
  assert.strictEqual(h.store.lastRunAt(KEY), NOW, 'иначе упавшая сводка повторялась бы каждые десять минут');
  assert.strictEqual(h.store.upTo(KEY), null, 'курсор двигается только после успешной отправки');
});

test('пробный прогон ничего не отправляет и не трогает состояние', async () => {
  const h = bench();
  h.gateway.seed(KEY, [h.post(10, 'Мост открыли')]);
  const { parts } = await h.job.run({ dryRun: true });
  assert.ok(parts.length > 0);
  assert.deepStrictEqual(h.gateway.sent, []);
  assert.strictEqual(h.store.lastRunAt(KEY), null);
  assert.strictEqual(h.store.upTo(KEY), null);
});

test('пустой период не тратит вызов модели', async () => {
  const h = bench();
  h.gateway.seed(KEY, []);
  await h.job.run();
  assert.strictEqual(h.llm.calls.length, 0);
  assert.match(h.logs.join(' '), /нечего собирать/);
});

test('ошибка модели гасится в лог и тревогу, а не наружу', async () => {
  const h = bench({ errors: [new Error('модель легла')] });
  h.gateway.seed(KEY, [h.post(10, 'Мост открыли')]);
  await assert.doesNotReject(() => h.job.run());
  assert.match(h.alerts.join(' '), /сводку собрать не удалось/);
});

test('ответ не по схеме доходит сырым текстом', async () => {
  const h = bench({ answers: ['извините, не могу'] });
  h.gateway.seed(KEY, [h.post(10, 'Мост открыли')]);
  await h.job.run();
  assert.match(h.gateway.sent.map((p) => p.text).join(' '), /извините/);
});

test('в лог пишется модель и стоимость прогона', async () => {
  const h = bench();
  h.gateway.seed(KEY, [h.post(10, 'Мост открыли')]);
  await h.job.run();
  assert.match(h.logs.join(' '), /claude-haiku-4-5/);
  assert.match(h.logs.join(' '), /токенов на входе/);
});

test('второй прогон в те же сутки не пора', async () => {
  const h = bench();
  assert.strictEqual(h.job.due(NOW), true);
  h.store.setRunAt(KEY, NOW);
  assert.strictEqual(h.job.due(NOW), false);
});

test('неоткрывшийся канал пропускается, а не роняет сводку', async () => {
  const h = bench();
  const chats = await resolveChats(h.gateway, ['@news', '@нет-такого'], (m) => h.logs.push(m));
  assert.strictEqual(chats.length, 1);
  assert.match(h.logs.join(' '), /открыть не удалось/);
});
