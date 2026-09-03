const fs = require('fs');
const path = require('path');
const input = require('input');
const { createClient } = require('./client');

const ENV_PATH = path.join(__dirname, '..', '.env');

function saveSession(session) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const line = `TG_SESSION=${session}`;
  if (/^TG_SESSION=.*$/m.test(content)) {
    content = content.replace(/^TG_SESSION=.*$/m, () => line);
  } else {
    content += (content.endsWith('\n') || content === '' ? '' : '\n') + line + '\n';
  }
  fs.writeFileSync(ENV_PATH, content, { mode: 0o600 });
  fs.chmodSync(ENV_PATH, 0o600);
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
