/**
 * Проверка ключевых слов без ожидания новых постов:
 * прогоняет последние N сообщений канала через тот же матчер и печатает совпадения.
 * Ничего не пересылает и не двигает позицию чтения.
 *
 *   npm run scan          # последние 100 сообщений
 *   npm run scan -- 500   # последние 500
 */
const { config } = require('./config');
const { createClient } = require('./client');
const { checkReady } = require('./preflight');
const { prepare, findMatches } = require('./matcher');
const keywords = require('../keywords');

const DEFAULT_LIMIT = 100;
const KEYWORDS = prepare(keywords);

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
  checkReady(KEYWORDS.length);
  const limit = parseLimit(process.argv[2]);

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

    for (const msg of messages) {
      const hits = findMatches(msg.message || '', KEYWORDS);
      if (hits.length === 0) continue;
      found += 1;
      const link = entity.username ? `https://t.me/${entity.username}/${msg.id}` : `#${msg.id}`;
      const preview = (msg.message || '').replace(/\s+/g, ' ').slice(0, 120);
      console.log(`[${hits.join(', ')}] ${link}\n    ${preview}\n`);
    }

    console.log(`${entity.title || ref}: ${found} совпадений из ${messages.length} сообщений`);
  }

  await client.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
