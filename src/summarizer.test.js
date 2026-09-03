const test = require('node:test');
const assert = require('node:assert');
const { createSummarizer, estimateCost } = require('./summarizer');

const ITEMS = [
  { id: 10, text: 'Мост закрыли на ремонт', link: 'https://t.me/c/1/10' },
  { id: 11, text: 'Скидки на всё, подпишись', link: 'https://t.me/c/1/11' },
];

function replyWith(text, usage = { input_tokens: 100, output_tokens: 50 }) {
  const calls = [];
  return {
    calls,
    createMessage: async (request) => {
      calls.push(request);
      return { content: [{ type: 'text', text }], usage };
    },
  };
}

const GOOD = JSON.stringify({ groups: [{ topic: 'Город', items: [{ text: 'Мост закрыли' }] }], dropped: 1 });

test('в запрос уходит заданная модель и лимит ответа', async () => {
  const t = replyWith(GOOD);
  const summarizer = createSummarizer({ model: 'claude-haiku-4-5', createMessage: t.createMessage, log: () => {} });
  await summarizer.summarize(ITEMS);
  assert.strictEqual(t.calls[0].model, 'claude-haiku-4-5');
  assert.ok(t.calls[0].max_tokens >= 4000);
});

test('ни thinking, ни effort не отправляются — Haiku их не принимает', async () => {
  const t = replyWith(GOOD);
  const summarizer = createSummarizer({ model: 'claude-haiku-4-5', createMessage: t.createMessage, log: () => {} });
  await summarizer.summarize(ITEMS);
  assert.strictEqual(t.calls[0].thinking, undefined);
  assert.strictEqual(t.calls[0].output_config && t.calls[0].output_config.effort, undefined);
});

test('тексты сообщений и ссылки попадают в промпт', async () => {
  const t = replyWith(GOOD);
  const summarizer = createSummarizer({ createMessage: t.createMessage, log: () => {} });
  await summarizer.summarize(ITEMS);
  const sent = JSON.stringify(t.calls[0].messages);
  assert.match(sent, /Мост закрыли на ремонт/);
  assert.match(sent, /t\.me\/c\/1\/10/);
});

test('структурированный ответ разбирается', async () => {
  const t = replyWith(GOOD);
  const summarizer = createSummarizer({ createMessage: t.createMessage, log: () => {} });
  const result = await summarizer.summarize(ITEMS);
  assert.strictEqual(result.groups[0].topic, 'Город');
  assert.strictEqual(result.dropped, 1);
});

test('ответ не по схеме не роняет прогон, а доходит сырым текстом', async () => {
  const logged = [];
  const t = replyWith('Извините, я отвечу прозой');
  const summarizer = createSummarizer({ createMessage: t.createMessage, log: (m) => logged.push(m) });
  const result = await summarizer.summarize(ITEMS);
  assert.strictEqual(result.raw, 'Извините, я отвечу прозой');
  assert.match(logged.join(' '), /не по схеме/i);
});

test('пустой список сообщений не тратит вызов модели', async () => {
  const t = replyWith(GOOD);
  const summarizer = createSummarizer({ createMessage: t.createMessage, log: () => {} });
  const result = await summarizer.summarize([]);
  assert.strictEqual(t.calls.length, 0);
  assert.deepStrictEqual(result.groups, []);
});

test('ошибка API пробрасывается — вызывающий решает, что делать', async () => {
  const summarizer = createSummarizer({
    createMessage: async () => { throw new Error('rate limited'); },
    log: () => {},
  });
  await assert.rejects(() => summarizer.summarize(ITEMS), /rate limited/);
});

test('в лог пишется стоимость прогона', async () => {
  const logged = [];
  const t = replyWith(GOOD, { input_tokens: 20000, output_tokens: 1000 });
  const summarizer = createSummarizer({ model: 'claude-haiku-4-5', createMessage: t.createMessage, log: (m) => logged.push(m) });
  await summarizer.summarize(ITEMS);
  assert.match(logged.join(' '), /20000/);
  assert.match(logged.join(' '), /\$/);
});

