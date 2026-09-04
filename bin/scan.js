const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { loadConfig, serviceSetup } = require('../src/platform/config');
const { openTelegram } = require('../src/runtime/boot');
const { prepare, findHits, describeHits, summary } = require('../src/features/forwarding/matcher');
const keywords = require('../keywords');

const DEFAULT_LIMIT = 100;

function parseLimit(raw) {
  if (raw === undefined) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Некорректное число сообщений "${raw}" — нужно целое больше нуля`);
  return value;
}

function log(...args) {
  console.log(...args);
}

async function main() {
  const { config, errors } = loadConfig(process.env);
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    return 1;
  }

  const prepared = prepare(keywords, config.disabledGroups);
  const setup = serviceSetup({
    session: config.session,
    channels: config.channels,
    keywordsCount: prepared.length,
    anthropicKey: config.anthropicKey,
    newsChannels: config.news.channels,
    repliesChat: config.replies.chat,
    repliesEnabled: config.replies.enabled,
  });
  if (setup.error) {
    console.error(setup.error);
    return 1;
  }
  if (!setup.features.forwarding.on) {
    console.error(`Сканировать нечего: ${setup.features.forwarding.why}`);
    return 1;
  }

  const limit = parseLimit(process.argv[2]);
  console.log(summary(keywords, prepared));

  const telegram = await openTelegram({ config, log });
  try {
    for (const ref of config.channels) {
      let chat;
      try {
        chat = await telegram.gateway.resolveChat(ref);
      } catch (err) {
        console.error(`Не удалось открыть канал "${ref}": ${err.message}. Вы точно на него подписаны?`);
        continue;
      }

      const posts = await telegram.gateway.recent(chat, { limit });
      let found = 0;
      const byGroup = new Map();

      for (const post of posts) {
        const hits = findHits(post.text, prepared);
        if (hits.length === 0) continue;
        found += 1;
        for (const hit of hits) {
          const key = hit.group || 'без группы';
          byGroup.set(key, (byGroup.get(key) || 0) + 1);
        }
        const preview = post.text.replace(/\s+/g, ' ').slice(0, 120);
        console.log(`[${describeHits(hits)}] ${post.link || `#${post.id}`}\n    ${preview}\n`);
      }

      console.log(`${chat.title || ref}: ${found} совпадений из ${posts.length} сообщений`);
      for (const [group, count] of byGroup) console.log(`    ${group}: ${count}`);
    }
    return 0;
  } finally {
    await telegram.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Сканирование не удалось:', err.message);
    process.exit(1);
  });
