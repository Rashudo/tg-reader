/**
 * Единый ключ чата.
 *
 * Telegram отдаёт id в нескольких видах: у события — marked id (-100<raw> для
 * канала, -<raw> для группы, <raw> для пользователя), у резолвнутой сущности —
 * сырой положительный id. Срезать префиксы нельзя: канал -1001234567890,
 * группа -1234567890 и пользователь 1234567890 схлопнутся в один ключ, и личное
 * сообщение будет принято за пост канала. getPeerId сохраняет тип peer'а.
 */
const { utils } = require('telegram');

function peerKey(peer) {
  if (peer === null || peer === undefined) return null;
  try {
    return utils.getPeerId(peer).toString();
  } catch (err) {
    return null;
  }
}

/** Ключ чата, из которого пришло событие: chatId уже marked, peerId — запасной путь. */
function eventPeerKey(event, message) {
  return peerKey(event && event.chatId !== undefined ? event.chatId : message && message.peerId);
}

module.exports = { peerKey, eventPeerKey };
