const test = require('node:test');
const assert = require('node:assert');
const { missingKey, createModelCall, modelMismatch, PROVIDERS } = require('./llm');

const base = { anthropicKey: 'sk-ant', openaiKey: 'sk-proj' };

test('поставщики известны заранее', () => {
  assert.deepStrictEqual(PROVIDERS, ['anthropic', 'openai']);
});

test('с ключом нужного поставщика всё в порядке', () => {
  assert.strictEqual(missingKey({ ...base, llm: { provider: 'anthropic' } }), null);
  assert.strictEqual(missingKey({ ...base, llm: { provider: 'openai' } }), null);
});

test('без ключа OpenAI сказано, какого именно', () => {
  assert.strictEqual(missingKey({ ...base, openaiKey: '', llm: { provider: 'openai' } }), 'не задан OPENAI_API_KEY');
});

test('без ключа Anthropic сказано, какого именно', () => {
  assert.strictEqual(missingKey({ ...base, anthropicKey: '', llm: { provider: 'anthropic' } }), 'не задан ANTHROPIC_API_KEY');
});

test('опечатка в поставщике не выдаётся за отсутствие ключа', () => {
  assert.match(missingKey({ ...base, llm: { provider: 'chatgpt' } }), /LLM_PROVIDER=chatgpt/);
});

test('для каждого поставщика создаётся вызов', () => {
  assert.strictEqual(typeof createModelCall({ ...base, llm: { provider: 'anthropic' } }), 'function');
  assert.strictEqual(typeof createModelCall({ ...base, llm: { provider: 'openai' } }), 'function');
});

test('поставщика можно задать отдельно от общего', () => {
  const config = { ...base, llm: { provider: 'openai' } };
  assert.strictEqual(typeof createModelCall(config, 'anthropic'), 'function');
  assert.strictEqual(missingKey({ ...config, anthropicKey: '' }, 'anthropic'), 'не задан ANTHROPIC_API_KEY');
  assert.strictEqual(missingKey(config, 'anthropic'), null);
});

test('модель не от того поставщика видна сразу', () => {
  assert.match(modelMismatch('anthropic', 'gpt-6-astra'), /gpt-6-astra/);
  assert.match(modelMismatch('openai', 'claude-fable-5-1'), /claude-fable-5-1/);
  assert.strictEqual(modelMismatch('anthropic', 'claude-fable-5-1'), null);
  assert.strictEqual(modelMismatch('openai', 'gpt-5.5'), null);
  assert.strictEqual(modelMismatch('openai', 'o3-mini'), null);
});
