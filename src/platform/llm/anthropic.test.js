const test = require('node:test');
const assert = require('node:assert');
const { createLlm, estimateCost } = require('./anthropic');

function failing(times, status) {
  let left = times;
  return async () => {
    if (left > 0) {
      left -= 1;
      const err = new Error('перегрузка');
      err.status = status;
      throw err;
    }
    return { content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 1, output_tokens: 2 } };
  };
}

test('ответ разбирается в json, text и usage', async () => {
  const llm = createLlm({
    request: async () => ({ content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 3, output_tokens: 4 } }),
    log: () => {},
  });
  const answer = await llm.call({ model: 'claude-haiku-4-5', system: 's', messages: [] });
  assert.deepStrictEqual(answer.json, { a: 1 });
  assert.strictEqual(answer.text, '{"a":1}');
  assert.strictEqual(answer.usage.input_tokens, 3);
});

test('ответ не по схеме даёт json === null, а не исключение', async () => {
  const llm = createLlm({ request: async () => ({ content: [{ type: 'text', text: 'извините' }] }), log: () => {} });
  const answer = await llm.call({ model: 'claude-haiku-4-5', system: 's', messages: [] });
  assert.strictEqual(answer.json, null);
  assert.strictEqual(answer.text, 'извините');
});

test('429 приводит к повтору', async () => {
  const llm = createLlm({ request: failing(1, 429), log: () => {}, retryPauseMs: 1 });
  const answer = await llm.call({ model: 'claude-haiku-4-5', system: 's', messages: [] });
  assert.deepStrictEqual(answer.json, { ok: true });
});

test('пятисотая тоже приводит к повтору', async () => {
  const llm = createLlm({ request: failing(2, 503), log: () => {}, retryPauseMs: 1 });
  const answer = await llm.call({ model: 'claude-haiku-4-5', system: 's', messages: [] });
  assert.deepStrictEqual(answer.json, { ok: true });
});

test('три неудачи подряд бросают наружу', async () => {
  const llm = createLlm({ request: failing(3, 429), log: () => {}, retryPauseMs: 1 });
  await assert.rejects(() => llm.call({ model: 'claude-haiku-4-5', system: 's', messages: [] }), /перегрузка/);
});

test('ошибка не из списка повторяемых бросается сразу', async () => {
  let calls = 0;
  const llm = createLlm({
    request: async () => {
      calls += 1;
      const err = new Error('нет доступа');
      err.status = 403;
      throw err;
    },
    log: () => {},
    retryPauseMs: 1,
  });
  await assert.rejects(() => llm.call({ model: 'claude-haiku-4-5', system: 's', messages: [] }), /нет доступа/);
  assert.strictEqual(calls, 1);
});

test('схема добавляется в запрос только когда она есть', async () => {
  const seen = [];
  const llm = createLlm({ request: async (r) => { seen.push(r); return { content: [] }; }, log: () => {} });
  await llm.call({ model: 'm', system: 's', messages: [], schema: { type: 'object' } });
  await llm.call({ model: 'm', system: 's', messages: [] });
  assert.ok(seen[0].output_config);
  assert.strictEqual(seen[1].output_config, undefined);
});

test('стоимость известной модели считается, у незнакомой — null', () => {
  assert.ok(estimateCost('claude-haiku-4-5', 1e6, 1e6) > 0);
  assert.strictEqual(estimateCost('модель-которой-нет', 1e6, 1e6), null);
});
