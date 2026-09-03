const { findHits, describeHits } = require('./matcher');
const { cut, messageLink } = require('./format');

const ALBUM_WINDOW_MS = 800;
const BACKFILL_LIMIT = 50;

function createForwarder({
  client,
  state,
  sources,
  target,
  keywords,
  notifier,
  log,
  peerKeyOf,
  eventKeyOf,
  albumWindowMs = ALBUM_WINDOW_MS,
  backfillLimit = BACKFILL_LIMIT,
  now = Date.now,
}) {
  const inFlight = new Set();
  const albums = new Map();

  async function handle(source, messages) {
    const chatKey = peerKeyOf(source);
    const known = state.lastId(chatKey);
    const text = messages
      .map((msg) => msg.message || '')
      .filter(Boolean)
      .join('\n');
    const newestId = Math.max(...messages.map((msg) => msg.id));
    const freshToUs = messages.filter((msg) => known === null || msg.id > known).length;

    state.noteSeen(chatKey, freshToUs, now());

    const hits = findHits(text, keywords);
    if (hits.length === 0) {
      state.advance(chatKey, newestId);
      return;
    }

    const fresh = messages.filter(
      (msg) => !state.wasSent(chatKey, msg.id) && !inFlight.has(`${chatKey}:${msg.id}`)
    );
    if (fresh.length === 0) return;

    const ids = fresh.map((msg) => msg.id).sort((a, b) => a - b);
    const keys = ids.map((id) => `${chatKey}:${id}`);
    keys.forEach((key) => inFlight.add(key));
    const markSent = () => ids.forEach((id) => state.markSent(chatKey, id));
    const link = messageLink(source, ids[0]);
    const what = describeHits(hits);

    try {
      try {
        await client.forwardMessages(target, { messages: ids, fromPeer: source });
        markSent();
        state.advance(chatKey, newestId);
        log(`Переслано [${what}] ${link}`);
        return;
      } catch (err) {
        log(`Пересылка не удалась (${err.message}), отправляю копию`);
      }

      try {
        const head = `Совпадение: ${what}\n${source.title || ''} ${link}`.trim();
        await client.sendMessage(target, { message: cut(`${head}\n\n${text}`), parseMode: false });
        markSent();
        state.advance(chatKey, newestId);
        log(`Отправлена копия [${what}] ${link}`);
      } catch (err) {
        state.advance(chatKey, newestId);
        log(`ПОТЕРЯНО [${what}] ${link} — отправить не удалось: ${err.message}`);
        await notifier.send(
          `🟠 tg-reader: совпадение [${what}] не удалось переслать (${err.message}).\nОригинал: ${link}`
        );
      }
    } finally {
      keys.forEach((key) => inFlight.delete(key));
    }
  }

  function queueAlbum(source, message) {
    const key = `${peerKeyOf(source)}:g${message.groupedId}`;
    let entry = albums.get(key);
    if (!entry) {
      entry = { source, messages: [], timer: null };
      albums.set(key, entry);
    }
    entry.messages.push(message);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      albums.delete(key);
      handle(entry.source, entry.messages).catch((err) => log(`Ошибка обработки альбома: ${err.message}`));
    }, albumWindowMs);
  }

  async function onMessage(event) {
    const msg = event.message;
    if (!msg) return;

    const source = sources.get(eventKeyOf(event, msg));
    if (!source) return;

    if (msg.groupedId) {
      queueAlbum(source, msg);
      return;
    }
    await handle(source, [msg]);
  }

  async function backfill(source, { limit = backfillLimit } = {}) {
    const chatKey = peerKeyOf(source);
    const last = state.lastId(chatKey);
    const title = source.title || source.username || chatKey;

    if (last === null) {
      const [newest] = await client.getMessages(source, { limit: 1 });
      state.advance(chatKey, newest ? newest.id : 0);
      log(`${title}: первый запуск, начинаю с текущего момента`);
      return;
    }

    const missed = (await client.getMessages(source, { limit, minId: last }))
      .slice()
      .sort((a, b) => a.id - b.id);
    if (missed.length === 0) return;
    if (missed.length >= limit) {
      log(`${title}: за время простоя вышло больше ${limit} сообщений, проверяю только последние`);
    }

    const groups = new Map();
    for (const msg of missed) {
      const key = msg.groupedId ? `g${msg.groupedId}` : `m${msg.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(msg);
    }

    log(`${title}: проверяю ${missed.length} сообщений, пропущенных за время простоя`);
    for (const group of groups.values()) {
      await handle(source, group);
    }
  }

  async function isBehind(source) {
    const [newest] = await client.getMessages(source, { limit: 1 });
    if (!newest) return false;
    const known = state.lastId(peerKeyOf(source));
    return known === null || newest.id > known;
  }

  return { onMessage, handle, backfill, isBehind };
}

module.exports = { createForwarder };
