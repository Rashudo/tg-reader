const test = require('node:test');
const assert = require('node:assert');
const { repeatsRecent } = require('./repetition');

test('подхваченная фраза считается повтором', () => {
  const recent = ['нахуй тебе пирог, ты ж на бабки не встаёшь, только на рот парня'];
  assert.strictEqual(repeatsRecent('тесто, сахар, корица и твой рот парня для замеса', recent), true);
});

test('повтор ловится и через несколько реплик назад', () => {
  const recent = ['только на рот парня', 'да это моя фирменная', 'клод не смог проанализировать'];
  assert.strictEqual(repeatsRecent('какую именно, про рот парня? это фирменное', recent), true);
});

test('склонение подхваченной фразы тоже считается повтором', () => {
  assert.strictEqual(repeatsRecent('твой рот парню оставь', ['только на рот парня']), true);
});

test('чего сторож не ловит: беглая гласная в корне', () => {
  assert.strictEqual(repeatsRecent('11 ртов парня из 10', ['только на рот парня']), false);
});

test('разные по смыслу реплики повтором не считаются', () => {
  const recent = ['ага, у него уже контекст переполняется, поэтому и лупится'];
  assert.strictEqual(repeatsRecent('там ключ и телефон нужен, а его я с собой не таскаю', recent), false);
});

test('связки из служебных слов повтором не считаются', () => {
  const recent = ['да ладно, я вообще ничего не говорил'];
  assert.strictEqual(repeatsRecent('да ладно тебе, всё нормально', recent), false);
});

test('пустая история повторов не даёт', () => {
  assert.strictEqual(repeatsRecent('что угодно', []), false);
});

test('одно слово повтором не считается', () => {
  assert.strictEqual(repeatsRecent('пирог', ['пирог с корицей и мясом']), false);
});

const { hitsBanned } = require('./repetition');

test('запрещённое слово ловится в любой форме предложения', () => {
  const banned = ['рот', 'рта', 'ртом', 'ртов'];
  assert.strictEqual(hitsBanned('скоро весь гит будет одним большим ртом парня', banned), 'ртом');
  assert.strictEqual(hitsBanned('только на рот парня', banned), 'рот');
  assert.strictEqual(hitsBanned('11 ртов парня из 10', banned), 'ртов');
});

test('запрет по целому слову не цепляет другие слова', () => {
  assert.strictEqual(hitsBanned('крот вырыл нору, а робот смотрел', ['рот']), null);
});

test('запрет из нескольких слов ищется как оборот', () => {
  assert.strictEqual(hitsBanned('да это твой рот парня виноват', ['рот парня']), 'рот парня');
  assert.strictEqual(hitsBanned('рот у парня', ['рот парня']), null);
});

test('пустой список запретов ничего не ловит', () => {
  assert.strictEqual(hitsBanned('что угодно', []), null);
});

test('регистр и ё не мешают запрету', () => {
  assert.strictEqual(hitsBanned('РОТ, Ёлки', ['рот']), 'рот');
  assert.strictEqual(hitsBanned('ёлки зелёные', ['елки']), 'елки');
});
