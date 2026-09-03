const { NewMessage } = require('telegram/events');
const { EditedMessage } = require('telegram/events/EditedMessage');
const { config } = require('./config');
const { createClient } = require('./client');
const { checkReady } = require('./preflight');
const { prepare, findHits, describeHits, summary, unknownGroups } = require('./matcher');
const { peerKey, eventPeerKey } = require('./peer');
const { cut, messageLink } = require('./format');
const { createState } = require('./state');
const { withTimeout } = require('./async');
const { createWatchdog, createStallWatchdog } = require('./watchdog');
const { createNotifier } = require('./notify');
const news = require('./news');
const keywords = require('../keywords');

const KEYWORDS = prepare(keywords, config.disabledGroups);

const CONNECT_TIMEOUT_MS = 60 * 1000;
const OFFLINE_LIMIT_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 30 * 1000;
const DIGEST_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const ALBUM_WINDOW_MS = 800;
const BACKFILL_LIMIT = 50;
const STALL_RECONNECT_MS = config.health.stallReconnectMin * 60 * 1000;
const STALL_GIVEUP_MS = config.health.stallGiveUpMin * 60 * 1000;

const state = createState();
const notifier = createNotifier({ token: config.alert.token, chatId: config.alert.chatId, log });
const inFlight = new Set();
const startedAt = Date.now();
const albums = new Map();
const sources = new Map();

let client = null;
let target = null;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function handle(source, messages) {
  const chatKey = peerKey(source);
  const text = messages
    .map((msg) => msg.message || '')
    .filter(Boolean)
    .join('\n');
  const newestId = Math.max(...messages.map((msg) => msg.id));

  state.noteSeen(chatKey, messages.length, Date.now());

  const hits = findHits(text, KEYWORDS);
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
  const key = `${peerKey(source)}:g${message.groupedId}`;
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
  }, ALBUM_WINDOW_MS);
}

async function onMessage(event) {
  const msg = event.message;
  if (!msg) return;

  const source = sources.get(eventPeerKey(event, msg));
  if (!source) return;

  if (msg.groupedId) {
    queueAlbum(source, msg);
    return;
  }
  await handle(source, [msg]);
}

async function forceReconnect() {
  await client.disconnect();
  await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'переподключение не уложилось в минуту');
  log('Переподключился, догружаю пропущенное');
  for (const source of sources.values()) {
    await backfill(source).catch((err) => log(`Догрузка после переподключения не удалась: ${err.message}`));
  }
}

async function backfill(source) {
  const chatKey = peerKey(source);
  const last = state.lastId(chatKey);
  const title = source.title || source.username || chatKey;

  if (last === null) {
    const [newest] = await client.getMessages(source, { limit: 1 });
    state.advance(chatKey, newest ? newest.id : 0);
    log(`${title}: первый запуск, начинаю с текущего момента`);
    return;
  }

  const missed = (await client.getMessages(source, { limit: BACKFILL_LIMIT, minId: last }))
    .slice()
    .sort((a, b) => a.id - b.id);
  if (missed.length === 0) return;
  if (missed.length === BACKFILL_LIMIT) {
    log(`${title}: за время простоя вышло больше ${BACKFILL_LIMIT} сообщений, проверяю только последние`);
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

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  state.flush();
  setTimeout(() => process.exit(code), 3000).unref();
  Promise.resolve(client && client.disconnect())
    .catch(() => {})
    .finally(() => process.exit(code));
}

async function startNewsDigest() {
  if (!news.isConfigured()) {
    log(`Сводка новостей выключена: ${news.whyNotConfigured()}`);
    return;
  }

  const sources = await news.resolveNewsSources(client, log);
  if (sources.length === 0) {
    log('Сводка новостей выключена: ни один канал не открылся');
    return;
  }

  const target = await client.getEntity(config.news.target);
  const digest = news.createNewsDigest({
    client,
    sources,
    target,
    notify: (text) => notifier.send(text),
    log,
  });

  let running = false;
  setInterval(async () => {
    if (running || !news.digestDue(state)) return;
    running = true;
    try {
      await digest(state);
    } catch (err) {
      log(`Сводка новостей упала: ${err.message}`);
      await notifier.send(`🟠 tg-reader: сводка новостей упала — ${err.message}`);
    } finally {
      running = false;
    }
  }, DIGEST_CHECK_INTERVAL_MS);

  log(`Сводка новостей: ${sources.length} канал(ов), в ${config.news.hour}:00 по ${config.news.timeZone}, модель ${config.news.model}`);
}

async function main() {
  checkReady(KEYWORDS.length);

  for (const name of unknownGroups(config.disabledGroups, keywords)) {
    console.error(`В DISABLED_GROUPS указана неизвестная группа «${name}» — проверьте написание в keywords.js`);
  }

  client = createClient();
  if (client.setLogLevel) client.setLogLevel('error');

  await withTimeout(
    client.connect(),
    CONNECT_TIMEOUT_MS,
    'не удалось подключиться к Telegram за минуту'
  );

  if (!(await client.isUserAuthorized())) {
    console.error('Сессия недействительна. Выполните: npm run login');
    process.exit(1);
  }

  for (const ref of config.channels) {
    try {
      const entity = await client.getEntity(ref);
      sources.set(peerKey(entity), entity);
      log(`Источник: ${entity.title || entity.username || ref} (id ${entity.id})`);
    } catch (err) {
      console.error(`Не удалось открыть канал "${ref}": ${err.message}. Вы точно на него подписаны?`);
      process.exit(1);
    }
  }

  try {
    target = await client.getEntity(config.target);
  } catch (err) {
    console.error(`Не удалось открыть TARGET "${config.target}": ${err.message}`);
    process.exit(1);
  }
  log(`Пересылка в: ${config.target === 'me' ? 'Избранное' : target.title || target.username}`);
  log(summary(keywords, KEYWORDS));

  state.setStartedAt(startedAt);

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  const onEvent = (event) => onMessage(event);
  client.addEventHandler(onEvent, new NewMessage({}));
  client.addEventHandler(onEvent, new EditedMessage({}));

  for (const source of sources.values()) {
    try {
      await backfill(source);
    } catch (err) {
      log(`Не удалось догрузить пропущенное для ${source.title || source.username}: ${err.message}`);
    }
  }

  await startNewsDigest();

  createWatchdog({
    isConnected: () => Boolean(client.connected),
    onGiveUp: async () => {
      const text = `Нет связи с Telegram дольше ${OFFLINE_LIMIT_MS / 60000} мин — выхожу, чтобы systemd перезапустил сервис`;
      console.error(text);
      await notifier.send(`🔴 tg-reader: ${text}`);
      shutdown(1);
    },
    log,
    limitMs: OFFLINE_LIMIT_MS,
    intervalMs: WATCHDOG_INTERVAL_MS,
  }).start();

  createStallWatchdog({
    lastMessageAt: () => Math.max(state.lastMessageAt() || 0, startedAt),
    onReconnect: () => {
      forceReconnect().catch((err) => log(`Переподключение не удалось: ${err.message}`));
    },
    onGiveUp: async () => {
      const text = `Из канала нет сообщений ${STALL_GIVEUP_MS / 60000} мин, переподключение не помогло — выхожу на перезапуск`;
      console.error(text);
      await notifier.send(`🟠 tg-reader: ${text}`);
      shutdown(1);
    },
    log,
    reconnectAfterMs: STALL_RECONNECT_MS,
    giveUpAfterMs: STALL_GIVEUP_MS,
  }).start(WATCHDOG_INTERVAL_MS);

  log('Слушаю новые сообщения. Ctrl+C для остановки.');
}

main().catch((err) => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
