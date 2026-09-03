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

const { groupNames, findHits, describeHits } = require('./matcher');

const GROUPS = [
  { group: 'Телевизоры', words: ['телевизор', { word: 'lg' }] },
  { group: 'Клавишные', words: ['пианино', { word: 'casio' }] },
];

test('со списком групп ловятся слова всех групп', () => {
  const prepared = prepare(GROUPS);
  assert.deepStrictEqual(findMatches('продам телевизор', prepared), ['телевизор']);
  assert.deepStrictEqual(findMatches('продам пианино', prepared), ['пианино']);
});

test('выключенная группа не ловит ничего, остальные работают', () => {
  const prepared = prepare(GROUPS, ['Клавишные']);
  assert.deepStrictEqual(findMatches('продам пианино casio', prepared), []);
  assert.deepStrictEqual(findMatches('продам телевизор', prepared), ['телевизор']);
});

test('имя выключаемой группы сравнивается без учёта регистра и пробелов', () => {
  for (const name of ['клавишные', '  КЛАВИШНЫЕ  ']) {
    assert.deepStrictEqual(findMatches('пианино', prepare(GROUPS, [name])), [], name);
  }
});

test('старый плоский список работает как раньше', () => {
  const prepared = prepare(['телевизор', { word: 'lg' }]);
  assert.deepStrictEqual(findMatches('продам телевизор', prepared), ['телевизор']);
  assert.deepStrictEqual(groupNames(['телевизор']), []);
});

test('имена групп доступны отдельно — по ним проверяются опечатки в настройке', () => {
  assert.deepStrictEqual(groupNames(GROUPS), ['Телевизоры', 'Клавишные']);
});

test('совпадение знает свою группу', () => {
  const [hit] = findHits('продам пианино', prepare(GROUPS));
  assert.strictEqual(hit.raw, 'пианино');
  assert.strictEqual(hit.group, 'Клавишные');
});

test('совпадения из одной группы перечисляются под одним именем', () => {
  const hits = findHits('телевизор lg', prepare(GROUPS));
  assert.strictEqual(describeHits(hits), 'Телевизоры: телевизор, lg');
});

test('совпадения из разных групп разделяются точкой с запятой', () => {
  const hits = findHits('телевизор и пианино', prepare(GROUPS));
  assert.strictEqual(describeHits(hits), 'Телевизоры: телевизор; Клавишные: пианино');
});

test('без групп описание — просто перечисление слов', () => {
  const hits = findHits('телевизор', prepare(['телевизор']));
  assert.strictEqual(describeHits(hits), 'телевизор');
});

test('пустая группа и группа без слов не роняют разбор', () => {
  const prepared = prepare([{ group: 'Пустая', words: [] }, { group: 'Кривая' }, ...GROUPS]);
  assert.deepStrictEqual(findMatches('телевизор', prepared), ['телевизор']);
});

const { unknownGroups } = require('./matcher');

test('опечатка в имени выключаемой группы находится', () => {
  assert.deepStrictEqual(unknownGroups(['Клавишнык'], GROUPS), ['Клавишнык']);
});

test('правильные имена опечаткой не считаются, регистр не важен', () => {
  assert.deepStrictEqual(unknownGroups(['клавишные', ' Телевизоры'], GROUPS), []);
});

const { summary } = require('./matcher');

test('сводка показывает, сколько групп работает и какие выключены', () => {
  assert.strictEqual(
    summary(GROUPS, prepare(GROUPS)),
    'Ключевых слов: 4 в 2 из 2 групп, выключено: нет'
  );
  assert.strictEqual(
    summary(GROUPS, prepare(GROUPS, ['Клавишные'])),
    'Ключевых слов: 2 в 1 из 2 групп, выключено: Клавишные'
  );
});

test('для плоского списка сводка без групп', () => {
  const flat = ['телевизор', { word: 'lg' }];
  assert.strictEqual(summary(flat, prepare(flat)), 'Ключевых слов: 2');
});
