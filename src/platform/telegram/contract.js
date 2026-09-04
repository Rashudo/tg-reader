const assert = require('node:assert');

function gatewayContract(make) {
  return [
    {
      name: 'resolveChat отдаёт доменный Chat без объектов библиотеки',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        assert.deepStrictEqual(Object.keys(chat).sort(), ['id', 'key', 'title', 'username']);
        assert.strictEqual(typeof chat.key, 'string');
      },
    },
    {
      name: 'recent отдаёт Post по возрастанию id',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const posts = await gateway.recent(chat, { limit: 10 });
        assert.ok(posts.length >= 2);
        const ids = posts.map((post) => post.id);
        assert.deepStrictEqual(ids, [...ids].sort((a, b) => a - b));
      },
    },
    {
      name: 'Post несёт ровно оговорённые поля',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const [post] = await gateway.recent(chat, { limit: 1 });
        assert.deepStrictEqual(
          Object.keys(post).sort(),
          ['at', 'author', 'chatKey', 'from', 'groupId', 'id', 'link', 'replyTo', 'text']
        );
        assert.strictEqual(typeof post.at, 'number');
        assert.strictEqual(post.chatKey, chat.key);
      },
    },
    {
      name: 'afterId отсекает уже виденное',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const all = await gateway.recent(chat, { limit: 10 });
        const after = await gateway.recent(chat, { limit: 10, afterId: all[0].id });
        assert.ok(after.length > 0);
        assert.ok(after.every((post) => post.id > all[0].id));
      },
    },
    {
      name: 'альбом приходит в onPost одной пачкой, а одиночка — своей',
      async run() {
        const { gateway, emit, clock } = await make();
        const batches = [];
        gateway.onPost((posts) => batches.push(posts));
        emit({ chatRef: '@one', id: 101, text: 'раз', groupId: 'g1' });
        emit({ chatRef: '@one', id: 102, text: 'два', groupId: 'g1' });
        emit({ chatRef: '@one', id: 103, text: 'сам по себе' });
        clock.advance(1000);
        assert.strictEqual(batches.length, 2);
        const album = batches.find((batch) => batch.length === 2);
        assert.deepStrictEqual(album.map((post) => post.id), [101, 102]);
        assert.strictEqual(batches.find((batch) => batch.length === 1)[0].id, 103);
      },
    },
    {
      name: 'правка поста тоже доходит до onPost',
      async run() {
        const { gateway, emitEdit, clock } = await make();
        const seen = [];
        gateway.onPost((posts) => seen.push(...posts));
        emitEdit({ chatRef: '@one', id: 300, text: 'поправленное' });
        clock.advance(1000);
        assert.deepStrictEqual(seen.map((post) => post.text), ['поправленное']);
      },
    },
    {
      name: 'отписка перестаёт доставлять',
      async run() {
        const { gateway, emit, clock } = await make();
        const seen = [];
        const off = gateway.onPost((posts) => seen.push(...posts));
        off();
        emit({ chatRef: '@one', id: 200, text: 'молчок' });
        clock.advance(1000);
        assert.deepStrictEqual(seen, []);
      },
    },
    {
      name: 'sendText возвращает отправленное как Post',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const post = await gateway.sendText(chat, 'привет', { replyTo: 7 });
        assert.strictEqual(post.text, 'привет');
        assert.strictEqual(post.replyTo, 7);
        assert.strictEqual(typeof post.id, 'number');
      },
    },
    {
      name: 'sendText режет текст по лимиту Telegram',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const post = await gateway.sendText(chat, 'я'.repeat(5000));
        assert.ok(post.text.length <= 4096);
      },
    },
    {
      name: 'me отдаёт доменного пользователя',
      async run() {
        const { gateway } = await make();
        const me = await gateway.me();
        assert.deepStrictEqual(Object.keys(me).sort(), ['id', 'name', 'username']);
        assert.strictEqual(typeof me.id, 'string');
      },
    },
    {
      name: 'members отдаёт карту id — имя',
      async run() {
        const { gateway } = await make();
        const chat = await gateway.resolveChat('@one');
        const names = await gateway.members(chat);
        assert.ok(names instanceof Map);
        assert.ok(names.size > 0);
      },
    },
    {
      name: 'недоступные участники не роняют шлюз',
      async run() {
        const { gateway } = await make({ membersFail: true });
        const chat = await gateway.resolveChat('@one');
        const names = await gateway.members(chat);
        assert.strictEqual(names.size, 0);
      },
    },
  ];
}

module.exports = { gatewayContract };
