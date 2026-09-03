const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { config } = require('./config');

function createClient(sessionString = config.session) {
  return new TelegramClient(
    new StringSession(sessionString),
    config.apiId,
    config.apiHash,
    {
      // connectionRetries специально не ограничиваем (по умолчанию Infinity):
      // исчерпав попытки, GramJS помечает сендер отключённым и больше никогда
      // не переподключается — процесс остаётся жив и молча ничего не пересылает.
      // Телефон "не поднимает трубку" неограниченно долго, и это правильно.
      // Telegram иногда просит подождать; до 5 минут ждём сами, а не падаем.
      floodSleepThreshold: 300,
    }
  );
}

module.exports = { createClient };
