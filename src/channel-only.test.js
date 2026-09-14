const test = require('node:test');
const assert = require('node:assert');
const { parseChannelOnly, normalizeRef, keywordsForRef, unknownOnlyGroups, strayOnlyRefs } = require('./channel-only');
const { prepare } = require('./matcher');

const KEYWORDS = [
  { group: 'Телефоны', words: ['samsung'] },
  { group: 'Электросамокаты', words: ['электросамокат', 'ninebot'] },
  { group: 'Колонки', words: ['колонк'] },
];

test('ссылка на канал сводится к одному виду', () => {
  assert.strictEqual(normalizeRef('@NoviSadBaraholka'), 'novisadbaraholka');
  assert.strictEqual(normalizeRef('https://t.me/novisadbaraholka'), 'novisadbaraholka');
  assert.strictEqual(normalizeRef('t.me/novisadbaraholka/'), 'novisadbaraholka');
  assert.strictEqual(normalizeRef(' -1001993521190 '), '-1001993521190');
});

test('пустая настройка ничего не ограничивает', () => {
  assert.strictEqual(parseChannelOnly('').size, 0);
  assert.strictEqual(parseChannelOnly(undefined).size, 0);
});

test('одна группа для одного канала', () => {
  const only = parseChannelOnly('@novisadbaraholka=Электросамокаты');
  assert.deepStrictEqual(only.get('novisadbaraholka'), ['Электросамокаты']);
});

test('несколько каналов и несколько групп', () => {
  const only = parseChannelOnly('@a = Колонки, Часы ; https://t.me/b=Электросамокаты');
  assert.deepStrictEqual(only.get('a'), ['Колонки', 'Часы']);
  assert.deepStrictEqual(only.get('b'), ['Электросамокаты']);
});

test('запись без групп отбрасывается', () => {
  assert.strictEqual(parseChannelOnly('@a=;@b').size, 0);
});

test('канал без ограничения получает все включённые группы', () => {
  const all = prepare(KEYWORDS, ['Колонки']);
  const words = keywordsForRef('@NSbaraholka', { keywords: KEYWORDS, disabled: ['Колонки'], only: parseChannelOnly('@b=Электросамокаты') });
  assert.deepStrictEqual(words.map((w) => w.raw), all.map((w) => w.raw));
});

test('канал с ограничением получает только свои группы', () => {
  const only = parseChannelOnly('@novisadbaraholka=электросамокаты');
  const words = keywordsForRef('https://t.me/NoviSadBaraholka', { keywords: KEYWORDS, disabled: [], only });
  assert.deepStrictEqual(words.map((w) => w.raw), ['электросамокат', 'ninebot']);
});

test('выключенная группа остаётся выключенной и там, где её разрешили', () => {
  const only = parseChannelOnly('@b=Электросамокаты,Колонки');
  const words = keywordsForRef('@b', { keywords: KEYWORDS, disabled: ['Колонки'], only });
  assert.deepStrictEqual(words.map((w) => w.raw), ['электросамокат', 'ninebot']);
});

test('опечатка в имени группы видна', () => {
  const only = parseChannelOnly('@b=Электросамокаты,Самокаты');
  assert.deepStrictEqual(unknownOnlyGroups(only, KEYWORDS), ['Самокаты']);
});

test('ограничение для канала, которого нет в CHANNEL, видно', () => {
  const only = parseChannelOnly('@novisadbaraholka=Электросамокаты;@typo=Колонки');
  assert.deepStrictEqual(strayOnlyRefs(only, ['@NSbaraholka', 'https://t.me/novisadbaraholka']), ['typo']);
});
