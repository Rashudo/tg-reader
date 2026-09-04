const test = require('node:test');
const assert = require('node:assert');
const { systemPrompt, clampSummary } = require('./prompt');

test('в промпте стоит потолок пунктов и требование ранжировать', () => {
  const prompt = systemPrompt(20);
  assert.match(prompt, /20/);
  assert.match(prompt, /важн/i);
});

test('потолок пунктов настраивается', () => {
  assert.match(systemPrompt(8), /8/);
  assert.ok(!systemPrompt(8).includes('20 '));
});

test('промпт требует склеивать родственные новости в один пункт', () => {
  assert.match(systemPrompt(20), /объедин|склеи|одну строк/i);
});

const wide = {
  groups: [
    { topic: 'А', items: [{ text: '1' }, { text: '2' }, { text: '3' }] },
    { topic: 'Б', items: [{ text: '4' }, { text: '5' }] },
    { topic: 'В', items: [{ text: '6' }] },
  ],
  dropped: 7,
};

test('лишние пункты обрезаются, даже если модель не послушалась', () => {
  const clamped = clampSummary(wide, 4);
  const total = clamped.groups.reduce((n, g) => n + g.items.length, 0);
  assert.strictEqual(total, 4);
});

test('обрезка не оставляет пустых тем', () => {
  const clamped = clampSummary(wide, 3);
  assert.deepStrictEqual(clamped.groups.map((g) => g.topic), ['А']);
});

test('в пределах потолка сводка не трогается', () => {
  assert.deepStrictEqual(clampSummary(wide, 10), wide);
});

test('отброшенные пункты досчитываются к dropped', () => {
  assert.strictEqual(clampSummary(wide, 4).dropped, 9);
});

test('сырой ответ модели обрезка не трогает', () => {
  const raw = { raw: 'проза' };
  assert.deepStrictEqual(clampSummary(raw, 2), raw);
});

test('промпт ограничивает длину пункта', () => {
  assert.match(systemPrompt(20), /слов/);
});

test('промпт разрешает пункту два предложения, а не одно', () => {
  assert.match(systemPrompt(20), /одно-два предложения/);
});

test('промпт требует разносить разные события по разным пунктам', () => {
  assert.match(systemPrompt(20), /два пункта/);
});

test('промпт требует ставить важное первым — иначе обрезка режет вслепую', () => {
  assert.match(systemPrompt(20), /порядке важности|важное.*перв/i);
});
