const fs = require('fs');
const { config } = require('../src/config');
const { createClient } = require('../src/client');
const { pickSamples, VOICE_PATH } = require('../src/voice');

const LIMIT = 80;
const SCAN = 1000;

function fromFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : raw.messages || [];
}

(async () => {
  const fileArg = process.argv.indexOf('--from-file');
  let messages;

  if (fileArg !== -1) {
    messages = fromFile(process.argv[fileArg + 1]);
  } else {
    if (!config.replies.chat) {
      console.error('REPLY_CHAT не задан');
      process.exit(1);
    }
    console.log('Скрипт подключается к Telegram: сервис должен быть остановлен.');
    const client = createClient();
    if (client.setLogLevel) client.setLogLevel('error');
    await client.connect();
    if (!(await client.isUserAuthorized())) {
      console.error('Сессия недействительна. Выполните: npm run login');
      process.exit(1);
    }
    const chat = await client.getEntity(config.replies.chat);
    const fetched = await client.getMessages(chat, { limit: SCAN, fromUser: 'me' });
    messages = fetched.map((msg) => ({ text: msg.message || '' }));
    await client.disconnect();
  }

  const samples = pickSamples(messages, { limit: LIMIT, minWords: 3, maxChars: 200 });
  fs.writeFileSync(VOICE_PATH, JSON.stringify({ samples }, null, 2));
  console.log(`Образцов речи: ${samples.length} из ${messages.length} сообщений → ${VOICE_PATH}`);
})().catch((err) => {
  console.error('Не удалось собрать образцы:', err.message);
  process.exit(1);
});
