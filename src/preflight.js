const { config } = require('./config');

function checkSetup({ session, channels, keywordsCount, newsConfigured }) {
  const answer = { error: null, warning: null, forwarding: channels.length > 0, news: newsConfigured };

  if (!session) {
    answer.error = 'Нет TG_SESSION. Сначала выполните: npm run login';
    return answer;
  }

  if (answer.forwarding && keywordsCount === 0) {
    answer.forwarding = false;
    const trouble = 'Ни одного включённого ключевого слова: keywords.js пуст или все группы в DISABLED_GROUPS';
    if (newsConfigured) answer.warning = `${trouble}. Пересылку объявлений пропускаю, сводка новостей работает`;
    else answer.error = trouble;
    return answer;
  }

  if (!answer.forwarding && !newsConfigured) {
    answer.error = 'Нечего делать: не задан ни CHANNEL для объявлений, ни NEWS_CHANNELS для сводки — см. .env.example';
  }
  return answer;
}

function readSetup(keywordsCount, newsConfigured) {
  return checkSetup({
    session: config.session,
    channels: config.channels,
    keywordsCount,
    newsConfigured,
  });
}

module.exports = { checkSetup, readSetup };
