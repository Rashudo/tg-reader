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
  assert.deepStrictEqual(groupNames(keywords), ['Телевизоры', 'Телефоны', 'Саундбары', 'Колонки', 'Часы', 'Клавишные']);

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
    'Продам Huawei p30 pro идеальное состояние 128/6',
    'Продам Xiaomi 14 в хорошем состоянии, цена 350€',
    'Продам очень срочно Motorola edge 50 fusion 5g',
    'Redmi Note 12, полный комплект',
    'Продам смартфон, 128 гб, состояние отличное',
  ];
  for (const ad of ads) assert.notDeepStrictEqual(hits(ad), [], `не поймано: ${ad}`);
});

test('айфоны больше не отслеживаются', () => {
  assert.deepStrictEqual(hits('Продаю iPhone 13 Pro 128gb в идеальном состоянии'), []);
  assert.deepStrictEqual(hits('Куплю любой айфон в рабочем состоянии'), []);
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

test('саундбары ловятся во всех написаниях', () => {
  const ads = [
    'Продам soundbar Samsung, как новый',
    'Sound bar LG SN4, 2.1',
    'Sound-bar JBL, состояние отличное',
    'Саундбар Xiaomi, торг',
    'Саунд-бар с сабвуфером',
    'Продаю звуковую панель для телевизора',
    'Zvučni bar, kao nov',
    'Prodajem zvucni bar sa subwooferom',
  ];
  for (const ad of ads) assert.notDeepStrictEqual(hits(ad), [], `не поймано: ${ad}`);
});

test('наушники soundcore за саундбар не считаются', () => {
  assert.deepStrictEqual(hits('ANKER soundcore h30i состояние на фото, цена 1500 RSD'), []);
  const безКолонок = prepare(keywords, ['Колонки']);
  assert.deepStrictEqual(findMatches('Продам колонку JBL, звук отличный', безКолонок), []);
});

test('группу саундбаров можно снять целиком', () => {
  const безСаундбаров = prepare(keywords, ['Саундбары']);
  assert.deepStrictEqual(findMatches('Продам саундбар', безСаундбаров), []);
});

test('объявления о колонках ловятся', () => {
  const ads = [
    'Колонка бт, type c. Большая, тяжёлая. 2000 рсд',
    'Продам блютуз-колонку IKEA ENEBY 20 (Gen 2)',
    'JBL Bluetooth-колонка портативная, рабочая 2 500 RSD',
    'Продаю пару колонок Sven, б/у',
    'Prodajem zvučnike, kao novi',
    'Zvucnik bluetooth, malo koriscen',
    'Сабвуфер активный, 100 Вт',
    'Prodajem kolonku, bluetooth',
  ];
  for (const ad of ads) assert.notDeepStrictEqual(hits(ad), [], `не поймано: ${ad}`);
});

test('наушники и встроенные динамики за колонки не считаются', () => {
  assert.deepStrictEqual(hits('Продаю наушники JBL tune 500, проводные, 1000 RSD'), []);
  assert.deepStrictEqual(hits('Монитор Philips, 100 Hz, со встроенным звуком (динамиками)'), []);
  assert.deepStrictEqual(hits('Продаю Logitech G435 — беспроводные игровые наушники'), []);
});

test('группу колонок можно снять целиком', () => {
  const безКолонок = prepare(keywords, ['Колонки']);
  assert.deepStrictEqual(findMatches('Продам блютуз-колонку', безКолонок), []);
});

test('умные часы и браслеты ловятся', () => {
  const ads = [
    'Часы Huawei GT4, в отличном состоянии, зарядка, 3 ремешка. 60 eur',
    'Продам детские GPS часы Aimoto Start розовые',
    'Умные часы Amazfit GTS 4, коробка есть',
    'Смарт-часы женские, розовые',
    'Apple Watch SE 44mm, торг',
    'Продам фитнес-браслет Xiaomi Mi Band 8',
    'Фитнес браслет, шагомер, пульс',
    'Garmin Forerunner 245, б/у',
    'Prodajem pametni sat, kao nov',
    'Fitnes narukvica, malo koriscena',
    'Эпл вотч 9, 41 мм',
  ];
  for (const ad of ads) assert.notDeepStrictEqual(hits(ad), [], `не поймано: ${ad}`);
});

test('часы вне именительного падежа не ловятся', () => {
  assert.deepStrictEqual(hits('Наиграно примерно 50–100 часов максимум'), []);
  assert.deepStrictEqual(hits('Ремешок для часов, кожаный, новый'), []);
  assert.deepStrictEqual(hits('Заберу в течение часа'), []);
  assert.deepStrictEqual(hits('Часть комплекта потеряна'), []);
});

test('«часы отдыха» и «песочные часы» — известная плата за ключ «часы»', () => {
  assert.deepStrictEqual(hits('Любит быть рядом с человеком в часы отдыха'), ['часы']);
  assert.deepStrictEqual(hits('Комплектация: карточки, фишки, песочные часы'), ['часы']);
});

test('группу часов можно снять целиком', () => {
  const безЧасов = prepare(keywords, ['Часы']);
  assert.deepStrictEqual(findMatches('Умные часы Amazfit', безЧасов), []);
});
