const { decide } = require('./logic');
const { cut } = require('../../platform/telegram/text');

const BACKFILL_LIMIT = 50;

function createForwardingJob({
  gateway,
  store,
  sources,
  target,
  keywords,
  notifier,
  clock,
  log,
  backfillLimit = BACKFILL_LIMIT,
}) {
  const inFlight = new Set();
  let unsubscribe = null;

  async function handle(chat, posts) {
    const answer = decide({
      posts,
      keywords,
      lastId: store.lastId(chat.key),
      isSent: (id) => store.wasSent(chat.key, id) || inFlight.has(`${chat.key}:${id}`),
    });

    store.noteSeen(chat.key, answer.fresh, answer.at);

    if (answer.what === null) {
      store.advance(chat.key, answer.newestId);
      return;
    }
    if (answer.ids.length === 0) return;

    const keys = answer.ids.map((id) => `${chat.key}:${id}`);
    keys.forEach((key) => inFlight.add(key));
    const link = posts.find((post) => post.id === answer.ids[0]).link;
    const commit = () =>
      store.commitForward(chat.key, { ids: answer.ids, newestId: answer.newestId, at: clock.now() });

    try {
      try {
        await gateway.forward(target, chat, answer.ids);
        commit();
        log(`Переслано [${answer.what}] ${link}`);
        return;
      } catch (err) {
        log(`Пересылка не удалась (${err.message}), отправляю копию`);
      }

      try {
        const head = `Совпадение: ${answer.what}\n${chat.title || ''} ${link}`.trim();
        await gateway.sendText(target, cut(`${head}\n\n${answer.text}`));
        commit();
        log(`Отправлена копия [${answer.what}] ${link}`);
      } catch (err) {
        store.advance(chat.key, answer.newestId);
        log(`ПОТЕРЯНО [${answer.what}] ${link} — отправить не удалось: ${err.message}`);
        await notifier.send(
          `🟠 tg-reader: совпадение [${answer.what}] не удалось переслать (${err.message}).\nОригинал: ${link}`
        );
      }
    } finally {
      keys.forEach((key) => inFlight.delete(key));
    }
  }

  async function backfill(chat, { limit = backfillLimit } = {}) {
    const title = chat.title || chat.username || chat.key;
    const last = store.lastId(chat.key);

    if (last === null) {
      const [newest] = await gateway.recent(chat, { limit: 1 });
      store.advance(chat.key, newest ? newest.id : 0);
      log(`${title}: первый запуск, начинаю с текущего момента`);
      return;
    }

    const missed = await gateway.recent(chat, { limit, afterId: last });
    if (missed.length === 0) return;
    if (missed.length >= limit) {
      log(`${title}: за время простоя вышло больше ${limit} сообщений, проверяю только последние`);
    }

    const groups = new Map();
    for (const post of missed) {
      const key = post.groupId ? `g${post.groupId}` : `m${post.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(post);
    }

    log(`${title}: проверяю ${missed.length} сообщений, пропущенных за время простоя`);
    for (const group of groups.values()) await handle(chat, group);
  }

  async function isBehind(chat) {
    const [newest] = await gateway.recent(chat, { limit: 1 });
    if (!newest) return false;
    const known = store.lastId(chat.key);
    return known === null || newest.id > known;
  }

  return {
    name: 'forwarding',
    handle,
    backfill,
    isBehind,
    async start() {
      unsubscribe = gateway.onPost((posts) => {
        const chat = sources.get(posts[0].chatKey);
        if (!chat) return;
        handle(chat, posts).catch((err) => log(`Ошибка обработки сообщения: ${err.message}`));
      });
      for (const chat of sources.values()) {
        try {
          await backfill(chat);
        } catch (err) {
          log(`Не удалось догрузить пропущенное для ${chat.title || chat.username}: ${err.message}`);
        }
      }
    },
    async stop() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
    },
  };
}

module.exports = { createForwardingJob };
