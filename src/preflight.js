const { config } = require('./config');

function checkSetup({ session, channels, keywordsCount, newsConfigured, repliesConfigured = false }) {
  const answer = {
    error: null,
    warning: null,
    forwarding: channels.length > 0,
    news: newsConfigured,
    replies: repliesConfigured,
  };

  if (!session) {
    answer.error = 'Нет TG_SESSION. Сначала выполните: npm run login';
    return answer;
  }

  if (answer.forwarding && keywordsCount === 0) {
    answer.forwarding = false;
    const trouble = 'Ни одного включённого ключевого слова: keywords.js пуст или все группы в DISABLED_GROUPS';
    const alive = [newsConfigured && 'сводка новостей', repliesConfigured && 'автоответы'].filter(Boolean);
    if (alive.length) answer.warning = `${trouble}. Пересылку объявлений пропускаю, ${alive.join(' и ')} работают`;
    else answer.error = trouble;
    return answer;
  }

  if (!answer.forwarding && !newsConfigured && !repliesConfigured) {
    answer.error =
      'Нечего делать: не задан ни CHANNEL для объявлений, ни NEWS_CHANNELS для сводки, ни REPLY_CHAT для ответов — см. .env.example';
  }
  return answer;
}

function readSetup(keywordsCount, newsConfigured, repliesConfigured = false) {
  return checkSetup({
    session: config.session,
    channels: config.channels,
    keywordsCount,
    newsConfigured,
    repliesConfigured,
  });
}

module.exports = { checkSetup, readSetup };
