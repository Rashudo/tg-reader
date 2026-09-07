const test = require('node:test');
const assert = require('node:assert');
const { createMemeSender } = require('./meme-sender');

const CATALOGUE = [
  { id: '1', kind: 'gif', emoji: '', note: 'первая' },
  { id: '2', kind: 'sticker', emoji: '😂', note: 'вторая' },
];

function rig(over = {}) {
  const sent = [];
  const client = {
    invoke: async (request) => {
      const name = request.className || '';
      if (name.includes('GetSavedGifs')) return { gifs: [{ id: '1' }] };
      if (name.includes('GetFavedStickers')) return { stickers: [{ id: '2' }] };
      return { stickers: [] };
    },
    sendFile: async (chat, params) => {
      sent.push({ chat, params });
      return { id: 555 };
    },
    ...over.client,
  };
  return { sender: createMemeSender({ client, chat: 'чат', catalogue: CATALOGUE, log: () => {} }), sent };
}

test('до обновления ссылок картинок нет', () => {
  const { sender } = rig();
  assert.deepStrictEqual(sender.available(), []);
});

test('обновление находит картинки каталога', async () => {
  const { sender } = rig();
  assert.strictEqual(await sender.refresh(), 2);
  assert.deepStrictEqual(sender.available().map((item) => item.id), ['1', '2']);
});

test('пропавшая из избранного картинка предлагаться перестаёт', async () => {
  const { sender } = rig({ client: { invoke: async () => ({ gifs: [{ id: '1' }], stickers: [] }) } });
  await sender.refresh();
  assert.deepStrictEqual(sender.available().map((item) => item.id), ['1']);
});

test('сорванное обновление прежние ссылки не роняет', async () => {
  let calls = 0;
  const { sender } = rig({
    client: {
      invoke: async (request) => {
        calls += 1;
        if (calls > 3) throw new Error('связь потеряна');
        const name = request.className || '';
        if (name.includes('GetSavedGifs')) return { gifs: [{ id: '1' }] };
        return { stickers: [] };
      },
    },
  });
  await sender.refresh();
  assert.strictEqual(await sender.refresh(), 1);
  assert.strictEqual(sender.available().length, 1);
});

test('отправка идёт файлом с привязкой к сообщению', async () => {
  const { sender, sent } = rig();
  await sender.refresh();
  const posted = await sender.send({ id: '2', replyTo: 42 });
  assert.strictEqual(posted.id, 555);
  assert.strictEqual(sent[0].params.replyTo, 42);
  assert.ok(sent[0].params.file);
});

test('отправка исчезнувшей картинки — ошибка, а не тишина', async () => {
  const { sender } = rig();
  await sender.refresh();
  await assert.rejects(() => sender.send({ id: '9' }), /больше нет/);
});
