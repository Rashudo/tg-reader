const TELEGRAM_LIMIT = 4096;

function cut(text, limit = TELEGRAM_LIMIT) {
  if (text.length <= limit) return text;
  let end = limit - 1;
  const lastKept = text.charCodeAt(end - 1);
  if (lastKept >= 0xd800 && lastKept <= 0xdbff) end -= 1;
  return text.slice(0, end) + '…';
}

function messageLink(chat, messageId) {
  if (chat && chat.username) return `https://t.me/${chat.username}/${messageId}`;
  if (chat && chat.id) return `https://t.me/c/${chat.id}/${messageId}`;
  return '';
}

module.exports = { cut, messageLink, TELEGRAM_LIMIT };
