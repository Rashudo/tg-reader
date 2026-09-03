const test = require('node:test');
const assert = require('node:assert');
const { normalize, prepare, findMatches } = require('./matcher');

const find = (text, keywords) => findMatches(text, prepare(keywords));

test('подстрока ловит падежи и множественное число', () => {
  assert.deepStrictEqual(find('Продам телевизор', ['телевизор']), ['телевизор']);
  assert.deepStrictEqual(find('Ремонт телевизоров', ['телевизор']), ['телевизор']);
  assert.deepStrictEqual(find('ТЕЛЕВИЗОРЫ ОПТОМ', ['телевизор']), ['телевизор']);
});

test('отдельное слово не цепляется к соседним буквам', () => {
  const kw = [{ word: 'тв' }];
  assert.deepStrictEqual(find('ТВ-приставка', kw), ['тв']);
  assert.deepStrictEqual(find('Смарт ТВ', kw), ['тв']);
  assert.deepStrictEqual(find('Твердая обложка', kw), []);
  assert.deepStrictEqual(find('ответ', kw), []);
  assert.deepStrictEqual(find('творог', kw), []);
});

test('ложные срабатывания из прогона на 2000 постов не вернулись', () => {
  const kw = [{ word: 'tv' }, { word: 'box' }];
  assert.deepStrictEqual(find('ubistvo u Novom Sadu', kw), []);
  assert.deepStrictEqual(find('XBox Series X', kw), []);
  assert.deepStrictEqual(find('Timebox-evo', kw), []);
  assert.deepStrictEqual(find('Smart TV 43"', kw), ['tv']);
  assert.deepStrictEqual(find('TV box новый', kw), ['tv', 'box']);
});

test('цифра тоже граница слова: 43tv не совпадение', () => {
  assert.deepStrictEqual(find('43tv', [{ word: 'tv' }]), []);
  assert.deepStrictEqual(find('tv43', [{ word: 'tv' }]), []);
});

test('ё приравнена к е, регистр не учитывается', () => {
  assert.strictEqual(normalize('ЁЛКА'), 'елка');
  assert.deepStrictEqual(find('Приёмник', ['приемник']), ['приемник']);
});

test('спецсимволы в ключе не ломают регулярку', () => {
  assert.deepStrictEqual(find('продам c++ книгу', [{ word: 'c++' }]), ['c++']);
  assert.deepStrictEqual(find('цена 100$', [{ word: '100$' }]), ['100$']);
});

test('мусор в keywords.js пропускается, а не роняет процесс', () => {
  const prepared = prepare(['', null, 42, { word: '  ' }, 'телевизор']);
  assert.strictEqual(prepared.length, 1);
  assert.deepStrictEqual(findMatches('телевизор', prepared), ['телевизор']);
});

test('пустой текст не даёт совпадений', () => {
  assert.deepStrictEqual(find('', ['телевизор']), []);
  assert.deepStrictEqual(findMatches(undefined, prepare([{ word: 'тв' }])), []);
});
