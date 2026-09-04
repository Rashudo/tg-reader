const { config } = require('./config');
const { createClient } = require('./client');
const { readSetup } = require('./preflight');
const { prepare, findHits, describeHits, summary } = require('./matcher');
const keywords = require('../keywords');

const DEFAULT_LIMIT = 100;
const KEYWORDS = prepare(keywords, config.disabledGroups);

function parseLimit(raw) {
  if (raw === undefined) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`Некорректное число сообщений "${raw}" — нужно целое больше нуля`);
    process.exit(1);
  }
  return value;
}

(async () => {
  const setup = readSetup(KEYWORDS.length);
  if (setup.error) {
    console.error(setup.error);
    process.exit(1);
  }
  if (!setup.features.forwarding.on) {
    console.error(`Сканировать нечего: ${setup.features.forwarding.why}`);
    process.exit(1);
  }
  const limit = parseLimit(process.argv[2]);
  console.log(summary(keywords, KEYWORDS));

  const client = createClient();
  if (client.setLogLevel) client.setLogLevel('error');
  await client.connect();

  if (!(await client.isUserAuthorized())) {
    console.error('Сессия недействительна. Выполните: npm run login');
    process.exit(1);
  }

  for (const ref of config.channels) {
    let entity;
    try {
      entity = await client.getEntity(ref);
    } catch (err) {
      console.error(`Не удалось открыть канал "${ref}": ${err.message}. Вы точно на него подписаны?`);
      continue;
    }

    const messages = await client.getMessages(entity, { limit });
    let found = 0;
    const byGroup = new Map();

    for (const msg of messages) {
      const hits = findHits(msg.message || '', KEYWORDS);
      if (hits.length === 0) continue;
      found += 1;
      for (const hit of hits) {
        const key = hit.group || 'без группы';
        byGroup.set(key, (byGroup.get(key) || 0) + 1);
      }
      const link = entity.username ? `https://t.me/${entity.username}/${msg.id}` : `#${msg.id}`;
      const preview = (msg.message || '').replace(/\s+/g, ' ').slice(0, 120);
      console.log(`[${describeHits(hits)}] ${link}\n    ${preview}\n`);
    }

    console.log(`${entity.title || ref}: ${found} совпадений из ${messages.length} сообщений`);
    for (const [group, count] of byGroup) console.log(`    ${group}: ${count}`);
  }

  await client.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
