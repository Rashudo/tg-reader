const test = require('node:test');
const assert = require('node:assert');
const { normalizeCatalogue, catalogueBlock, pickMeme, freshMemes, sampleMemes, titleOf } = require('./memes');

const HOUR = 60 * 60 * 1000;

test('каталог читается из обоих форматов файла', () => {
  const one = normalizeCatalogue([{ id: 'a', kind: 'sticker', emoji: '😂', note: 'кот падает' }]);
  const two = normalizeCatalogue({ items: [{ id: 'a', kind: 'sticker', emoji: '😂', note: 'кот падает' }] });
  assert.deepStrictEqual(one, two);
});

test('запись без описания в каталог не берётся', () => {
  assert.deepStrictEqual(normalizeCatalogue([{ id: 'a', note: '  ' }, { id: '', note: 'что-то' }]), []);
});

test('повторный id в каталоге не задваивается', () => {
  const items = normalizeCatalogue([
    { id: 'a', note: 'первое' },
    { id: 'a', note: 'второе' },
  ]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].note, 'первое');
});

test('незнакомый вид считается стикером', () => {
  assert.strictEqual(normalizeCatalogue([{ id: 'a', kind: 'что-то', note: 'x' }])[0].kind, 'sticker');
});

test('гифка и стикер называются по-разному', () => {
  assert.strictEqual(titleOf({ kind: 'gif', emoji: '' }), 'гифка');
  assert.strictEqual(titleOf({ kind: 'sticker', emoji: '😂' }), 'стикер 😂');
  assert.strictEqual(titleOf({ kind: 'sticker', emoji: '' }), 'стикер');
});

test('пустой каталог блока в промпте не занимает', () => {
  assert.strictEqual(catalogueBlock([]), '');
});

test('каталог в промпте перечисляет id и описания', () => {
  const block = catalogueBlock([{ id: 'm1', kind: 'gif', emoji: '', note: 'мужик закатывает глаза' }]);
  assert.match(block, /m1: гифка — мужик закатывает глаза/);
  assert.match(block, /редкий ход/);
});

test('выбор по id находит картинку и отбрасывает выдуманную', () => {
  const items = [{ id: 'm1', kind: 'gif', emoji: '', note: 'x' }];
  assert.strictEqual(pickMeme(items, 'm1').id, 'm1');
  assert.strictEqual(pickMeme(items, 'm9'), null);
  assert.strictEqual(pickMeme(items, null), null);
});

test('недавно отправленная картинка из каталога выпадает', () => {
  const items = [{ id: 'm1' }, { id: 'm2' }];
  const now = 100 * HOUR;
  const used = [{ id: 'm1', at: now - 2 * HOUR }];
  const fresh = freshMemes(items, used, { now, cooldownMs: 72 * HOUR });
  assert.deepStrictEqual(fresh.map((item) => item.id), ['m2']);
});

test('отлежавшаяся картинка возвращается в каталог', () => {
  const now = 100 * HOUR;
  const used = [{ id: 'm1', at: now - 80 * HOUR }];
  const fresh = freshMemes([{ id: 'm1' }], used, { now, cooldownMs: 72 * HOUR });
  assert.strictEqual(fresh.length, 1);
});

test('в промпт едет столько картинок, сколько разрешили', () => {
  const items = Array.from({ length: 10 }, (unused, i) => ({ id: `m${i}` }));
  const picked = sampleMemes(items, 3, () => 0.5);
  assert.strictEqual(picked.length, 3);
  assert.strictEqual(new Set(picked.map((item) => item.id)).size, 3);
  for (const item of picked) assert.ok(items.includes(item));
});

test('короткий каталог едет целиком', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  assert.deepStrictEqual(sampleMemes(items, 5, () => 0), items);
});

test('выборка каждый раз разная', () => {
  const items = Array.from({ length: 10 }, (unused, i) => ({ id: `m${i}` }));
  let seed = 0;
  const random = () => {
    seed += 0.37;
    return seed % 1;
  };
  const first = sampleMemes(items, 3, random).map((item) => item.id);
  const second = sampleMemes(items, 3, random).map((item) => item.id);
  assert.notDeepStrictEqual(first, second);
});
