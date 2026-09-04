const path = require('path');
const { createTelegramClient } = require('../platform/telegram/client');
const { createGateway } = require('../platform/telegram/gateway');
const { createClock } = require('../platform/clock');
const { takeLock } = require('../platform/lock');
const { withTimeout } = require('../shared/async');

const CONNECT_TIMEOUT_MS = 60 * 1000;
const LOCK_PATH = process.env.TG_LOCK_PATH || path.join(__dirname, '..', '..', 'run', 'tg.lock');

async function openTelegram({ config, log, lockFile = LOCK_PATH, session = config.session }) {
  const lock = takeLock(lockFile);
  if (!lock.ok) {
    throw new Error(`Сессия занята: сервис работает (pid ${lock.holder}), остановите его`);
  }

  const client = createTelegramClient({ apiId: config.apiId, apiHash: config.apiHash, session });
  if (client.setLogLevel) client.setLogLevel('error');

  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'не удалось подключиться к Telegram за минуту');
    if (!(await client.isUserAuthorized())) {
      throw new Error('Сессия недействительна. Выполните: npm run login');
    }
  } catch (err) {
    lock.release();
    throw err;
  }

  const clock = createClock();
  const gateway = createGateway({ client, clock, log });

  return {
    client,
    clock,
    gateway,
    async close() {
      try {
        await client.disconnect();
      } catch (err) {
        log(`Отключение прошло не чисто: ${err.message}`);
      }
      clock.cancelAll();
      lock.release();
    },
  };
}

module.exports = { openTelegram, CONNECT_TIMEOUT_MS, LOCK_PATH };
