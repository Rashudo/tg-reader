/** Проверки, без которых и index.js, и scan.js молча не делают ничего. */
const { config } = require('./config');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function checkReady(keywordsCount) {
  if (!config.session) fail('Нет TG_SESSION. Сначала выполните: npm run login');
  if (config.channels.length === 0) fail('Не задан CHANNEL в .env — см. .env.example');
  if (keywordsCount === 0) fail('Массив в keywords.js пуст — искать нечего');
}

module.exports = { checkReady, fail };
