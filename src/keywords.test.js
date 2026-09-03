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
  assert.deepStrictEqual(groupNames(keywords), ['Телевизоры', 'Клавишные']);

  const безКлавишных = prepare(keywords, ['Клавишные']);
  assert.deepStrictEqual(findMatches('Продам синтезатор', безКлавишных), []);
  assert.notDeepStrictEqual(findMatches('Продам телевизор', безКлавишных), []);

  const безТелевизоров = prepare(keywords, ['Телевизоры']);
  assert.deepStrictEqual(findMatches('Продам телевизор', безТелевизоров), []);
  assert.notDeepStrictEqual(findMatches('Продам синтезатор', безТелевизоров), []);
});

test('ложные срабатывания, проверенные на 2000 постов, не вернулись', () => {
  assert.deepStrictEqual(hits('ubistvo u Novom Sadu'), []);
  assert.deepStrictEqual(hits('XBox Series X'), []);
  assert.deepStrictEqual(hits('Твердая обложка'), []);
});
