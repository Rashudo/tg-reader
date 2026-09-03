const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { config } = require('./config');

function createClient(sessionString = config.session) {
  return new TelegramClient(
    new StringSession(sessionString),
    config.apiId,
    config.apiHash,
    {
      floodSleepThreshold: 300,
    }
  );
}

module.exports = { createClient };
