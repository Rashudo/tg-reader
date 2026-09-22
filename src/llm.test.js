const test = require('node:test');
const assert = require('node:assert');
const { missingKey, createModelCall, PROVIDERS } = require('./llm');

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
