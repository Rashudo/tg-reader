const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('./config');
const { createSummarizer } = require('./summarizer');
const { runDigest } = require('./digest');
const { peerKey } = require('./peer');
const { isDue } = require('./schedule');

function createAnthropicCall(apiKey) {
  const client = new Anthropic({ apiKey });
  return (request) => client.messages.create(request);
}

function isConfigured() {
  return Boolean(config.anthropicKey) && config.news.channels.length > 0;
}

function whyNotConfigured() {
  if (!config.anthropicKey) return 'не задан ANTHROPIC_API_KEY';
  if (config.news.channels.length === 0) return 'не задан NEWS_CHANNELS';
  return null;
}

async function resolveNewsSources(client, log) {
  const sources = [];
  for (const ref of config.news.channels) {
    try {
      const entity = await client.getEntity(ref);
      sources.push(entity);
      log(`Сводка: источник ${entity.title || entity.username || ref}`);
    } catch (err) {
      log(`Сводка: канал "${ref}" открыть не удалось (${err.message}) — пропускаю`);
    }
  }
  return sources;
}

function createNewsDigest({ client, sources, target, notify, log, createMessage }) {
  const summarizer = createSummarizer({
    model: config.news.model,
    createMessage: createMessage || createAnthropicCall(config.anthropicKey),
    maxItems: config.news.maxItems,
    log,
  });

  return (state, { now = Date.now(), dryRun = false } = {}) =>
    runDigest({
      client,
      sources,
      summarizer,
      state,
      peerKeyOf: peerKey,
      target,
      maxMessages: config.news.maxMessages,
      timeZone: config.news.timeZone,
      includeLinks: config.news.links,
      now,
      log,
      notify,
      dryRun,
    });
}

function digestDue(state, now = Date.now()) {
  return isDue(now, {
    hour: config.news.hour,
    timeZone: config.news.timeZone,
    lastRunAt: state.lastDigestRunAt(),
  });
}

module.exports = {
  createNewsDigest,
  createAnthropicCall,
  resolveNewsSources,
  digestDue,
  isConfigured,
  whyNotConfigured,
};
