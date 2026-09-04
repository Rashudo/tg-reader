const { config } = require('./config');
const { serviceSetup } = require('./platform/config');

function readSetup(keywordsCount) {
  return serviceSetup({
    session: config.session,
    channels: config.channels,
    keywordsCount,
    anthropicKey: config.anthropicKey,
    newsChannels: config.news.channels,
    repliesChat: config.replies.chat,
    repliesEnabled: config.replies.enabled,
  });
}

module.exports = { readSetup };
