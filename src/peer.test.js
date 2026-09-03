const test = require('node:test');
const assert = require('node:assert');
const bigInt = require('big-integer');
const { Api } = require('telegram');
const { peerKey, eventPeerKey } = require('./peer');

const raw = bigInt('1234567890');

test('одинаковый канал в разных видах даёт один ключ', () => {
  const fromEntity = peerKey(new Api.PeerChannel({ channelId: raw }));
  const fromEvent = peerKey(bigInt('-1001234567890'));
  assert.strictEqual(fromEntity, fromEvent);
});

test('канал, группа и пользователь с одним числовым id различимы', () => {
  const channel = peerKey(new Api.PeerChannel({ channelId: raw }));
  const chat = peerKey(new Api.PeerChat({ chatId: raw }));
  const user = peerKey(new Api.PeerUser({ userId: raw }));
  assert.strictEqual(new Set([channel, chat, user]).size, 3);
});

test('ключ события берётся из chatId, при его отсутствии — из peerId', () => {
  const peer = new Api.PeerChannel({ channelId: raw });
  assert.strictEqual(eventPeerKey({ chatId: bigInt('-1001234567890') }, {}), '-1001234567890');
  assert.strictEqual(eventPeerKey({}, { peerId: peer }), '-1001234567890');
  assert.strictEqual(eventPeerKey({}, {}), null);
});
