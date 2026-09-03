const test = require('node:test');
const assert = require('node:assert');
const { runDigest } = require('./digest');

const NOW = Date.parse('2026-09-03T05:00:00Z');
const SOURCE = { id: 1, title: 'Новости', username: 'news' };

function msg(id, text, hoursAgo = 1) {
  return { id, message: text, date: Math.floor((NOW - hoursAgo * 3600 * 1000) / 1000) };
}

function harness({ messages = [], summary = { groups: [], dropped: 0 }, summarizeFails = false } = {}) {
  const sent = [];
  const alerts = [];
  const asked = [];
  const store = { upTo: null, runAt: null };
  return {
    sent,
    alerts,
    asked,
    store,
    deps: {
      client: {
        getMessages: async (entity, params) => {
          asked.push(params);
          return messages;
        },
        sendMessage: async (target, params) => { sent.push({ target, params }); return { id: sent.length }; },
      },
      sources: [SOURCE],
      summarizer: {
        summarize: async (items) => {
          if (summarizeFails) throw new Error('модель недоступна');
          asked.push({ items });
          return summary;
        },
      },
      state: {
        digestUpTo: () => store.upTo,
        setDigestUpTo: (key, id) => { store.upTo = id; },
        setDigestRunAt: (at) => { store.runAt = at; },
      },
      peerKeyOf: () => '-1001',
      target: 'кому',
      maxMessages: 3,
      timeZone: 'Europe/Belgrade',
      now: NOW,
      log: () => {},
      notify: async (text) => { alerts.push(text); },
    },
  };
}

test('сводка уходит получателю без разметки', async () => {
  const h = harness({
    messages: [msg(10, 'Мост закрыли')],
    summary: { groups: [{ topic: 'Город', items: [{ text: 'Мост закрыли' }] }], dropped: 0 },
  });
  await runDigest(h.deps);
  assert.strictEqual(h.sent.length, 1);
  assert.strictEqual(h.sent[0].target, 'кому');
  assert.strictEqual(h.sent[0].params.parseMode, false);
  assert.match(h.sent[0].params.message, /Мост закрыли/);
});

test('позиция двигается только после успешной отправки', async () => {
  const h = harness({ messages: [msg(10, 'а'), msg(12, 'б')], summary: { groups: [], dropped: 2 } });
  await runDigest(h.deps);
  assert.strictEqual(h.store.upTo, 12);
  assert.strictEqual(h.store.runAt, NOW);
});

test('ошибка модели не двигает позицию и поднимает тревогу', async () => {
  const h = harness({ messages: [msg(10, 'а')], summarizeFails: true });
  await runDigest(h.deps);
  assert.strictEqual(h.store.upTo, null);
  assert.strictEqual(h.sent.length, 0);
  assert.match(h.alerts.join(' '), /модель недоступна/);
});

test('пробный прогон ничего не отправляет и не двигает позицию', async () => {
  const h = harness({
    messages: [msg(10, 'а')],
    summary: { groups: [{ topic: 'Т', items: [{ text: 'а' }] }], dropped: 0 },
  });
  const result = await runDigest({ ...h.deps, dryRun: true });
  assert.strictEqual(h.sent.length, 0);
  assert.strictEqual(h.store.upTo, null);
  assert.match(result.parts.join(' '), /Т/);
});

test('сообщения без текста до модели не доходят', async () => {
  const h = harness({ messages: [msg(10, ''), msg(11, null), msg(12, 'настоящая новость')] });
  await runDigest(h.deps);
  const call = h.asked.find((c) => c.items);
  assert.strictEqual(call.items.length, 1);
  assert.strictEqual(call.items[0].text, 'настоящая новость');
});

test('за раз берётся не больше потолка, и это самые свежие', async () => {
  const many = [msg(1, 'один'), msg(2, 'два'), msg(3, 'три'), msg(4, 'четыре'), msg(5, 'пять')];
  const h = harness({ messages: many });
  await runDigest(h.deps);
  const call = h.asked.find((c) => c.items);
  assert.strictEqual(call.items.length, 3);
  assert.deepStrictEqual(call.items.map((i) => i.id), [3, 4, 5]);
});

test('со второго раза берём только то, что новее прошлой сводки', async () => {
  const h = harness({ messages: [msg(10, 'а')] });
  h.store.upTo = 7;
  await runDigest(h.deps);
  assert.strictEqual(h.asked[0].minId, 7);
});

test('в первый раз окно ограничено сутками, а не всей историей', async () => {
  const h = harness({ messages: [msg(10, 'вчерашняя', 30), msg(11, 'сегодняшняя', 2)] });
  await runDigest(h.deps);
  const call = h.asked.find((c) => c.items);
  assert.deepStrictEqual(call.items.map((i) => i.text), ['сегодняшняя']);
});

test('длинная сводка уходит несколькими сообщениями по порядку', async () => {
  const groups = Array.from({ length: 40 }, (_, i) => ({ topic: `Тема ${i}`, items: [{ text: 'я'.repeat(300) }] }));
  const h = harness({ messages: [msg(10, 'а')], summary: { groups, dropped: 0 } });
  await runDigest(h.deps);
  assert.ok(h.sent.length > 1);
  assert.match(h.sent[0].params.message, /Тема 0/);
});

test('пустой канал не тревожит ни модель, ни получателя', async () => {
  const h = harness({ messages: [] });
  await runDigest(h.deps);
  assert.strictEqual(h.sent.length, 0);
  assert.strictEqual(h.alerts.length, 0);
});

test('без ссылок они не уходят ни в модель, ни в текст', async () => {
  const h = harness({
    messages: [msg(10, 'Новость дня')],
    summary: { groups: [{ topic: 'Т', items: [{ text: 'Новость дня' }] }], dropped: 0 },
  });
  await runDigest({ ...h.deps, includeLinks: false });
  const call = h.asked.find((c) => c.items);
  assert.strictEqual(call.items[0].link, undefined);
  assert.ok(!h.sent[0].params.message.includes('t.me'));
});

test('со ссылками они доходят до модели', async () => {
  const h = harness({ messages: [msg(10, 'Новость дня')] });
  await runDigest({ ...h.deps, includeLinks: true });
  const call = h.asked.find((c) => c.items);
  assert.match(call.items[0].link, /t\.me/);
});
