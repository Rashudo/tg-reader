const { NewMessage } = require('telegram/events');
const { EditedMessage } = require('telegram/events/EditedMessage');
const { config } = require('./config');
const { createClient } = require('./client');
const { readSetup } = require('./preflight');
const { prepare, summary, unknownGroups } = require('./matcher');
const { peerKey, eventPeerKey } = require('./peer');
const { createState } = require('./state');
const { withTimeout } = require('./async');
const { createWatchdog, createStallWatchdog } = require('./watchdog');
const { createNotifier } = require('./notify');
const { createForwarder } = require('./forwarder');
const news = require('./news');
const keywords = require('../keywords');

const KEYWORDS = prepare(keywords, config.disabledGroups);

const CONNECT_TIMEOUT_MS = 60 * 1000;
const PROBE_TIMEOUT_MS = 30 * 1000;
const OFFLINE_LIMIT_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 30 * 1000;
const DIGEST_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const STALL_RECONNECT_MS = config.health.stallReconnectMin * 60 * 1000;
const STALL_GIVEUP_MS = config.health.stallGiveUpMin * 60 * 1000;

const state = createState();
const notifier = createNotifier({ token: config.alert.token, chatId: config.alert.chatId, log });
const startedAt = Date.now();
const sources = new Map();

let client = null;
let forwarder = null;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function forceReconnect() {
  await client.disconnect();
  await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'переподключение не уложилось в минуту');
  log('Переподключился, догружаю пропущенное');
  for (const source of sources.values()) {
    await forwarder.backfill(source).catch((err) => log(`Догрузка после переподключения не удалась: ${err.message}`));
  }
}

async function channelHasNewsForUs() {
  for (const source of sources.values()) {
    if (await withTimeout(forwarder.isBehind(source), PROBE_TIMEOUT_MS, 'канал не ответил за 30 секунд')) {
      return true;
    }
  }
  return false;
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

async function startForwarding() {
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

  let target;
  try {
    target = await client.getEntity(config.target);
  } catch (err) {
    console.error(`Не удалось открыть TARGET "${config.target}": ${err.message}`);
    process.exit(1);
  }
  log(`Пересылка в: ${config.target === 'me' ? 'Избранное' : target.title || target.username || config.target}`);
  log(summary(keywords, KEYWORDS));

  forwarder = createForwarder({
    client,
    state,
    sources,
    target,
    keywords: KEYWORDS,
    notifier,
    log,
    peerKeyOf: peerKey,
    eventKeyOf: eventPeerKey,
  });

  const onEvent = (event) => forwarder.onMessage(event);
  client.addEventHandler(onEvent, new NewMessage({}));
  client.addEventHandler(onEvent, new EditedMessage({}));

  for (const source of sources.values()) {
    try {
      await forwarder.backfill(source);
    } catch (err) {
      log(`Не удалось догрузить пропущенное для ${source.title || source.username}: ${err.message}`);
    }
  }

  createStallWatchdog({
    lastMessageAt: () => Math.max(state.lastMessageAt() || 0, startedAt),
    probe: channelHasNewsForUs,
    onQuiet: (at) => state.setProbeOkAt(at),
    onReconnect: () => {
      forceReconnect().catch((err) => log(`Переподключение не удалось: ${err.message}`));
    },
    onGiveUp: async () => {
      const text = `Из канала нет сообщений ${STALL_GIVEUP_MS / 60000} мин, и в нём есть непрочитанное — выхожу на перезапуск`;
      console.error(text);
      await notifier.send(`🟠 tg-reader: ${text}`);
      shutdown(1);
    },
    log,
    reconnectAfterMs: STALL_RECONNECT_MS,
    giveUpAfterMs: STALL_GIVEUP_MS,
  }).start(WATCHDOG_INTERVAL_MS);
}

async function startNewsDigest() {
  if (!news.isConfigured()) {
    log(`Сводка новостей выключена: ${news.whyNotConfigured()}`);
    return;
  }

  const newsSources = await news.resolveNewsSources(client, log);
  if (newsSources.length === 0) {
    log('Сводка новостей выключена: ни один канал не открылся');
    return;
  }

  let newsTarget;
  try {
    newsTarget = await client.getEntity(config.news.target);
  } catch (err) {
    log(`Сводка новостей выключена: не удалось открыть получателя "${config.news.target}" (${err.message})`);
    return;
  }

  const digest = news.createNewsDigest({
    client,
    sources: newsSources,
    target: newsTarget,
    notify: (text) => notifier.send(text),
    log,
  });

  let running = false;
  setInterval(async () => {
    if (running || !digest.due(state)) return;
    running = true;
    try {
      await digest.run(state);
    } catch (err) {
      log(`Сводка новостей упала: ${err.message}`);
      await notifier.send(`🟠 tg-reader: сводка новостей упала — ${err.message}`);
    } finally {
      running = false;
    }
  }, DIGEST_CHECK_INTERVAL_MS);

  log(
    `Сводка новостей: ${newsSources.length} канал(ов), в ${config.news.hour}:00 по ${config.news.timeZone}, модель ${config.news.model}`
  );
}

async function main() {
  const setup = readSetup(KEYWORDS.length, news.isConfigured());
  if (setup.error) {
    console.error(setup.error);
    process.exit(1);
  }
  if (setup.warning) console.error(setup.warning);

  for (const name of unknownGroups(config.disabledGroups, keywords)) {
    console.error(`В DISABLED_GROUPS указана неизвестная группа «${name}» — проверьте написание в keywords.js`);
  }

  client = createClient();
  if (client.setLogLevel) client.setLogLevel('error');

  await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'не удалось подключиться к Telegram за минуту');

  if (!(await client.isUserAuthorized())) {
    console.error('Сессия недействительна. Выполните: npm run login');
    process.exit(1);
  }

  state.setStartedAt(startedAt);
  state.setForwarding(setup.forwarding);
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  if (setup.forwarding) {
    await startForwarding();
  } else {
    log('Пересылка объявлений выключена');
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

  log('Слушаю новые сообщения. Ctrl+C для остановки.');
}

main().catch((err) => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
