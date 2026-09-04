const { toItems, windowStart, due } = require('./logic');
const { SCHEMA, systemPrompt, clampSummary, buildUserMessage, DEFAULT_MAX_ITEMS } = require('./prompt');
const { renderDigest } = require('./render');

async function summarize({ llm, model, items, maxItems, log }) {
  if (items.length === 0) return { groups: [], dropped: 0 };

  const answer = await llm.call({
    model,
    system: systemPrompt(maxItems),
    messages: [{ role: 'user', content: buildUserMessage(items) }],
    schema: SCHEMA,
  });

  const usage = answer.usage || {};
  log(
    `Сводка: ${model}, токенов на входе ${usage.input_tokens || 0}, на выходе ${usage.output_tokens || 0}` +
      (answer.cost === null || answer.cost === undefined ? '' : `, примерно $${answer.cost.toFixed(4)}`)
  );

  if (!answer.json || !Array.isArray(answer.json.groups)) {
    log('Модель ответила не по схеме — отправляю как есть');
    return { raw: answer.text };
  }
  return clampSummary(answer.json, maxItems);
}

function createDigestJob({
  gateway,
  store,
  llm,
  chats,
  target,
  model,
  maxItems = DEFAULT_MAX_ITEMS,
  maxMessages,
  timeZone,
  hour,
  includeLinks,
  clock,
  checkEveryMs = 10 * 60 * 1000,
  log = console.log,
  notify = async () => {},
}) {
  const timers = [];
  let running = false;
  async function run({ now = clock.now(), dryRun = false } = {}) {
    const parts = [];

    for (const chat of chats) {
      const title = chat.title || chat.username || chat.key;
      const upTo = store.upTo(chat.key);
      const since = windowStart(upTo, now);

      if (!dryRun) store.setRunAt(chat.key, now);

      try {
        const fetched = await gateway.recent(chat, { limit: maxMessages, afterId: upTo });
        if (fetched.length >= maxMessages) {
          log(`Сводка «${title}»: за период вышло больше ${maxMessages} сообщений, беру только свежие`);
        }

        const items = toItems(fetched, { since, maxMessages, includeLinks });
        if (items.length === 0) {
          log(`Сводка «${title}»: за период нечего собирать`);
          continue;
        }

        const summary = await summarize({ llm, model, items, maxItems, log });
        const messages = renderDigest(summary, { title, total: items.length, at: now, timeZone });
        parts.push(...messages);

        if (dryRun) {
          log(`Пробный прогон: ${messages.length} сообщений, отправка пропущена`);
          continue;
        }

        for (const message of messages) await gateway.sendText(target, message);
        store.setUpTo(chat.key, items[items.length - 1].id);
        log(`Сводка отправлена: ${items.length} сообщений, ${messages.length} частей`);
      } catch (err) {
        log(`Сводку собрать не удалось: ${err.message}`);
        await notify(`🟠 tg-reader: сводку собрать не удалось — ${err.message}`);
      }
    }

    return { parts };
  }

  const isDueNow = (now = clock.now()) =>
    due({ chats, lastRunAt: (key) => store.lastRunAt(key), now, hour, timeZone });

  async function tick() {
    if (running || !isDueNow()) return;
    running = true;
    try {
      await run();
    } catch (err) {
      log(`Сводка новостей упала: ${err.message}`);
      await notify(`🟠 tg-reader: сводка новостей упала — ${err.message}`);
    } finally {
      running = false;
    }
  }

  return {
    name: 'digest',
    run,
    tick,
    due: isDueNow,
    async start() {
      timers.push(clock.every(checkEveryMs, () => tick()));
    },
    async stop() {
      for (const cancel of timers) cancel();
      timers.length = 0;
    },
  };
}

async function resolveChats(gateway, refs, log) {
  const chats = [];
  for (const ref of refs) {
    try {
      const chat = await gateway.resolveChat(ref);
      chats.push(chat);
      log(`Сводка: источник ${chat.title || chat.username || ref}`);
    } catch (err) {
      log(`Сводка: канал "${ref}" открыть не удалось (${err.message}) — пропускаю`);
    }
  }
  return chats;
}

module.exports = { createDigestJob, resolveChats, summarize };
