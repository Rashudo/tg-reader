const { Api, utils } = require('telegram');

function channel(id, title, username) {
  return new Api.Channel({
    id: BigInt(id),
    title,
    username,
    photo: null,
    participantsCount: 2,
    date: 0,
    accessHash: BigInt(1),
  });
}

function createFakeClient({ membersFail = false } = {}) {
  const handlers = [];
  const entities = new Map([
    ['@one', channel(111, 'Первый', 'one')],
    ['me', new Api.User({ id: BigInt(999), firstName: 'Хозяин', username: 'owner' })],
  ]);
  const messages = new Map([
    [
      utils.getPeerId(entities.get('@one')).toString(),
      [
        { id: 1, date: 1700000000, message: 'первое', senderId: 5, replyTo: null, groupedId: null },
        { id: 2, date: 1700000060, message: 'второе', senderId: 6, replyTo: { replyToMsgId: 1 }, groupedId: null },
        { id: 3, date: 1700000120, message: 'третье', senderId: 5, replyTo: null, groupedId: null },
      ],
    ],
  ]);
  let nextId = 500;

  return {
    connected: false,
    sent: [],
    forwarded: [],
    async connect() { this.connected = true; },
    async disconnect() { this.connected = false; },
    async isUserAuthorized() { return true; },
    async getMe() { return { id: 999, firstName: 'Хозяин', username: 'owner' }; },
    async getEntity(ref) {
      const found = entities.get(ref);
      if (!found) throw new Error(`нет такого чата: ${ref}`);
      return found;
    },
    async getParticipants() {
      if (membersFail) throw new Error('нет прав читать участников');
      return [{ id: 5, firstName: 'Аня', username: 'anya' }, { id: 6, firstName: null, username: 'boris' }];
    },
    async getMessages(chat, { limit = 10, minId } = {}) {
      const all = messages.get(utils.getPeerId(chat).toString()) || [];
      const picked = minId === undefined ? all : all.filter((msg) => msg.id > minId);
      return picked.slice(-limit).reverse();
    },
    async sendMessage(chat, { message, replyTo }) {
      utils.getPeerId(chat);
      nextId += 1;
      const posted = {
        id: nextId,
        date: Math.floor(Date.now() / 1000),
        message,
        senderId: 999,
        replyTo: replyTo ? { replyToMsgId: replyTo } : null,
        groupedId: null,
      };
      this.sent.push({ chat, message, replyTo });
      return posted;
    },
    async forwardMessages(target, { messages: ids, fromPeer }) {
      utils.getPeerId(fromPeer);
      this.forwarded.push({ target, ids, fromPeer });
    },
    addEventHandler(handler, event) {
      handlers.push({ handler, kind: event && event.constructor ? event.constructor.name : 'NewMessage' });
    },
    removeEventHandler(handler) {
      const at = handlers.findIndex((entry) => entry.handler === handler);
      if (at >= 0) handlers.splice(at, 1);
    },
    dispatch(kind, { chatRef = '@one', id, text = '', groupId = null, from = 5, replyTo = null }) {
      const chat = entities.get(chatRef);
      const message = {
        id,
        date: Math.floor(Date.now() / 1000),
        message: text,
        senderId: from,
        replyTo: replyTo ? { replyToMsgId: replyTo } : null,
        groupedId: groupId,
        peerId: chat,
      };
      for (const entry of [...handlers]) {
        if (entry.kind === kind) entry.handler({ message, chatId: utils.getPeerId(chat) });
      }
    },
    emit(post) { this.dispatch('NewMessage', post); },
    emitEdit(post) { this.dispatch('EditedMessage', post); },
  };
}

module.exports = { createFakeClient };
