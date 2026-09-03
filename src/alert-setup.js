const https = require('https');
const path = require('path');
const { config } = require('./config');
const { setEnvVar } = require('./envfile');
const { createNotifier } = require('./notify');

const ENV_PATH = path.join(__dirname, '..', '.env');

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 15000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Bot API вернул не JSON (код ${res.statusCode})`));
          }
        });
      })
      .on('error', reject);
  });
}

(async () => {
  if (!config.alert.token) {
    console.error('Не задан ALERT_BOT_TOKEN в .env. Создайте бота у @BotFather и положите токен туда.');
    process.exit(1);
  }

  const updates = await getJson(`https://api.telegram.org/bot${config.alert.token}/getUpdates`);
  if (!updates.ok) {
    console.error(`Bot API отказал: ${updates.description}. Проверьте токен.`);
    process.exit(1);
  }

  const chats = new Map();
  for (const update of updates.result) {
    const message = update.message || update.channel_post;
    if (message && message.chat) chats.set(String(message.chat.id), message.chat);
  }

  if (chats.size === 0) {
    console.error('Бот не получил ни одного сообщения. Напишите ему /start и запустите снова.');
    console.error('Если писали давно — отправьте новое сообщение: Telegram хранит апдейты сутки.');
    process.exit(1);
  }
  if (chats.size > 1) {
    console.error('Боту писали из нескольких чатов, выберите нужный и впишите ALERT_CHAT_ID вручную:');
    for (const [id, chat] of chats) console.error(`  ${id} — ${chat.title || chat.username || chat.first_name}`);
    process.exit(1);
  }

  const [id, chat] = [...chats][0];
  setEnvVar(ENV_PATH, 'ALERT_CHAT_ID', id);
  console.log(`ALERT_CHAT_ID=${id} (${chat.title || chat.username || chat.first_name}) записан в .env`);

  const notifier = createNotifier({ token: config.alert.token, chatId: id, log: console.error });
  const sent = await notifier.send('✅ tg-reader: уведомления настроены. Сюда будут приходить тревоги.');
  console.log(sent ? 'Проверочное уведомление отправлено.' : 'Не удалось отправить проверочное уведомление.');
  process.exit(sent ? 0 : 1);
})().catch((err) => {
  console.error('Настройка не удалась:', err.message);
  process.exit(1);
});
