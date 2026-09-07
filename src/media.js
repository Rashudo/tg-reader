function stickerEmoji(sticker) {
  const attributes = (sticker && sticker.attributes) || [];
  const found = attributes.find((attr) => attr && typeof attr.alt === 'string' && attr.alt);
  return found ? found.alt : '';
}

function describeMedia(msg) {
  if (!msg) return '';
  if (msg.sticker) return `стикер ${stickerEmoji(msg.sticker)}`.trim();
  if (msg.gif) return 'гифка';
  if (msg.videoNote) return 'кружок';
  if (msg.voice) return 'голосовое';
  if (msg.video) return 'видео';
  if (msg.audio) return 'аудио';
  if (msg.photo) return 'фото';
  if (msg.poll) return 'опрос';
  if (msg.contact) return 'контакт';
  if (msg.geo) return 'геометка';
  if (msg.document) return 'файл';
  return '';
}

function chatText({ text, media } = {}) {
  const caption = (text || '').trim();
  if (!media) return caption;
  return caption ? `[${media}] ${caption}` : `[${media}]`;
}

module.exports = { describeMedia, chatText };
