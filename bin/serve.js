const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { loadConfig, serviceSetup } = require('../src/platform/config');
const { openDb } = require('../src/platform/db/open');
const { importLegacyState } = require('../src/platform/db/import-state-json');
const { createNotifier } = require('../src/platform/notify/telegram-bot');
const { createLlm } = require('../src/platform/llm/anthropic');
const { readJson } = require('../src/platform/json-file');
const { openTelegram } = require('../src/runtime/boot');
const { createHost } = require('../src/runtime/host');
const { installShutdown } = require('../src/runtime/shutdown');
const { createWatchdog, createStallWatchdog } = require('../src/runtime/watchdog');
const { withTimeout } = require('../src/shared/async');
const { prepare, summary, unknownGroups } = require('../src/features/forwarding/matcher');
const { createForwardingStore } = require('../src/features/forwarding/store');
const { createForwardingJob } = require('../src/features/forwarding/job');
const { createDigestStore } = require('../src/features/digest/store');
const { createDigestJob, resolveChats } = require('../src/features/digest/job');
const { createRepliesStore } = require('../src/features/replies/store');
const { createRepliesJob } = require('../src/features/replies/job');
const { samplesOf } = require('../src/features/replies/voice');
const { createStatusWriter, createStatusJob } = require('../src/features/health/status');
const keywords = require('../keywords');

const DB_PATH = process.env.TG_DB_PATH || path.join(__dirname, '..', 'state.db');
const LEGACY_PATH = process.env.TG_STATE_PATH || path.join(__dirname, '..', 'state.json');
const VOICE_PATH = process.env.TG_VOICE_PATH || path.join(__dirname, '..', 'voice.json');

