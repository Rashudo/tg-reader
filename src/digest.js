const { renderDigest } = require('./digest-render');

const DAY_MS = 24 * 60 * 60 * 1000;

function linkTo(source, messageId) {
  if (source && source.username) return `https://t.me/${source.username}/${messageId}`;
  if (source && source.id) return `https://t.me/c/${source.id}/${messageId}`;
  return undefined;
}

function toItems(messages, source, { since, maxMessages, includeLinks }) {
  return messages
    .filter((msg) => (msg.message || '').trim())
    .filter((msg) => (since === null ? true : msg.date * 1000 >= since))
    .sort((a, b) => a.id - b.id)
    .slice(-maxMessages)
    .map((msg) => ({
      id: msg.id,
      text: msg.message,
      ...(includeLinks ? { link: linkTo(source, msg.id) } : {}),
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
    const upTo = state.digestUpTo(key);
    const since = upTo === null ? now - DAY_MS : null;

    try {
      const fetched = await client.getMessages(source, {
        limit: maxMessages,
        ...(upTo === null ? {} : { minId: upTo }),
      });
      const items = toItems(fetched, source, { since, maxMessages, includeLinks });
      if (items.length === 0) {
        log(`Сводка «${source.title || source.username}»: за период нечего собирать`);
        continue;
      }

      const summary = await summarizer.summarize(items);
      const messages = renderDigest(summary, {
        title: source.title || source.username || 'канал',
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
      state.setDigestRunAt(now);
      log(`Сводка отправлена: ${items.length} сообщений, ${messages.length} частей`);
    } catch (err) {
      log(`Сводку собрать не удалось: ${err.message}`);
      await notify(`🟠 tg-reader: сводку собрать не удалось — ${err.message}`);
    }
  }

  return { parts };
}

module.exports = { runDigest, toItems };
