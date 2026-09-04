const { config } = require('./config');
const { createClient } = require('./client');
const { readSetup } = require('./preflight');
const { prepare, summary, unknownGroups } = require('./matcher');
const { peerKey, eventPeerKey } = require('./peer');
const { subscribeMessages } = require('./platform/telegram/gateway');
const { createState } = require('./state');
const { withTimeout } = require('./async');
const { createWatchdog, createStallWatchdog } = require('./watchdog');
const { createNotifier } = require('./notify');
const { createForwarder } = require('./forwarder');
const { createReplier } = require('./replier');
const { createResponder } = require('./responder');
const { createBotCommands } = require('./bot-commands');
const { loadVoice } = require('./voice');
const news = require('./news');
const keywords = require('../keywords');

const KEYWORDS = prepare(keywords, config.disabledGroups);

const CONNECT_TIMEOUT_MS = 60 * 1000;
const PROBE_TIMEOUT_MS = 30 * 1000;
const OFFLINE_LIMIT_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 30 * 1000;
const DIGEST_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const REPLY_FLUSH_INTERVAL_MS = 30 * 1000;
const REPLY_TICK_INTERVAL_MS = 25 * 60 * 1000;
const BOT_POLL_INTERVAL_MS = 30 * 1000;
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

  subscribeMessages(client, (event) => forwarder.onMessage(event), { edits: true });

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

function chatMessageOf(event, names) {
  const msg = event.message;
  if (!msg) return null;
  const from = msg.senderId ? String(msg.senderId) : null;
  return {
    id: msg.id,
    from,
    author: (from && names.get(from)) || 'кто-то',
    replyTo: msg.replyTo ? msg.replyTo.replyToMsgId : null,
    text: msg.message || '',
  };
}

async function startReplies() {
  if (!config.replies.chat) {
    log('Автоответы выключены: REPLY_CHAT не задан');
    return;
  }
  if (!config.anthropicKey) {
    log('Автоответы выключены: нет ANTHROPIC_API_KEY');
    return;
  }
  if (!config.replies.enabled) {
    log('Автоответы выключены: REPLY_ENABLED=off');
    return;
  }

  let chat;
  try {
    chat = await client.getEntity(config.replies.chat);
  } catch (err) {
    log(`Автоответы выключены: не удалось открыть чат "${config.replies.chat}" (${err.message})`);
    return;
  }

  const me = await client.getMe();
  const names = new Map();
  try {
    for (const person of await client.getParticipants(chat)) {
      names.set(String(person.id), person.firstName || person.username || String(person.id));
    }
  } catch (err) {
    log(`Имена участников чата не прочитались (${err.message}) — обойдусь без них`);
  }

  const voice = loadVoice();
  if (voice.samples.length === 0) {
    log('Автоответы: образцов речи нет, ответы будут безликими — соберите voice.json');
  }

  const replier = createReplier({
    client,
    chat,
    state,
    responder: createResponder({
      model: config.replies.model,
      createMessage: news.createAnthropicCall(config.anthropicKey),
      samples: voice.samples,
      maxChars: config.replies.maxChars,
      name: me.firstName || me.username || 'я',
      log,
    }),
    notifier,
    meId: String(me.id),
    aliases: config.replies.aliases,
    limits: {
      dailyBudget: config.replies.dailyBudget,
      addressedBudget: config.replies.addressedBudget,
      spontaneousPauseMs: config.replies.spontaneousPauseMs,
      addressedPauseMs: config.replies.addressedPauseMs,
      delayMinMs: config.replies.delayMinSec * 1000,
      delayMaxMs: config.replies.delayMaxSec * 1000,
      quiet: { from: config.replies.quietFrom, to: config.replies.quietTo, timeZone: config.replies.timeZone },
      context: config.replies.context,
      minFresh: config.replies.minFresh,
      ownerSilenceMs: config.replies.ownerSilenceMin * 60 * 1000,
    },
    ownerCancel: config.replies.ownerCancel,
    staleAfterMs: config.replies.staleAfterMin * 60 * 1000,
    log,
  });

  try {
    const history = await client.getMessages(chat, { limit: config.replies.context });
    replier.seed(
      [...history].reverse().map((msg) => ({
        id: msg.id,
        from: msg.senderId ? String(msg.senderId) : null,
        author: (msg.senderId && names.get(String(msg.senderId))) || 'кто-то',
        replyTo: msg.replyTo ? msg.replyTo.replyToMsgId : null,
        text: msg.message || '',
      }))
    );
    log(`Ответчик: подтянул ${replier.window().length} сообщений чата для контекста`);
  } catch (err) {
    log(`Ответчик: историю чата подтянуть не удалось (${err.message}) — начинаю с пустого окна`);
  }

  const chatKey = peerKey(chat);
  subscribeMessages(client, (event) => {
    if (eventPeerKey(event) !== chatKey) return;
    const msg = chatMessageOf(event, names);
    if (!msg) return;
    replier.onMessage(msg).catch((err) => log(`Ответчик споткнулся на сообщении: ${err.message}`));
  });

  setInterval(() => {
    replier.flush().catch((err) => log(`Ответчик: очередь не разобралась (${err.message})`));
  }, REPLY_FLUSH_INTERVAL_MS);

  setInterval(() => {
    replier.tick().catch((err) => log(`Ответчик: проверка не удалась (${err.message})`));
  }, REPLY_TICK_INTERVAL_MS);

  createBotCommands({
    token: config.alert.token,
    chatId: config.alert.chatId,
    state,
    timeZone: config.replies.timeZone,
    log,
  }).start(BOT_POLL_INTERVAL_MS);

  log(
    `Автоответы: чат «${chat.title || config.replies.chat}», ${state.repliesEnabled() ? 'включены' : 'выключены'}, ` +
      `образцов речи ${voice.samples.length}, модель ${config.replies.model}`
  );
}

async function main() {
  const setup = readSetup(KEYWORDS.length);
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
  state.setForwarding(setup.features.forwarding.on);
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  if (setup.features.forwarding.on) {
    await startForwarding();
  } else {
    log('Пересылка объявлений выключена');
  }

  await startNewsDigest();
  await startReplies();

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
