const path = require('path');
const input = require('input');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { loadConfig } = require('../src/platform/config');
const { setEnvVar } = require('../src/platform/env-file');
const { createTelegramClient } = require('../src/platform/telegram/client');
const { takeLock } = require('../src/platform/lock');
const { LOCK_PATH } = require('../src/runtime/boot');

const DOTENV = path.join(__dirname, '..', '.env');

async function main() {
  const { config, errors } = loadConfig(process.env);
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    return 1;
  }

  const lock = takeLock(LOCK_PATH);
  if (!lock.ok) {
    console.error(`Сессия занята: сервис работает (pid ${lock.holder}), остановите его`);
    return 1;
  }

  try {
    const client = createTelegramClient({ apiId: config.apiId, apiHash: config.apiHash, session: '' });
    if (client.setLogLevel) client.setLogLevel('error');

    await client.start({
      phoneNumber: () => input.text('Телефон (например +79991234567): '),
      phoneCode: () => input.text('Код из Telegram: '),
      password: () => input.password('Пароль двухфакторной аутентификации (если включена): '),
      onError: (err) => console.error('Ошибка входа:', err.message || err),
    });

    const me = await client.getMe();
    setEnvVar(DOTENV, 'TG_SESSION', client.session.save());
    console.log(`\nГотово. Вошли как ${me.username ? '@' + me.username : me.firstName}.`);
    console.log('Строка сессии записана в .env (TG_SESSION). Никому её не показывайте.');
    console.log('Дальше: npm start');
    await client.disconnect();
    return 0;
  } finally {
    lock.release();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Вход не удался:', err.message);
    process.exit(1);
  });
