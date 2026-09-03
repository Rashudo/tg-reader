/**
 * Что уже прочитано и что уже отправлено — по каждому каналу.
 *
 * Позиция чтения нужна, чтобы после рестарта (systemd, правка keywords.js,
 * обрыв связи) не потерять посты, вышедшие за время простоя: GramJS сам
 * пропущенное не догружает — catchUp() в библиотеке пустой.
 *
 * Список отправленных id нужен, чтобы рестарт не привёл к дублю: правка старого
 * поста приходит как отдельное событие, и без памяти о прошлых отправках
 * объявление ушло бы в Избранное второй раз.
 */
const fs = require('fs');
const path = require('path');

const STATE_PATH = process.env.TG_STATE_PATH || path.join(__dirname, '..', 'state.json');
const FLUSH_DELAY_MS = 2000;
/** Сколько отправленных id помним на канал. Хватает на любой разумный простой. */
const SENT_MEMORY = 300;

function read(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Не удалось прочитать ${file} (${err.message}) — начинаем с чистой позиции`);
    }
    return {};
  }
}

/** Ранняя версия файла хранила просто число — читаем и её. */
function normalizeEntry(value) {
  if (Number.isInteger(value)) return { lastId: value, sent: [] };
  if (!value || typeof value !== 'object') return { lastId: null, sent: [] };
  return {
    lastId: Number.isInteger(value.lastId) ? value.lastId : null,
    sent: Array.isArray(value.sent) ? value.sent.filter(Number.isInteger) : [],
  };
}

function createState(file = STATE_PATH) {
  const raw = read(file);
  const data = new Map();
  for (const [key, value] of Object.entries(raw)) data.set(key, normalizeEntry(value));
  let timer = null;

  function entry(key) {
    if (!data.has(key)) data.set(key, { lastId: null, sent: [] });
    return data.get(key);
  }

  function schedule() {
    if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      // Через временный файл: обрыв питания посреди записи не оставит битый JSON.
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(data), null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error(`Не удалось сохранить ${file}: ${err.message}`);
    }
  }

  return {
    /** id последнего просмотренного сообщения или null, если канал ещё не читали. */
    lastId(key) {
      return entry(key).lastId;
    },
    /** Позиция только растёт: пришедшее с опозданием старое сообщение её не откатит. */
    advance(key, messageId) {
      if (!Number.isInteger(messageId)) return;
      const current = entry(key);
      if (current.lastId !== null && current.lastId >= messageId) return;
      current.lastId = messageId;
      schedule();
    },
    wasSent(key, messageId) {
      return entry(key).sent.includes(messageId);
    },
    markSent(key, messageId) {
      if (!Number.isInteger(messageId)) return;
      const current = entry(key);
      if (current.sent.includes(messageId)) return;
      current.sent.push(messageId);
      if (current.sent.length > SENT_MEMORY) current.sent.splice(0, current.sent.length - SENT_MEMORY);
      schedule();
    },
    flush,
  };
}

module.exports = { createState, STATE_PATH, SENT_MEMORY };
