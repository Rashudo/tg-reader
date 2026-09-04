const { cut, messageLink, TELEGRAM_LIMIT } = require('./text');

function createFakeGateway({ clock, membersFail = false, albumWindowMs = 800 } = {}) {
  const chats = new Map([['@one', { key: '-100111', title: 'Первый', username: 'one', id: 111 }]]);
  const posts = new Map();
  const handlers = new Set();
  const albums = new Map();
  const names = new Map([['5', 'Аня'], ['6', 'boris']]);
  let nextId = 500;
  let connected = false;

  const make = (chat, { id, text = '', from = '5', replyTo = null, groupId = null, at = 1700000000000 }) => ({
    id,
    chatKey: chat.key,
    at,
    text,
    from,
    author: names.get(from) || null,
    replyTo,
    groupId,
    link: messageLink(chat, id),
  });

  const first = chats.get('@one');
  posts.set(first.key, [
    make(first, { id: 1, text: 'первое', from: '5' }),
    make(first, { id: 2, text: 'второе', from: '6', replyTo: 1, at: 1700000060000 }),
    make(first, { id: 3, text: 'третье', from: '5', at: 1700000120000 }),
  ]);

  function deliver(batch) {
    for (const handler of [...handlers]) handler(batch);
  }

  const gateway = {
    forwarded: [],
    sent: [],
    get connected() { return connected; },
    async connect() { connected = true; },
    async disconnect() { connected = false; },
    async authorized() { return true; },
    async me() { return { id: '999', name: 'Хозяин', username: 'owner' }; },
    async resolveChat(ref) {
      if (ref && typeof ref === 'object' && ref.key) return ref;
      const chat = chats.get(ref);
      if (!chat) throw new Error(`нет такого чата: ${ref}`);
      return chat;
    },
    async members() {
      return membersFail ? new Map() : new Map(names);
    },
    async recent(chat, { limit = 50, afterId, fromMe = false } = {}) {
      const resolved = await gateway.resolveChat(chat);
      return (posts.get(resolved.key) || [])
        .filter((post) => (afterId === undefined || afterId === null ? true : post.id > afterId))
        .filter((post) => (fromMe ? post.from === '999' : true))
        .slice()
        .sort((a, b) => a.id - b.id)
        .slice(-limit);
    },
    async forward(targetRef, chat, ids) {
      const resolved = await gateway.resolveChat(chat);
      gateway.forwarded.push({ targetRef, chatKey: resolved.key, ids: [...ids].sort((a, b) => a - b) });
    },
    async sendText(ref, text, { replyTo } = {}) {
      const chat = await gateway.resolveChat(ref);
      nextId += 1;
      const post = make(chat, { id: nextId, text: cut(text, TELEGRAM_LIMIT), from: '999', replyTo: replyTo || null });
      gateway.sent.push(post);
      return post;
    },
    onPost(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    seed(chatKey, list) {
      posts.set(chatKey, list);
    },
    addChat(ref, chat) {
      chats.set(ref, chat);
      if (!posts.has(chat.key)) posts.set(chat.key, []);
    },
    emit({ chatRef = '@one', id, text = '', groupId = null, from = '5', replyTo = null, at = 1700000200000 }) {
      const chat = chats.get(chatRef);
      const post = make(chat, { id, text, from, replyTo, groupId, at });
      const known = posts.get(chat.key) || [];
      if (!known.some((seen) => seen.id === post.id)) known.push(post);
      posts.set(chat.key, known);
      if (!groupId) {
        deliver([post]);
        return;
      }
      const key = `${chat.key}:g${groupId}`;
      let entry = albums.get(key);
      if (!entry) {
        entry = { posts: [], cancel: null };
        albums.set(key, entry);
      }
      entry.posts.push(post);
      if (entry.cancel) entry.cancel();
      entry.cancel = clock.after(albumWindowMs, () => {
        albums.delete(key);
        deliver(entry.posts.slice().sort((a, b) => a.id - b.id));
      });
    },
    emitEdit(post) {
      gateway.emit(post);
    },
  };

  return gateway;
}

module.exports = { createFakeGateway };
