const bigInt = require('big-integer');
const { Api } = require('telegram');

function documentsOf(result, field) {
  return (result && result[field]) || [];
}

function createMemeSender({ client, chat, catalogue = [], log = console.log }) {
  const docs = new Map();
  const known = new Set(catalogue.map((item) => item.id));

  return {
    async refresh() {
      if (known.size === 0) return 0;
      const found = new Map();
      try {
        const faved = await client.invoke(new Api.messages.GetFavedStickers({ hash: bigInt(0) }));
        const recent = await client.invoke(new Api.messages.GetRecentStickers({ hash: bigInt(0) }));
        const gifs = await client.invoke(new Api.messages.GetSavedGifs({ hash: bigInt(0) }));
        for (const doc of [
          ...documentsOf(faved, 'stickers'),
          ...documentsOf(recent, 'stickers'),
          ...documentsOf(gifs, 'gifs'),
        ]) {
          const id = String(doc.id);
          if (known.has(id)) found.set(id, doc);
        }
      } catch (err) {
        log(`Картинки: список обновить не удалось (${err.message}) — беру прежние ссылки`);
        return docs.size;
      }
      docs.clear();
      for (const [id, doc] of found) docs.set(id, doc);
      return docs.size;
    },

    available() {
      return catalogue.filter((item) => docs.has(item.id));
    },

    async send({ id, replyTo }) {
      const doc = docs.get(id);
      if (!doc) throw new Error(`картинки ${id} больше нет в избранном`);
      return client.sendFile(chat, { file: doc, ...(replyTo ? { replyTo } : {}) });
    },
  };
}

module.exports = { createMemeSender };
