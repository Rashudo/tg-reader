const path = require('path');
const input = require('input');
const { setEnvVar } = require('./envfile');
const { createClient } = require('./client');

const ENV_PATH = path.join(__dirname, '..', '.env');

function saveSession(session) {
  setEnvVar(ENV_PATH, 'TG_SESSION', session);
}

(async () => {
  const client = createClient('');
  if (client.setLogLevel) client.setLogLevel('error');

  await client.start({
    phoneNumber: () => input.text('Телефон (например +79991234567): '),
    phoneCode: () => input.text('Код из Telegram: '),
    password: () => input.password('Пароль двухфакторной аутентификации (если включена): '),
    onError: (err) => console.error('Ошибка входа:', err.message || err),
  });

  const me = await client.getMe();
  saveSession(client.session.save());
  console.log(`\nГотово. Вошли как ${me.username ? '@' + me.username : me.firstName}.`);
  console.log('Строка сессии записана в .env (TG_SESSION). Никому её не показывайте.');
  console.log('Дальше: npm start');
  await client.disconnect();
  process.exit(0);
})();
