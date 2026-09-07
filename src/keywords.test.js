const test = require('node:test');
const assert = require('node:assert');
const { prepare, findMatches, groupNames } = require('./matcher');
const keywords = require('../keywords');

const KEYWORDS = prepare(keywords);
const hits = (text) => findMatches(text, KEYWORDS);

test('объявления про клавишные ловятся во всех обычных формулировках', () => {
  const ads = [
    'Продам пианино, самовывоз',
    'Цифровое фортепиано, состояние отличное',
    'Фортепьяно старое, отдам даром',
    'Новый синтезатор - 4500 динар',
    'Продаю рояль',
    'Клавишный инструмент, 61 клавиша',
    'Prodajem klavir, malo koriscen',
    'Klavijatura Yamaha, kao nova',
    'Sintisajzer na prodaju',
  ];
  for (const ad of ads) assert.notDeepStrictEqual(hits(ad), [], `не поймано: ${ad}`);
});

test('телевизоры по-прежнему ловятся — старые ключи не сломаны', () => {
  assert.deepStrictEqual(hits('Продам телевизор LG'), ['телевизор', 'lg']);
  assert.deepStrictEqual(hits('Smart TV 43 дюйма'), ['tv']);
});

test('компьютерная клавиатура за клавишные не считается', () => {
  assert.deepStrictEqual(hits('Механическая клавиатура, все клавиши работают'), []);
  assert.deepStrictEqual(hits('Беспроводная мышь и клавиатура'), []);
});

test('слова разложены по группам, которые можно снять целиком', () => {
  assert.deepStrictEqual(groupNames(keywords), ['Телевизоры', 'Телефоны', 'Клавишные']);

  const безКлавишных = prepare(keywords, ['Клавишные']);
  assert.deepStrictEqual(findMatches('Продам синтезатор', безКлавишных), []);
  assert.notDeepStrictEqual(findMatches('Продам телевизор', безКлавишных), []);

  const безТелевизоров = prepare(keywords, ['Телевизоры']);
  assert.deepStrictEqual(findMatches('Продам телевизор', безТелевизоров), []);
  assert.notDeepStrictEqual(findMatches('Продам синтезатор', безТелевизоров), []);

  const безТелефонов = prepare(keywords, ['Телефоны']);
  assert.deepStrictEqual(findMatches('Продам iPhone 13', безТелефонов), []);
  assert.notDeepStrictEqual(findMatches('Продам синтезатор', безТелефонов), []);
});

test('ложные срабатывания, проверенные на 2000 постов, не вернулись', () => {
  assert.deepStrictEqual(hits('ubistvo u Novom Sadu'), []);
  assert.deepStrictEqual(hits('XBox Series X'), []);
  assert.deepStrictEqual(hits('Твердая обложка'), []);
});

test('объявления о телефонах ловятся по марке', () => {
  const ads = [
    'Продам телефон Poco x3 pro 128gb',
    'Продам Samsung Galaxy S21 Ultra, экран разбит',
    'Продаю iPhone 13 Pro 128gb в идеальном состоянии',
    'Продам Huawei p30 pro идеальное состояние 128/6',
    'Продам Xiaomi 14 в хорошем состоянии, цена 350€',
    'Продам очень срочно Motorola edge 50 fusion 5g',
    'Айфон 14 Pro Max, ёмкость аккумулятора 80%',
    'Redmi Note 12, полный комплект',
    'Продам смартфон, 128 гб, состояние отличное',
  ];
  for (const ad of ads) assert.notDeepStrictEqual(hits(ad), [], `не поймано: ${ad}`);
});

test('слово «телефон» само по себе объявлением о продаже не считается', () => {
  const noise = [
    'Валерия, добро пожаловать в группу. Правила: указывайте цену, район и телефон для связи',
    'Продам очки с камерами Rayban Meta, управляются с телефона',
    'Набор для настольного тенниса, штатив для телефона, гантели',
  ];
  for (const text of noise) assert.deepStrictEqual(hits(text), [], `ложное срабатывание: ${text}`);
});

test('сербский гонорар за марку Honor не принимается', () => {
  assert.deepStrictEqual(hits('Trazim posao, honorar po dogovoru'), []);
});
