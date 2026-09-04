const fs = require('fs');
const { config } = require('./config');
const { serviceSetup } = require('./platform/config');
const { createClient } = require('./client');
const { createState } = require('./state');
const { createGateway } = require('./platform/telegram/gateway');
const { createClock } = require('./platform/clock');
const { createLlm } = require('./platform/llm/anthropic');
const { createDigestJob, resolveChats, summarize } = require('./features/digest/job');
const { renderDigest } = require('./features/digest/render');
const { withTimeout } = require('./async');
const { parseDigestArgs } = require('./cli-args');

const args = parseDigestArgs(process.argv.slice(2));

function log(...parts) {
  console.log(new Date().toISOString(), ...parts);
}

async function fromFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = (Array.isArray(raw) ? raw : raw.items || [])
    .map((item, index) => ({
      id: item.id || index + 1,
      text: item.text || item.message || '',
      ...(config.news.links && item.link ? { link: item.link } : {}),
    }))
    .filter((item) => item.text.trim());

  if (!config.anthropicKey) {
    console.error('Не задан ANTHROPIC_API_KEY в .env');
    process.exit(1);
  }

  console.error('Файловый режим делает один платный вызов модели, Telegram не трогает.');
  const summary = await summarize({
    llm: createLlm({ apiKey: config.anthropicKey, log }),
    model: config.news.model,
    items,
    maxItems: config.news.maxItems,
    log,
  });
  const parts = renderDigest(summary, {
    title: 'файл',
    total: items.length,
    at: Date.now(),
    timeZone: config.news.timeZone,
  });
  console.log(parts.join('\n\n— — —\n\n'));
}

(async () => {
  if (args.error) {
    console.error(args.error);
    process.exit(1);
  }

  if (args.fromFile) {
    await fromFile(args.fromFile);
    process.exit(0);
  }

  const setup = serviceSetup({
    session: config.session,
    channels: config.channels,
    keywordsCount: 1,
    anthropicKey: config.anthropicKey,
    newsChannels: config.news.channels,
    repliesChat: config.replies.chat,
    repliesEnabled: config.replies.enabled,
  });
  if (!setup.features.digest.on) {
    console.error(`Сводка не настроена: ${setup.features.digest.why}`);
    process.exit(1);
  }

  const client = createClient();
  if (client.setLogLevel) client.setLogLevel('error');
  await withTimeout(client.connect(), 60000, 'не удалось подключиться к Telegram за минуту');

  if (!(await client.isUserAuthorized())) {
    console.error('Сессия недействительна. Выполните: npm run login');
    process.exit(1);
  }

  const clock = createClock();
  const gateway = createGateway({ client, clock, log });
  const state = createState();
  const chats = await resolveChats(gateway, config.news.channels, log);
  if (chats.length === 0) {
    console.error('Ни один канал не открылся');
    process.exit(1);
  }

  const digest = createDigestJob({
    gateway,
    store: state,
    llm: createLlm({ apiKey: config.anthropicKey, log }),
    chats,
    target: config.news.target,
    model: config.news.model,
    maxItems: config.news.maxItems,
    maxMessages: config.news.maxMessages,
    timeZone: config.news.timeZone,
    hour: config.news.hour,
    includeLinks: config.news.links,
    clock,
    log,
  });

  const result = await digest.run({ dryRun: args.dryRun });
  if (args.dryRun) console.log(`\n${result.parts.join('\n\n— — —\n\n')}`);

  await client.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Сводка не удалась:', err.message);
  process.exit(1);
});
