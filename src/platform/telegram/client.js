const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

function createTelegramClient({ apiId, apiHash, session }) {
  return new TelegramClient(new StringSession(session), apiId, apiHash, { floodSleepThreshold: 300 });
}

module.exports = { createTelegramClient };