const PROBE_TIMEOUT_MS = 30 * 1000;
const OFFLINE_LIMIT_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 30 * 1000;
const DIGEST_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const STATUS_INTERVAL_MS = 30 * 1000;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
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
  if (setup.warning) console.error(setup.warning);
  for (const name of unknownGroups(config.disabledGroups, keywords)) {
    console.error(`В DISABLED_GROUPS указана неизвестная группа «${name}» — проверьте написание в keywords.js`);
  }

  const startedAt = Date.now();
  const notifier = createNotifier({ token: config.alert.token, chatId: config.alert.chatId, log });

  const db = openDb(DB_PATH);
  const imported = importLegacyState(db, LEGACY_PATH, { log });
  if (imported.imported) log(`Состояние перенесено из state.json: каналов ${imported.chats}`);

  const forwardingStore = createForwardingStore(db);
  const digestStore = createDigestStore(db);
  const repliesStore = createRepliesStore(db);
  const statusWriter = createStatusWriter(db);

  const telegram = await openTelegram({ config, log });
  const { gateway, client, clock } = telegram;

  const host = createHost({ log, notifier });
  const sources = new Map();
  let forwarding = null;
  let probeOkAt = null;

  host.add(
    createStatusJob({
      writer: statusWriter,
      clock,
      everyMs: STATUS_INTERVAL_MS,
      log,
      snapshot: () => {
        const totals = forwardingStore.totals();
        return {
          startedAt,
          forwarding: setup.features.forwarding.on,
          digestEnabled: setup.features.digest.on,
          repliesEnabled: repliesStore.enabled(),
          lastPostAt: forwardingStore.lastMessageAt(),
          probeOkAt,
          checked: totals.checked,
          forwarded: totals.forwarded,
        };
      },
    })
  );

  if (setup.features.forwarding.on) {
    for (const ref of config.channels) {
      const chat = await gateway.resolveChat(ref);
      sources.set(chat.key, chat);
      log(`Источник: ${chat.title || chat.username || ref} (id ${chat.id})`);
    }
    await gateway.resolveChat(config.target);
    log(`Пересылка в: ${config.target === 'me' ? 'Избранное' : config.target}`);
    log(summary(keywords, prepared));

    forwarding = createForwardingJob({
      gateway,
      store: forwardingStore,
      sources,
      target: config.target,
      keywords: prepared,
      notifier,
      clock,
      log,
    });
    host.add(forwarding);
  } else {
    log(`Пересылка объявлений выключена: ${setup.features.forwarding.why}`);
  }

  if (setup.features.digest.on) {
    const chats = await resolveChats(gateway, config.news.channels, log);
    if (chats.length === 0) {
      log('Сводка новостей выключена: ни один канал не открылся');
    } else {
      await gateway.resolveChat(config.news.target);
      host.add(
        createDigestJob({
          gateway,
          store: digestStore,
          llm: createLlm({ apiKey: config.anthropicKey, log }),
          chats,
          target: config.news.target,
          model: config.news.model,
          maxItems: config.news.maxItems,
          maxMessages: config.news.maxMessages,
          timeZone: config.news.timeZone,
          hour: config.news.hour,
          includeLinks: config.news.links,
          clock,
          checkEveryMs: DIGEST_CHECK_INTERVAL_MS,
          log,
          notify: (text) => notifier.send(text),
        })
      );
      log(
        `Сводка новостей: ${chats.length} канал(ов), в ${config.news.hour}:00 по ${config.news.timeZone}, модель ${config.news.model}`
      );
    }
  } else {
    log(`Сводка новостей выключена: ${setup.features.digest.why}`);
  }

  if (setup.features.replies.on) {
    const chat = await gateway.resolveChat(config.replies.chat);
    const me = await gateway.me();
    await gateway.members(chat);
    const samples = samplesOf(readJson(VOICE_PATH, null));
    if (samples.length === 0) {
      log('Автоответы: образцов речи нет, ответы будут безликими — соберите voice.json');
    }

    const replies = createRepliesJob({
      gateway,
      chat,
      store: repliesStore,
      llm: createLlm({ apiKey: config.anthropicKey, log }),
      notifier,
      meId: me.id,
      meName: me.name,
      model: config.replies.model,
      samples,
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
        maxChars: config.replies.maxChars,
      },
      ownerCancel: config.replies.ownerCancel,
      staleAfterMs: config.replies.staleAfterMin * 60 * 1000,
      clock,
      log,
    });

    try {
      const history = await gateway.recent(chat, { limit: config.replies.context });
      replies.seed(history);
      log(`Ответчик: подтянул ${replies.window().length} сообщений чата для контекста`);
    } catch (err) {
      log(`Ответчик: историю чата подтянуть не удалось (${err.message}) — начинаю с пустого окна`);
    }

    host.add(replies);
    log(
      `Автоответы: чат «${chat.title || config.replies.chat}», ${repliesStore.enabled() ? 'включены' : 'выключены'}, ` +
        `образцов речи ${samples.length}, модель ${config.replies.model}`
    );
  } else {
    log(`Автоответы выключены: ${setup.features.replies.why}`);
  }

  const shutdown = installShutdown({
    host,
    telegram,
    state: { close: () => db.close() },
    log,
    exit: (code) => process.exit(code),
  });

  await host.start();

  if (forwarding) {
    const stallMs = config.health.stallGiveUpMin * 60 * 1000;
    createStallWatchdog({
      lastMessageAt: () => Math.max(forwardingStore.lastMessageAt() || 0, startedAt),
      probe: async () => {
        for (const chat of sources.values()) {
          if (await withTimeout(forwarding.isBehind(chat), PROBE_TIMEOUT_MS, 'канал не ответил за 30 секунд')) {
            return true;
          }
        }
        return false;
      },
      onQuiet: (at) => {
        probeOkAt = at;
      },
      onReconnect: async () => {
        await client.disconnect();
        await withTimeout(client.connect(), 60000, 'переподключение не уложилось в минуту');
        log('Переподключился, догружаю пропущенное');
        for (const chat of sources.values()) {
          await forwarding
            .backfill(chat)
            .catch((err) => log(`Догрузка после переподключения не удалась: ${err.message}`));
        }
      },
      onGiveUp: async () => {
        const text = `Из канала нет сообщений ${stallMs / 60000} мин, и в нём есть непрочитанное — выхожу на перезапуск`;
        console.error(text);
        await notifier.send(`🟠 tg-reader: ${text}`);
        await shutdown(1);
      },
      log,
      reconnectAfterMs: config.health.stallReconnectMin * 60 * 1000,
      giveUpAfterMs: stallMs,
    }).start(WATCHDOG_INTERVAL_MS);
  }

  createWatchdog({
    isConnected: () => Boolean(client.connected),
    onGiveUp: async () => {
      const text = `Нет связи с Telegram дольше ${OFFLINE_LIMIT_MS / 60000} мин — выхожу, чтобы systemd перезапустил сервис`;
      console.error(text);
      await notifier.send(`🟠 tg-reader: ${text}`);
      await shutdown(1);
    },
    log,
    limitMs: OFFLINE_LIMIT_MS,
    intervalMs: WATCHDOG_INTERVAL_MS,
  }).start();

  log('Запущен');
  return null;
}

main()
  .then((code) => {
    if (code !== null) process.exit(code);
  })
  .catch((err) => {
    console.error('Не удалось запуститься:', err.message);
    process.exit(1);
  });
