const Anthropic = require('@anthropic-ai/sdk');

const MAX_TOKENS = 16000;
const ATTEMPTS = 3;
const RETRY_PAUSE_MS = 5000;

const PRICES = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function worthRetrying(err) {
  return err.status === 429 || (err.status >= 500 && err.status < 600);
}

async function withRetries(call, { attempts, pauseMs, log }) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (err) {
      if (attempt >= attempts || !worthRetrying(err)) throw err;
      log(`Модель ответила ошибкой (${err.message}), попытка ${attempt + 1} из ${attempts}`);
      await sleep(pauseMs * attempt);
    }
  }
}

function estimateCost(model, inputTokens, outputTokens) {
  const price = PRICES[model];
  if (!price) return null;
  return (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
}

function textOf(response) {
  const block = ((response && response.content) || []).find((part) => part.type === 'text');
  return block ? block.text : '';
}

function anthropicRequest(apiKey) {
  const client = new Anthropic({ apiKey });
  return (request) => client.messages.create(request);
}

function createLlm({ apiKey, request, log = console.log, attempts = ATTEMPTS, retryPauseMs = RETRY_PAUSE_MS }) {
  const send = request || anthropicRequest(apiKey);

  return {
    async call({ model, system, messages, schema, maxTokens = MAX_TOKENS }) {
      const response = await withRetries(
        () =>
          send({
            model,
            max_tokens: maxTokens,
            system,
            messages,
            ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
          }),
        { attempts, pauseMs: retryPauseMs, log }
      );

      const usage = response.usage || {};
      const text = textOf(response);
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (err) {
        json = null;
      }
      return { json, text, usage, cost: estimateCost(model, usage.input_tokens || 0, usage.output_tokens || 0) };
    },
    estimateCost,
  };
}

module.exports = { createLlm, estimateCost, anthropicRequest, MAX_TOKENS, ATTEMPTS, RETRY_PAUSE_MS };
