const Anthropic = require('@anthropic-ai/sdk');
const { createOpenAICall } = require('./openai');

const PROVIDERS = ['anthropic', 'openai'];

function createAnthropicCall(apiKey) {
  const client = new Anthropic({ apiKey });
  return (request) => client.messages.create(request);
}

function missingKey(config) {
  const provider = config.llm.provider;
  if (!PROVIDERS.includes(provider)) return `неизвестный LLM_PROVIDER=${provider} (бывает ${PROVIDERS.join(' или ')})`;
  if (provider === 'openai') return config.openaiKey ? null : 'не задан OPENAI_API_KEY';
  return config.anthropicKey ? null : 'не задан ANTHROPIC_API_KEY';
}

function createModelCall(config) {
  if (config.llm.provider === 'openai') return createOpenAICall(config.openaiKey);
  return createAnthropicCall(config.anthropicKey);
}

module.exports = { createModelCall, createAnthropicCall, missingKey, PROVIDERS };
