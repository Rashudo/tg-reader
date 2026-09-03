const fs = require('fs');
const { config } = require('./config');
const { createClient } = require('./client');
const { createState } = require('./state');
const { createSummarizer } = require('./summarizer');
const { renderDigest } = require('./digest-render');
const { withTimeout } = require('./async');
const news = require('./news');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? null : args[at + 1];
};

function log(...parts) {
  console.log(new Date().toISOString(), ...parts);
}

async function fromFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = (Array.isArray(raw) ? raw : raw.items || []).map((item, index) => ({
    id: item.id || index + 1,
    text: item.text || item.message || '',
    ...(config.news.links && item.link ? { link: item.link } : {}),
  })).filter((item) => item.text.trim());

  if (!config.anthropicKey) {
    console.error('Не задан ANTHROPIC_API_KEY в .env');
    process.exit(1);
  }

  console.error('Файловый режим делает один платный вызов модели, Telegram не трогает.');
  const summarizer = createSummarizer({
    model: config.news.model,
    createMessage: news.createAnthropicCall(config.anthropicKey),
    maxItems: config.news.maxItems,
    log,
  });
  const summary = await summarizer.summarize(items);
  const parts = renderDigest(summary, {
    title: 'файл',
    total: items.length,
    at: Date.now(),
    timeZone: config.news.timeZone,
  });
  console.log(parts.join('\n\n— — —\n\n'));
}

(async () => {
  const file = valueOf('--from-file');
  if (file) {
    await fromFile(file);
    process.exit(0);
  }

  const problem = news.whyNotConfigured();
  if (problem) {
    console.error(`Сводка не настроена: ${problem}`);
    process.exit(1);
  }

  const client = createClient();
  if (client.setLogLevel) client.setLogLevel('error');
  await withTimeout(client.connect(), 60000, 'не удалось подключиться к Telegram за минуту');

  if (!(await client.isUserAuthorized())) {
    console.error('Сессия недействительна. Выполните: npm run login');
    process.exit(1);
  }

  const state = createState();
  const sources = await news.resolveNewsSources(client, log);
  if (sources.length === 0) {
    console.error('Ни один канал не открылся');
    process.exit(1);
  }

  const target = await client.getEntity(config.news.target);
  const digest = news.createNewsDigest({
    client,
    sources,
    target,
    notify: async () => {},
    log,
  });

  const dryRun = has('--dry-run');
  const result = await digest(state, { dryRun });
  if (dryRun) console.log(`\n${result.parts.join('\n\n— — —\n\n')}`);

  state.flush();
  await client.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Сводка не удалась:', err.message);
  process.exit(1);
});
