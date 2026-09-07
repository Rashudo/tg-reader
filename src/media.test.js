const test = require('node:test');
const assert = require('node:assert');
const { describeMedia, chatText } = require('./media');

function sticker(alt) {
  return { attributes: [{ className: 'DocumentAttributeSticker', alt }] };
}

test('стикер описывается своим эмодзи', () => {
  assert.strictEqual(describeMedia({ sticker: sticker('😂'), document: sticker('😂') }), 'стикер 😂');
});

test('стикер без эмодзи всё равно стикер', () => {
  assert.strictEqual(describeMedia({ sticker: { attributes: [] } }), 'стикер');
});

test('гифка не считается видео или файлом', () => {
  assert.strictEqual(describeMedia({ gif: {}, video: {}, document: {} }), 'гифка');
});

test('кружок отличается от обычного видео', () => {
  assert.strictEqual(describeMedia({ videoNote: {}, video: {} }), 'кружок');
});

test('голосовое отличается от музыки', () => {
  assert.strictEqual(describeMedia({ voice: {}, audio: {}, document: {} }), 'голосовое');
});

test('фото, опрос и файл получают свои пометки', () => {
  assert.strictEqual(describeMedia({ photo: {} }), 'фото');
  assert.strictEqual(describeMedia({ poll: {} }), 'опрос');
  assert.strictEqual(describeMedia({ document: {} }), 'файл');
});

test('обычное сообщение пометки не получает', () => {
  assert.strictEqual(describeMedia({ message: 'привет' }), '');
  assert.strictEqual(describeMedia(null), '');
});

test('голая картинка показывается одной пометкой', () => {
  assert.strictEqual(chatText({ text: '', media: 'стикер 😂' }), '[стикер 😂]');
});

test('подпись идёт после пометки', () => {
  assert.strictEqual(chatText({ text: 'вот это да', media: 'фото' }), '[фото] вот это да');
});

test('текст без вложения остаётся собой', () => {
  assert.strictEqual(chatText({ text: ' привет ', media: null }), 'привет');
  assert.strictEqual(chatText({ text: '' }), '');
});
