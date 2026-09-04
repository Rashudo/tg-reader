const { utils } = require('telegram');
const { NewMessage } = require('telegram/events');
const { EditedMessage } = require('telegram/events/EditedMessage');
const { cut, messageLink, TELEGRAM_LIMIT } = require('./text');

const ALBUM_WINDOW_MS = 800;

function keyOf(peer) {
  if (peer === null || peer === undefined) return null;
  try {
    return utils.getPeerId(peer).toString();
  } catch (err) {
    return null;
  }
}

function eventKeyOf(event, message) {
  return keyOf(event && event.chatId !== undefined ? event.chatId : message && message.peerId);
}

function chatOf(entity) {
  return {
    key: keyOf(entity),
    title: entity.title || entity.firstName || null,
    username: entity.username || null,
    id: entity.id === undefined ? null : Number(entity.id),
  };
}

function subscribeMessages(client, handler, { edits = false } = {}) {
  client.addEventHandler(handler, new NewMessage({}));
  if (edits) client.addEventHandler(handler, new EditedMessage({}));
  return () => client.removeEventHandler(handler);
}

function createGateway({ client, clock, log = () => {}, albumWindowMs = ALBUM_WINDOW_MS }) {
  const byRef = new Map();
  const byKey = new Map();
  const rawByKey = new Map();
  const names = new Map();
  const handlers = new Set();
  const albums = new Map();

  function postOf(message, chat) {
    const from = message.senderId === null || message.senderId === undefined ? null : String(message.senderId);
    return {
      id: message.id,
      chatKey: chat.key,
      at: message.date * 1000,
      text: message.message || '',
      from,
      author: (from && names.get(from)) || null,
      replyTo: message.replyTo ? message.replyTo.replyToMsgId : null,
      groupId: message.groupedId === null || message.groupedId === undefined ? null : String(message.groupedId),
      link: messageLink(chat, message.id),
    };
  }

  function deliver(posts) {
    for (const handler of [...handlers]) {
      try {
        handler(posts);
      } catch (err) {
        log(`Обработчик сообщения споткнулся: ${err.message}`);
      }
    }
  }

  function queue(post) {
    const key = `${post.chatKey}:g${post.groupId}`;
    let entry = albums.get(key);
    if (!entry) {
      entry = { posts: [], cancel: null };
      albums.set(key, entry);
    }
    entry.posts.push(post);
    if (entry.cancel) entry.cancel();
    entry.cancel = clock.after(albumWindowMs, () => {
      albums.delete(key);
      deliver(entry.posts.sort((a, b) => a.id - b.id));
    });
  }

  function onEvent(event) {
    const message = event.message;
    if (!message) return;
    const chat = byKey.get(eventKeyOf(event, message));
    if (!chat) return;
    const post = postOf(message, chat);
    if (post.groupId) queue(post);
    else deliver([post]);
  }

  async function resolveChat(ref) {
    if (ref && typeof ref === 'object' && ref.key) return ref;
    if (byRef.has(ref)) return byRef.get(ref);
    const entity = await client.getEntity(ref);
    const chat = chatOf(entity);
    byRef.set(ref, chat);
    byKey.set(chat.key, chat);
    rawByKey.set(chat.key, entity);
    return chat;
  }

  async function entityOf(ref) {
    const chat = await resolveChat(ref);
    const raw = rawByKey.get(chat.key);
    if (!raw) throw new Error(`чат ${chat.key} не разрешён через resolveChat`);
    return raw;
  }

  return {
    get connected() {
      return Boolean(client.connected);
    },
    async connect() {
      await client.connect();
    },
    async disconnect() {
      await client.disconnect();
    },
    async authorized() {
      return Boolean(await client.isUserAuthorized());
    },
    async me() {
      const raw = await client.getMe();
      return {
        id: String(raw.id),
        name: raw.firstName || raw.username || String(raw.id),
        username: raw.username || null,
      };
    },
    resolveChat,
    async members(chat) {
      const found = new Map();
      try {
        for (const person of await client.getParticipants(await entityOf(chat))) {
          const id = String(person.id);
          const name = person.firstName || person.username || id;
          found.set(id, name);
          names.set(id, name);
        }
      } catch (err) {
        log(`Имена участников чата не прочитались (${err.message}) — обойдусь без них`);
      }
      return found;
    },
    async recent(chat, { limit = 50, afterId, fromMe = false } = {}) {
      const resolved = await resolveChat(chat);
      const fetched = await client.getMessages(await entityOf(resolved), {
        limit,
        ...(afterId === undefined || afterId === null ? {} : { minId: afterId }),
        ...(fromMe ? { fromUser: 'me' } : {}),
      });
      return [...fetched].map((message) => postOf(message, resolved)).sort((a, b) => a.id - b.id);
    },
    async forward(targetRef, chat, ids) {
      const from = await entityOf(chat);
      await client.forwardMessages(targetRef, { messages: [...ids].sort((a, b) => a - b), fromPeer: from });
    },
    async sendText(ref, text, { replyTo } = {}) {
      const chat = await resolveChat(ref);
      const posted = await client.sendMessage(await entityOf(chat), {
        message: cut(text, TELEGRAM_LIMIT),
        ...(replyTo ? { replyTo } : {}),
        parseMode: false,
      });
      return postOf(posted, chat);
    },
    onPost(handler) {
      if (handlers.size === 0) subscribeMessages(client, onEvent, { edits: true });
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

module.exports = { createGateway, keyOf, eventKeyOf };
