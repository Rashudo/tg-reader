function numFromEnv(raw, fallback) {
  const text = (raw === undefined || raw === null ? '' : String(raw)).trim();
  if (text === '') return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function hourOrOff(raw) {
  const text = (raw === undefined || raw === null ? '' : String(raw)).trim().toLowerCase();
  if (text === '' || text === 'off' || text === 'нет') return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0 || value > 23) return null;
  return value;
}

function pauseMsFrom(rawSeconds, rawMinutes, fallbackMinutes) {
  const seconds = numFromEnv(rawSeconds, null);
  if (seconds !== null) return seconds * 1000;
  return numFromEnv(rawMinutes, fallbackMinutes) * 60 * 1000;
}

function listFromEnv(raw) {
  return String(raw === undefined || raw === null ? '' : raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function text(env, name, fallback = '') {
  const value = (env[name] || '').trim();
  return value || fallback;
}

function loadConfig(env = {}) {
  const errors = [];
  const warnings = [];

  for (const name of ['TG_API_ID', 'TG_API_HASH']) {
    if (!text(env, name)) errors.push(`Не задана переменная ${name} в .env — см. .env.example`);
  }

  const apiId = Number(text(env, 'TG_API_ID'));
  if (text(env, 'TG_API_ID') && !Number.isInteger(apiId)) errors.push('TG_API_ID должен быть числом');

  const timeZone = text(env, 'NEWS_TZ', 'Europe/Belgrade');

  const config = {
    apiId,
    apiHash: text(env, 'TG_API_HASH'),
    session: text(env, 'TG_SESSION'),
    channels: listFromEnv(env.CHANNEL),
    target: text(env, 'TARGET', 'me'),
    disabledGroups: listFromEnv(env.DISABLED_GROUPS),
    alert: {
      token: text(env, 'ALERT_BOT_TOKEN'),
      chatId: text(env, 'ALERT_CHAT_ID'),
    },
    anthropicKey: text(env, 'ANTHROPIC_API_KEY'),
    news: {
      channels: listFromEnv(env.NEWS_CHANNELS),
      target: text(env, 'NEWS_TARGET', text(env, 'TARGET', 'me')),
      model: text(env, 'NEWS_MODEL', 'claude-haiku-4-5'),
      hour: numFromEnv(env.NEWS_HOUR, 7),
      timeZone,
      maxMessages: numFromEnv(env.NEWS_MAX_MESSAGES, 400),
      maxItems: numFromEnv(env.NEWS_MAX_ITEMS, 35),
      links: text(env, 'NEWS_LINKS', 'off').toLowerCase() === 'on',
    },
    replies: {
      chat: text(env, 'REPLY_CHAT'),
      enabled: text(env, 'REPLY_ENABLED', 'on').toLowerCase() !== 'off',
      model: text(env, 'REPLY_MODEL', 'claude-opus-4-8'),
      aliases: listFromEnv(env.REPLY_ALIASES),
      dailyBudget: numFromEnv(env.REPLY_DAILY_BUDGET, 4),
      addressedBudget: numFromEnv(env.REPLY_ADDRESSED_BUDGET, 10),
      spontaneousPauseMs: pauseMsFrom(env.REPLY_SPONTANEOUS_PAUSE_SEC, env.REPLY_SPONTANEOUS_PAUSE_MIN, 90),
      addressedPauseMs: pauseMsFrom(env.REPLY_ADDRESSED_PAUSE_SEC, env.REPLY_ADDRESSED_PAUSE_MIN, 5),
      delayMinSec: numFromEnv(env.REPLY_DELAY_MIN_SEC, 120),
      delayMaxSec: numFromEnv(env.REPLY_DELAY_MAX_SEC, 240),
      quietFrom: numFromEnv(env.REPLY_QUIET_FROM, 23),
      quietTo: numFromEnv(env.REPLY_QUIET_TO, 9),
      context: numFromEnv(env.REPLY_CONTEXT, 60),
      minFresh: numFromEnv(env.REPLY_MIN_FRESH, 5),
      ownerSilenceMin: numFromEnv(env.REPLY_OWNER_SILENCE_MIN, 15),
      maxChars: numFromEnv(env.REPLY_MAX_CHARS, 160),
      staleAfterMin: numFromEnv(env.REPLY_STALE_AFTER_MIN, 10),
      ownerCancel: text(env, 'REPLY_OWNER_CANCEL', 'answer').toLowerCase() === 'any' ? 'any' : 'answer',
      timeZone,
    },
    health: {
      serviceName: text(env, 'SERVICE_NAME', 'tg-reader'),
      stallReconnectMin: numFromEnv(env.STALL_RECONNECT_MIN, 30),
      stallGiveUpMin: numFromEnv(env.STALL_GIVEUP_MIN, 45),
      repeatMin: numFromEnv(env.ALERT_REPEAT_MIN, 60),
      digestHour: hourOrOff(env.DIGEST_HOUR),
      flappingRestarts: numFromEnv(env.FLAPPING_RESTARTS, 3),
    },
  };

  return { config, errors, warnings };
}

function serviceSetup({
  session = '',
  channels = [],
  keywordsCount = 0,
  anthropicKey = '',
  newsChannels = [],
  repliesChat = '',
  repliesEnabled = true,
}) {
  const digestWhy = !anthropicKey
    ? 'не задан ANTHROPIC_API_KEY'
    : newsChannels.length === 0
      ? 'не задан NEWS_CHANNELS'
      : null;
  const repliesWhy = !repliesChat
    ? 'не задан REPLY_CHAT'
    : !anthropicKey
      ? 'не задан ANTHROPIC_API_KEY'
      : !repliesEnabled
        ? 'REPLY_ENABLED=off'
        : null;

  const features = {
    forwarding: { on: channels.length > 0, why: channels.length > 0 ? null : 'не задан CHANNEL' },
    digest: { on: digestWhy === null, why: digestWhy },
    replies: { on: repliesWhy === null, why: repliesWhy },
  };
  const answer = { error: null, warning: null, features };

  if (!session) {
    answer.error = 'Нет TG_SESSION. Сначала выполните: npm run login';
    return answer;
  }

  if (features.forwarding.on && keywordsCount === 0) {
    features.forwarding = { on: false, why: 'ни одного включённого ключевого слова' };
    const trouble = 'Ни одного включённого ключевого слова: keywords.js пуст или все группы в DISABLED_GROUPS';
    const alive = [features.digest.on && 'сводка новостей', features.replies.on && 'автоответы'].filter(Boolean);
    if (alive.length) answer.warning = `${trouble}. Пересылку объявлений пропускаю, ${alive.join(' и ')} работают`;
    else answer.error = trouble;
    return answer;
  }

  if (!features.forwarding.on && !features.digest.on && !features.replies.on) {
    answer.error =
      'Нечего делать: не задан ни CHANNEL для объявлений, ни NEWS_CHANNELS для сводки, ни REPLY_CHAT для ответов — см. .env.example';
  }
  return answer;
}

module.exports = { loadConfig, serviceSetup, numFromEnv, hourOrOff, pauseMsFrom, listFromEnv };