test('стоимость считается по прейскуранту модели', () => {
  assert.strictEqual(estimateCost('claude-haiku-4-5', 1000000, 1000000), 6);
  assert.strictEqual(estimateCost('claude-opus-5', 1000000, 1000000), 30);
  assert.strictEqual(estimateCost('неизвестная-модель', 1000000, 1000000), null);
});

const { systemPrompt } = require('./summarizer');

test('в промпте стоит потолок пунктов и требование ранжировать', () => {
  const prompt = systemPrompt(20);
  assert.match(prompt, /20/);
  assert.match(prompt, /важн/i);
});

test('потолок пунктов настраивается', () => {
  assert.match(systemPrompt(8), /8/);
  assert.ok(!systemPrompt(8).includes('20 '));
});

test('промпт требует склеивать родственные новости в один пункт', () => {
  assert.match(systemPrompt(20), /объедин|склеи|одну строк/i);
});

const { clampSummary } = require('./summarizer');

const wide = {
  groups: [
    { topic: 'А', items: [{ text: '1' }, { text: '2' }, { text: '3' }] },
    { topic: 'Б', items: [{ text: '4' }, { text: '5' }] },
    { topic: 'В', items: [{ text: '6' }] },
  ],
  dropped: 7,
};

test('лишние пункты обрезаются, даже если модель не послушалась', () => {
  const clamped = clampSummary(wide, 4);
  const total = clamped.groups.reduce((n, g) => n + g.items.length, 0);
  assert.strictEqual(total, 4);
});

test('обрезка не оставляет пустых тем', () => {
  const clamped = clampSummary(wide, 3);
  assert.deepStrictEqual(clamped.groups.map((g) => g.topic), ['А']);
});

test('в пределах потолка сводка не трогается', () => {
  assert.deepStrictEqual(clampSummary(wide, 10), wide);
});

test('отброшенные пункты досчитываются к dropped', () => {
  assert.strictEqual(clampSummary(wide, 4).dropped, 9);
});

test('сырой ответ модели обрезка не трогает', () => {
  const raw = { raw: 'проза' };
  assert.deepStrictEqual(clampSummary(raw, 2), raw);
});

test('промпт ограничивает длину пункта', () => {
  assert.match(systemPrompt(20), /слов/);
});

test('промпт требует ставить важное первым — иначе обрезка режет вслепую', () => {
  assert.match(systemPrompt(20), /порядке важности|важное.*перв/i);
});

function failing(times, status, then = GOOD) {
  let left = times;
  const attempts = [];
  return {
    attempts,
    createMessage: async () => {
      attempts.push(Date.now());
      if (left-- > 0) {
        const err = new Error(`перегрузка (${status})`);
        err.status = status;
        throw err;
      }
      return { content: [{ type: 'text', text: then }], usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
}

test('временная ошибка модели переживается повтором', async () => {
  const t = failing(2, 429);
  const summarizer = createSummarizer({ createMessage: t.createMessage, log: () => {}, retryPauseMs: 1 });
  const result = await summarizer.summarize(ITEMS);
  assert.strictEqual(t.attempts.length, 3);
  assert.strictEqual(result.groups[0].topic, 'Город');
});

test('перегрузка сервера тоже повторяется', async () => {
  const t = failing(1, 503);
  const summarizer = createSummarizer({ createMessage: t.createMessage, log: () => {}, retryPauseMs: 1 });
  await summarizer.summarize(ITEMS);
  assert.strictEqual(t.attempts.length, 2);
});

test('повторы не бесконечны', async () => {
  const t = failing(99, 429);
  const summarizer = createSummarizer({ createMessage: t.createMessage, log: () => {}, retryPauseMs: 1 });
  await assert.rejects(() => summarizer.summarize(ITEMS), /перегрузка/);
  assert.strictEqual(t.attempts.length, 3, 'три попытки и хватит');
});

test('ошибка в запросе не повторяется — повтор её не вылечит', async () => {
  const t = failing(99, 400);
  const summarizer = createSummarizer({ createMessage: t.createMessage, log: () => {}, retryPauseMs: 1 });
  await assert.rejects(() => summarizer.summarize(ITEMS));
  assert.strictEqual(t.attempts.length, 1);
});
