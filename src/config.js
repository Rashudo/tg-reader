const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { numFromEnv, hourOrOff, pauseMsFrom, listFromEnv } = require('./env');

function required(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    console.error(`Не задана переменная ${name} в .env — см. .env.example`);
    process.exit(1);
  }
  return value;
}

const config = {
  apiId: Number(required('TG_API_ID')),
  apiHash: required('TG_API_HASH'),
  session: (process.env.TG_SESSION || '').trim(),
  channels: (process.env.CHANNEL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  target: (process.env.TARGET || 'me').trim(),
  disabledGroups: listFromEnv(process.env.DISABLED_GROUPS),
  alert: {
    token: (process.env.ALERT_BOT_TOKEN || '').trim(),
    chatId: (process.env.ALERT_CHAT_ID || '').trim(),
  },
  anthropicKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
  news: {
    channels: listFromEnv(process.env.NEWS_CHANNELS),
    target: (process.env.NEWS_TARGET || process.env.TARGET || 'me').trim(),
    model: (process.env.NEWS_MODEL || 'claude-haiku-4-5').trim(),
    hour: numFromEnv(process.env.NEWS_HOUR, 7),
    timeZone: (process.env.NEWS_TZ || 'Europe/Belgrade').trim(),
    maxMessages: numFromEnv(process.env.NEWS_MAX_MESSAGES, 400),
    maxItems: numFromEnv(process.env.NEWS_MAX_ITEMS, 35),
    links: (process.env.NEWS_LINKS || 'off').trim().toLowerCase() === 'on',
  },
  replies: {
    chat: (process.env.REPLY_CHAT || '').trim(),
    enabled: (process.env.REPLY_ENABLED || 'on').trim().toLowerCase() !== 'off',
    model: (process.env.REPLY_MODEL || 'claude-opus-4-8').trim(),
    aliases: listFromEnv(process.env.REPLY_ALIASES),
    dailyBudget: numFromEnv(process.env.REPLY_DAILY_BUDGET, 4),
    addressedBudget: numFromEnv(process.env.REPLY_ADDRESSED_BUDGET, 10),
    spontaneousPauseMs: pauseMsFrom(
      process.env.REPLY_SPONTANEOUS_PAUSE_SEC,
      process.env.REPLY_SPONTANEOUS_PAUSE_MIN,
      90
    ),
    addressedPauseMs: pauseMsFrom(process.env.REPLY_ADDRESSED_PAUSE_SEC, process.env.REPLY_ADDRESSED_PAUSE_MIN, 5),
    delayMinSec: numFromEnv(process.env.REPLY_DELAY_MIN_SEC, 120),
    delayMaxSec: numFromEnv(process.env.REPLY_DELAY_MAX_SEC, 240),
    quietFrom: numFromEnv(process.env.REPLY_QUIET_FROM, 23),
    quietTo: numFromEnv(process.env.REPLY_QUIET_TO, 9),
    context: numFromEnv(process.env.REPLY_CONTEXT, 30),
    minFresh: numFromEnv(process.env.REPLY_MIN_FRESH, 5),
    ownerSilenceMin: numFromEnv(process.env.REPLY_OWNER_SILENCE_MIN, 15),
    maxChars: numFromEnv(process.env.REPLY_MAX_CHARS, 160),
    staleAfterMin: numFromEnv(process.env.REPLY_STALE_AFTER_MIN, 10),
    ownerCancel: (process.env.REPLY_OWNER_CANCEL || 'answer').trim().toLowerCase() === 'any' ? 'any' : 'answer',
    timeZone: (process.env.NEWS_TZ || 'Europe/Belgrade').trim(),
  },
  health: {
    serviceName: (process.env.SERVICE_NAME || 'tg-reader').trim(),
    stallReconnectMin: numFromEnv(process.env.STALL_RECONNECT_MIN, 30),
    stallGiveUpMin: numFromEnv(process.env.STALL_GIVEUP_MIN, 45),
    repeatMin: numFromEnv(process.env.ALERT_REPEAT_MIN, 60),
    digestHour: hourOrOff(process.env.DIGEST_HOUR),
    flappingRestarts: numFromEnv(process.env.FLAPPING_RESTARTS, 3),
  },
};

if (Number.isNaN(config.apiId)) {
  console.error('TG_API_ID должен быть числом');
  process.exit(1);
}

module.exports = { config, required };
