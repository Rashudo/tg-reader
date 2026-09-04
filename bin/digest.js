const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { loadConfig, serviceSetup } = require('../src/platform/config');
const { openDb } = require('../src/platform/db/open');
const { importLegacyState } = require('../src/platform/db/import-state-json');
const { createLlm } = require('../src/platform/llm/anthropic');
const { openTelegram } = require('../src/runtime/boot');
const { createDigestStore } = require('../src/features/digest/store');
const { createDigestJob, resolveChats, summarize } = require('../src/features/digest/job');
const { renderDigest } = require('../src/features/digest/render');
const { parseDigestArgs } = require('../src/shared/cli-args');

const DB_PATH = process.env.TG_DB_PATH || path.join(__dirname, '..', 'state.db');
const LEGACY_PATH = process.env.TG_STATE_PATH || path.join(__dirname, '..', 'state.json');

const { config, errors: configErrors } = loadConfig(process.env);

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
    throw new Error('Не задан ANTHROPIC_API_KEY в .env');
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

async function main() {
  if (configErrors.length > 0) {
    console.error(configErrors.join('\n'));
    return 1;
  }
  if (args.error) {
    console.error(args.error);
    return 1;
  }

  if (args.fromFile) {
    await fromFile(args.fromFile);
    return 0;
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
    return 1;
  }

  const telegram = await openTelegram({ config, log });
  const { gateway, clock } = telegram;
  const db = openDb(DB_PATH);
  importLegacyState(db, LEGACY_PATH, { log });

  const chats = await resolveChats(gateway, config.news.channels, log);
  if (chats.length === 0) {
    console.error('Ни один канал не открылся');
    await telegram.close();
    return 1;
  }

  const digest = createDigestJob({
    gateway,
    store: createDigestStore(db),
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

  await telegram.close();
  db.close();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Сводка не удалась:', err.message);
    process.exit(1);
  });
