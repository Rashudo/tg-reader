/**
 * Слушает новые сообщения в указанном канале от имени вашего аккаунта
 * и пересылает в TARGET те, что содержат хотя бы одно слово из keywords.js.
 */
const { NewMessage } = require('telegram/events');
const { config } = require('./config');
const { createClient } = require('./client');
const { prepare, findMatches } = require('./matcher');
const keywords = require('../keywords');

const KEYWORDS = prepare(keywords);

/** Защита от повторной пересылки, если Telegram переприслал апдейт после реконнекта. */
const seen = new Set();
function alreadyHandled(key) {
  if (seen.has(key)) return true;
  seen.add(key);
  if (seen.size > 5000) seen.delete(seen.values().next().value);
  return false;
}

/** id канала приходит в разных формах (-100123, -123, 123) — сводим к одной. */
function normId(value) {
  return String(value ?? '').replace(/^-100/, '').replace(/^-/, '');
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function messageLink(chat, messageId) {
  if (chat && chat.username) return `https://t.me/${chat.username}/${messageId}`;
  if (chat && chat.id) return `https://t.me/c/${chat.id}/${messageId}`;
  return '';
}

async function main() {
  if (!config.session) {
    console.error('Нет TG_SESSION. Сначала выполните: npm run login');
    process.exit(1);
  }
  if (config.channels.length === 0) {
    console.error('Не задан CHANNEL в .env');
    process.exit(1);
  }
  if (KEYWORDS.length === 0) {
    console.error('Массив в keywords.js пуст — пересылать будет нечего');
    process.exit(1);
  }

  const client = createClient();
  if (client.setLogLevel) client.setLogLevel('error');
  await client.connect();

  if (!(await client.isUserAuthorized())) {
    console.error('Сессия недействительна. Выполните: npm run login');
    process.exit(1);
  }

  // Резолвим каналы заранее: так сразу видно опечатку в CHANNEL,
  // и появляется точный список id для фильтра событий.
  const sources = new Map();
  for (const ref of config.channels) {
    try {
      const entity = await client.getEntity(ref);
      sources.set(normId(entity.id), entity);
      log(`Источник: ${entity.title || entity.username || ref} (id ${entity.id})`);
    } catch (err) {
      console.error(`Не удалось открыть канал "${ref}": ${err.message}. Вы точно на него подписаны?`);
      process.exit(1);
    }
  }

  const target = await client.getEntity(config.target === 'me' ? 'me' : config.target);
  log(`Пересылка в: ${config.target === 'me' ? 'Избранное' : target.title || target.username}`);
  log(`Ключевых слов: ${KEYWORDS.length}`);

  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg) return;

    const chatId = normId(event.chatId ?? msg.peerId?.channelId ?? msg.peerId?.chatId);
    const source = sources.get(chatId);
    if (!source) return;

    // msg.message — это и текст сообщения, и подпись к медиа.
    const text = msg.message || '';
    const hits = findMatches(text, KEYWORDS);
    if (hits.length === 0) return;

    if (alreadyHandled(`${chatId}:${msg.id}`)) return;

    const link = messageLink(source, msg.id);
    try {
      await client.forwardMessages(target, { messages: [msg.id], fromPeer: source });
      log(`Переслано [${hits.join(', ')}] ${link}`);
    } catch (err) {
      // В канале может стоять запрет на пересылку — тогда шлём копию текста со ссылкой.
      log(`Пересылка не удалась (${err.message}), отправляю копию`);
      const head = `Совпадение: ${hits.join(', ')}\n${source.title || ''} ${link}`.trim();
      await client.sendMessage(target, { message: `${head}\n\n${text}`.slice(0, 4096) });
      log(`Отправлена копия [${hits.join(', ')}] ${link}`);
    }
  }, new NewMessage({}));

  log('Слушаю новые сообщения. Ctrl+C для остановки.');
}

main().catch((err) => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
