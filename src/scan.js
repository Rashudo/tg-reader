/**
 * Проверка ключевых слов без ожидания новых постов:
 * прогоняет последние N сообщений канала через тот же матчер и печатает совпадения.
 * Ничего не пересылает.
 *
 *   npm run scan          # последние 100 сообщений
 *   npm run scan -- 500   # последние 500
 */
const { config } = require('./config');
const { createClient } = require('./client');
const { prepare, findMatches } = require('./matcher');
const keywords = require('../keywords');

const LIMIT = Number(process.argv[2]) || 100;
const KEYWORDS = prepare(keywords);

(async () => {
  const client = createClient();
  if (client.setLogLevel) client.setLogLevel('error');
  await client.connect();

  if (!(await client.isUserAuthorized())) {
    console.error('Сессия недействительна. Выполните: npm run login');
    process.exit(1);
  }

  for (const ref of config.channels) {
    const entity = await client.getEntity(ref);
    const messages = await client.getMessages(entity, { limit: LIMIT });
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
})();
