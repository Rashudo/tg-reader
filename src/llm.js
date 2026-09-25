const Anthropic = require('@anthropic-ai/sdk');
const { createOpenAICall } = require('./openai');

const PROVIDERS = ['anthropic', 'openai'];

function createAnthropicCall(apiKey) {
  const client = new Anthropic({ apiKey });
  return (request) => client.messages.create(request);
}

function missingKey(config, provider = config.llm.provider) {
  if (!PROVIDERS.includes(provider)) return `неизвестный LLM_PROVIDER=${provider} (бывает ${PROVIDERS.join(' или ')})`;
  if (provider === 'openai') return config.openaiKey ? null : 'не задан OPENAI_API_KEY';
  return config.anthropicKey ? null : 'не задан ANTHROPIC_API_KEY';
}

function createModelCall(config, provider = config.llm.provider) {
  if (provider === 'openai') return createOpenAICall(config.openaiKey);
  return createAnthropicCall(config.anthropicKey);
}

function modelMismatch(provider, model) {
  const name = String(model || '');
  if (provider === 'anthropic' && !name.startsWith('claude-')) {
    return `модель ${name} не похожа на модель Anthropic — проверьте LLM_PROVIDER и названия моделей`;
  }
  if (provider === 'openai' && name.startsWith('claude-')) {
    return `модель ${name} не похожа на модель OpenAI — проверьте LLM_PROVIDER и названия моделей`;
  }
  return null;
}

module.exports = { createModelCall, createAnthropicCall, missingKey, modelMismatch, PROVIDERS };
