const { config } = require('./config');
const { createAnthropicCall, createModelCall, missingKey, modelMismatch } = require('./llm');
const { createSummarizer } = require('./summarizer');
const { runDigest } = require('./digest');
const { peerKey } = require('./peer');
const { isDue } = require('./schedule');

function isConfigured() {
  return !missingKey(config, config.news.provider) && config.news.channels.length > 0;
}

function whyNotConfigured() {
  const why = missingKey(config, config.news.provider);
  if (why) return why;
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
  const mismatch = modelMismatch(config.news.provider, config.news.model);
  if (mismatch) log(`Сводка: ${mismatch}`);

  const summarizer = createSummarizer({
    model: config.news.model,
    effort: config.news.effort,
    createMessage: createMessage || createModelCall(config, config.news.provider),
    maxItems: config.news.maxItems,
    log,
  });

  const run = (state, { now = Date.now(), dryRun = false } = {}) =>
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

  const due = (state, now = Date.now()) =>
    sources.some((source) =>
      isDue(now, {
        hour: config.news.hour,
        timeZone: config.news.timeZone,
        lastRunAt: state.lastDigestRunAt(peerKey(source)),
      })
    );

  return { run, due };
}

module.exports = {
  createNewsDigest,
  createAnthropicCall,
  createModelCall,
  resolveNewsSources,
  isConfigured,
  whyNotConfigured,
};
