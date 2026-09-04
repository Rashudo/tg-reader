const { config } = require('./config');
const { createTelegramClient } = require('./platform/telegram/client');

function createClient(session = config.session) {
  return createTelegramClient({ apiId: config.apiId, apiHash: config.apiHash, session });
}

module.exports = { createClient };
