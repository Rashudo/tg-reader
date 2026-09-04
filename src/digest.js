const { renderDigest } = require('./digest-render');
const { messageLink } = require('./platform/telegram/text');

const DAY_MS = 24 * 60 * 60 * 1000;

function toItems(messages, source, { since, maxMessages, includeLinks }) {
  return messages
    .filter((msg) => (msg.message || '').trim())
    .filter((msg) => (since === null ? true : msg.date * 1000 >= since))
    .sort((a, b) => a.id - b.id)
    .slice(-maxMessages)
    .map((msg) => ({
      id: msg.id,
      text: msg.message,
      ...(includeLinks ? { link: messageLink(source, msg.id) || undefined } : {}),
    }));
}

async function runDigest({
  client,
  sources,
  summarizer,
  state,
  peerKeyOf,
  target,
  maxMessages,
  timeZone,
  now = Date.now(),
  log = console.log,
  notify = async () => {},
  dryRun = false,
  includeLinks = true,
}) {
  const parts = [];

  for (const source of sources) {
    const key = peerKeyOf(source);
    const title = source.title || source.username || key;
    const upTo = state.digestUpTo(key);
    const since = upTo === null ? now - DAY_MS : null;

    if (!dryRun) state.setDigestRunAt(key, now);

    try {
      const fetched = await client.getMessages(source, {
        limit: maxMessages,
        ...(upTo === null ? {} : { minId: upTo }),
      });
      if (fetched.length >= maxMessages) {
        log(`Сводка «${title}»: за период вышло больше ${maxMessages} сообщений, беру только свежие`);
      }

      const items = toItems(fetched, source, { since, maxMessages, includeLinks });
      if (items.length === 0) {
        log(`Сводка «${title}»: за период нечего собирать`);
        continue;
      }

      const summary = await summarizer.summarize(items);
      const messages = renderDigest(summary, {
        title,
        total: items.length,
        at: now,
        timeZone,
      });
      parts.push(...messages);

      if (dryRun) {
        log(`Пробный прогон: ${messages.length} сообщений, отправка пропущена`);
        continue;
      }

      for (const message of messages) {
        await client.sendMessage(target, { message, parseMode: false });
      }
      state.setDigestUpTo(key, items[items.length - 1].id);
      log(`Сводка отправлена: ${items.length} сообщений, ${messages.length} частей`);
    } catch (err) {
      log(`Сводку собрать не удалось: ${err.message}`);
      await notify(`🟠 tg-reader: сводку собрать не удалось — ${err.message}`);
    }
  }

  return { parts };
}

module.exports = { runDigest, toItems };
