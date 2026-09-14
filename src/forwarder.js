const { findHits, describeHits } = require('./matcher');
const { cut, messageLink } = require('./format');

const ALBUM_WINDOW_MS = 800;
const PAGE_SIZE = 100;
const CATCH_UP_CAP = 1000;

function createForwarder({
  client,
  state,
  sources,
  target,
  keywords,
  keywordsFor = () => keywords,
  notifier,
  log,
  peerKeyOf,
  eventKeyOf,
  albumWindowMs = ALBUM_WINDOW_MS,
  pageSize = PAGE_SIZE,
  catchUpCap = CATCH_UP_CAP,
  now = Date.now,
}) {
  const inFlight = new Set();
  const albums = new Map();
  const chains = new Map();

  function titleOf(source) {
    return source.title || source.username || peerKeyOf(source);
  }

  function serial(source, job) {
    const key = peerKeyOf(source);
    const run = (chains.get(key) || Promise.resolve()).then(job);
    chains.set(key, run.catch(() => {}));
    return run;
  }

  async function handle(source, messages, { advance = true } = {}) {
    const chatKey = peerKeyOf(source);
    const known = state.lastId(chatKey);
    const text = messages
      .map((msg) => msg.message || '')
      .filter(Boolean)
      .join('\n');
    const newestId = Math.max(...messages.map((msg) => msg.id));
    const freshToUs = messages.filter((msg) => known === null || msg.id > known).length;

    state.noteSeen(chatKey, freshToUs, now());

    const hits = findHits(text, keywordsFor(source));
    if (hits.length === 0) {
      if (advance) state.advance(chatKey, newestId);
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
        if (advance) state.advance(chatKey, newestId);
        log(`Переслано [${what}] ${link}`);
        return;
      } catch (err) {
        log(`Пересылка не удалась (${err.message}), отправляю копию`);
      }

      try {
        const head = `Совпадение: ${what}\n${source.title || ''} ${link}`.trim();
        await client.sendMessage(target, { message: cut(`${head}\n\n${text}`), parseMode: false });
        markSent();
        if (advance) state.advance(chatKey, newestId);
        log(`Отправлена копия [${what}] ${link}`);
      } catch (err) {
        if (advance) state.advance(chatKey, newestId);
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
      processLive(entry.source, entry.messages).catch((err) => log(`Ошибка обработки альбома: ${err.message}`));
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
    await processLive(source, [msg]);
  }

  async function fetchAfter(source, afterId, beforeId = 0) {
    const found = new Map();
    let offsetId = beforeId;
    let more = false;
    for (;;) {
      const batch = await client.getMessages(source, {
        limit: pageSize,
        minId: afterId,
        ...(offsetId ? { offsetId } : {}),
      });
      const fresh = batch.filter((m) => m.id > afterId && (!beforeId || m.id < beforeId) && !found.has(m.id));
      for (const m of fresh) found.set(m.id, m);
      more = batch.length >= pageSize && fresh.length > 0;
      if (!more || found.size >= catchUpCap) break;
      offsetId = Math.min(...fresh.map((m) => m.id));
    }
    const all = [...found.values()].sort((a, b) => a.id - b.id);
    return { messages: all.slice(-catchUpCap), truncated: more && found.size >= catchUpCap };
  }

  async function handleGroups(source, messages) {
    const groups = new Map();
    for (const msg of messages) {
      const key = msg.groupedId ? `g${msg.groupedId}` : `m${msg.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(msg);
    }
    for (const group of groups.values()) {
      await handle(source, group);
    }
  }

  async function warnTruncated(source) {
    const text = `${titleOf(source)}: за время простоя вышло больше ${catchUpCap} сообщений, проверяю только последние — более ранние пропущены`;
    log(text);
    await notifier.send(`🟠 tg-reader: ${text}`);
  }

  function processLive(source, messages) {
    return serial(source, async () => {
      const known = state.lastId(peerKeyOf(source));
      const firstId = Math.min(...messages.map((msg) => msg.id));
      let advance = true;
      if (known !== null && firstId > known + 1) {
        try {
          const { messages: gap, truncated } = await fetchAfter(source, known, firstId);
          if (truncated) await warnTruncated(source);
          if (gap.length) {
            log(`${titleOf(source)}: живые сообщения пришли с пропуском — проверяю ${gap.length} пропущенных`);
            await handleGroups(source, gap);
          }
        } catch (err) {
          advance = false;
          log(`${titleOf(source)}: пропуск перед сообщением ${firstId} догрузить не удалось (${err.message}) — позицию не двигаю`);
        }
      }
      await handle(source, messages, { advance });
    });
  }

  function backfill(source) {
    return serial(source, async () => {
      const chatKey = peerKeyOf(source);
      const last = state.lastId(chatKey);
      const title = titleOf(source);

      if (last === null) {
        const [newest] = await client.getMessages(source, { limit: 1 });
        state.advance(chatKey, newest ? newest.id : 0);
        log(`${title}: первый запуск, начинаю с текущего момента`);
        return;
      }

      const { messages, truncated } = await fetchAfter(source, last);
      if (messages.length === 0) return;
      if (truncated) await warnTruncated(source);

      log(`${title}: проверяю ${messages.length} сообщений, пропущенных за время простоя`);
      await handleGroups(source, messages);
    });
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
