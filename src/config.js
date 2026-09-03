const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { numFromEnv, listFromEnv } = require('./env');

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
  health: {
    serviceName: (process.env.SERVICE_NAME || 'tg-reader').trim(),
    stallReconnectMin: numFromEnv(process.env.STALL_RECONNECT_MIN, 30),
    stallGiveUpMin: numFromEnv(process.env.STALL_GIVEUP_MIN, 45),
    repeatMin: numFromEnv(process.env.ALERT_REPEAT_MIN, 60),
    digestHour: numFromEnv(process.env.DIGEST_HOUR, 9),
    flappingRestarts: numFromEnv(process.env.FLAPPING_RESTARTS, 3),
  },
};

if (Number.isNaN(config.apiId)) {
  console.error('TG_API_ID должен быть числом');
  process.exit(1);
}

module.exports = { config, required };
