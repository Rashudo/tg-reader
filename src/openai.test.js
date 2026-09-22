const test = require('node:test');
const assert = require('node:assert');
const { createOpenAICall, toOpenAI, fromOpenAI, strictSchema } = require('./openai');

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'boolean' },
    text: { type: 'string' },
    meme: { type: ['string', 'null'] },
    replyToId: { type: ['integer', 'null'] },
    note: { type: 'string' },
  },
  required: ['reply', 'text'],
  additionalProperties: false,
};

const REQUEST = {
  model: 'gpt-5.4-mini',
  max_tokens: 1200,
  system: 'Ты — Стас.',
  messages: [{ role: 'user', content: 'Последние сообщения чата' }],
  output_config: { format: { type: 'json_schema', schema: SCHEMA }, effort: 'low' },
};

test('строгая схема делает все поля обязательными', () => {
  const strict = strictSchema(SCHEMA);
  assert.deepStrictEqual(strict.required, ['reply', 'text', 'meme', 'replyToId', 'note']);
  assert.strictEqual(strict.additionalProperties, false);
});

test('поле, бывшее необязательным, может прийти пустым', () => {
  const strict = strictSchema(SCHEMA);
  assert.deepStrictEqual(strict.properties.note.type, ['string', 'null']);
  assert.deepStrictEqual(strict.properties.meme.type, ['string', 'null']);
  assert.strictEqual(strict.properties.reply.type, 'boolean');
});

test('вложенные объекты и массивы тоже становятся строгими', () => {
  const strict = strictSchema({
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, link: { type: 'string' } },
          required: ['text'],
        },
      },
    },
    required: ['groups'],
  });
  const item = strict.properties.groups.items;
  assert.deepStrictEqual(item.required, ['text', 'link']);
  assert.deepStrictEqual(item.properties.link.type, ['string', 'null']);
  assert.strictEqual(item.additionalProperties, false);
});

test('исходная схема не портится', () => {
  strictSchema(SCHEMA);
  assert.deepStrictEqual(SCHEMA.required, ['reply', 'text']);
});

test('запрос переводится в формат OpenAI', () => {
  const body = toOpenAI(REQUEST);
  assert.strictEqual(body.model, 'gpt-5.4-mini');
  assert.strictEqual(body.max_completion_tokens, 1200);
  assert.deepStrictEqual(body.messages[0], { role: 'system', content: 'Ты — Стас.' });
  assert.deepStrictEqual(body.messages[1], { role: 'user', content: 'Последние сообщения чата' });
  assert.strictEqual(body.response_format.type, 'json_schema');
  assert.strictEqual(body.response_format.json_schema.strict, true);
  assert.strictEqual(body.reasoning_effort, 'low');
});

test('без усилия reasoning_effort не шлётся', () => {
  const body = toOpenAI({ ...REQUEST, output_config: { format: REQUEST.output_config.format } });
  assert.strictEqual('reasoning_effort' in body, false);
});

test('картинка уходит как data-url', () => {
  const body = toOpenAI({
    ...REQUEST,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'AAA' } },
          { type: 'text', text: 'Это стикер.' },
        ],
      },
    ],
  });
  assert.deepStrictEqual(body.messages[1].content, [
    { type: 'image_url', image_url: { url: 'data:image/webp;base64,AAA' } },
    { type: 'text', text: 'Это стикер.' },
  ]);
});

test('ответ приводится к виду, который ждёт остальной код', () => {
  const out = fromOpenAI({
    choices: [{ message: { content: '{"reply":true}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  });
  assert.deepStrictEqual(out.content, [{ type: 'text', text: '{"reply":true}' }]);
  assert.deepStrictEqual(out.usage, { input_tokens: 100, output_tokens: 20 });
  assert.strictEqual(out.stop_reason, 'end_turn');
});

test('отказ модели виден как отказ', () => {
  const out = fromOpenAI({
    choices: [{ message: { content: null, refusal: 'Не могу помочь' }, finish_reason: 'stop' }],
    usage: {},
  });
  assert.strictEqual(out.stop_reason, 'refusal');
  assert.strictEqual(out.stop_details.explanation, 'Не могу помочь');
});

test('обрезанный по длине ответ помечается', () => {
  const out = fromOpenAI({ choices: [{ message: { content: '{' }, finish_reason: 'length' }], usage: {} });
  assert.strictEqual(out.stop_reason, 'max_tokens');
});

test('вызов идёт с ключом и возвращает приведённый ответ', async () => {
  const seen = [];
  const call = createOpenAICall('sk-test', {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: {} }),
      };
    },
  });
  const out = await call(REQUEST);
  assert.match(seen[0].url, /chat\/completions$/);
  assert.strictEqual(seen[0].init.headers.Authorization, 'Bearer sk-test');
  assert.strictEqual(out.content[0].text, '{}');
});

test('ошибка API несёт статус, чтобы сводка могла повторить запрос', async () => {
  const call = createOpenAICall('sk-test', {
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'Rate limit' } }) }),
  });
  await assert.rejects(() => call(REQUEST), (err) => err.status === 429 && /Rate limit/.test(err.message));
});
