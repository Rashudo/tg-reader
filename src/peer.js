const { utils } = require('telegram');

function peerKey(peer) {
  if (peer === null || peer === undefined) return null;
  try {
    return utils.getPeerId(peer).toString();
  } catch (err) {
    return null;
  }
}

function eventPeerKey(event, message) {
  return peerKey(event && event.chatId !== undefined ? event.chatId : message && message.peerId);
}

module.exports = { peerKey, eventPeerKey };
