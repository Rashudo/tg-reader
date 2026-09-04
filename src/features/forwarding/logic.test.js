const test = require('node:test');
const assert = require('node:assert');
const { prepare } = require('./matcher');
const { decide } = require('./logic');

const keywords = prepare(['телевизор', 'велосипед']);
const post = (id, text, at = 1000) => ({
  id, chatKey: 'c1', at, text, from: '5', author: null, replyTo: null, groupId: null, link: `l${id}`,
});
const nothingSent = () => false;

test('без совпадений курсор двигается, слать нечего', () => {
  const answer = decide({ posts: [post(10, 'просто болтовня')], keywords, lastId: 5, isSent: nothingSent });
  assert.strictEqual(answer.what, null);
  assert.deepStrictEqual(answer.ids, []);
  assert.strictEqual(answer.newestId, 10);
});

test('совпадение даёт список на отправку и описание', () => {
  const answer = decide({ posts: [post(10, 'продам телевизор')], keywords, lastId: 5, isSent: nothingSent });
  assert.match(answer.what, /телевизор/);
  assert.deepStrictEqual(answer.ids, [10]);
});

test('альбом идёт одной пачкой, решение принимается по склеенному тексту', () => {
  const posts = [post(10, 'продам'), post(11, 'велосипед детский')];
  const answer = decide({ posts, keywords, lastId: 5, isSent: nothingSent });
  assert.match(answer.what, /велосипед/);
  assert.deepStrictEqual(answer.ids, [10, 11]);
  assert.strictEqual(answer.newestId, 11);
});

test('уже отправленное не отправляется снова — правка поста не даёт дубль', () => {
  const posts = [post(10, 'продам телевизор')];
  const answer = decide({ posts, keywords, lastId: 5, isSent: (id) => id === 10 });
  assert.deepStrictEqual(answer.ids, []);
  assert.match(answer.what, /телевизор/, 'совпадение есть, просто слать нечего');
});

test('свежими считаются только те, что новее курсора', () => {
  const posts = [post(4, 'а'), post(5, 'б'), post(6, 'в')];
  assert.strictEqual(decide({ posts, keywords, lastId: 5, isSent: nothingSent }).fresh, 1);
});

test('на первом запуске свежими считаются все', () => {
  const posts = [post(4, 'а'), post(5, 'б')];
  assert.strictEqual(decide({ posts, keywords, lastId: null, isSent: nothingSent }).fresh, 2);
});

test('ids всегда по возрастанию, как бы ни пришла пачка', () => {
  const posts = [post(11, 'велосипед'), post(10, 'продам')];
  assert.deepStrictEqual(decide({ posts, keywords, lastId: null, isSent: nothingSent }).ids, [10, 11]);
});

test('пустые тексты не мешают склейке', () => {
  const posts = [post(10, ''), post(11, 'телевизор')];
  assert.strictEqual(decide({ posts, keywords, lastId: null, isSent: nothingSent }).text, 'телевизор');
});

test('время последнего поста в пачке — самое позднее', () => {
  const posts = [post(10, 'а', 1000), post(11, 'б', 3000)];
  assert.strictEqual(decide({ posts, keywords, lastId: null, isSent: nothingSent }).at, 3000);
});
