const test = require('node:test');
const assert = require('node:assert');
const { renderDigest, digestHeading } = require('./render');
const { TELEGRAM_LIMIT } = require('../../platform/telegram/text');

const META = { title: 'Новости Нови-Сада', total: 214, at: Date.parse('2026-09-03T05:00:00Z'), timeZone: 'Europe/Belgrade' };

const SUMMARY = {
  groups: [
    { topic: 'Город', items: [{ text: 'Ремонт моста начнётся в октябре', link: 'https://t.me/c/1/10' }] },
    { topic: 'Транспорт', items: [{ text: 'Автобус 72 меняет маршрут' }, { text: 'Подорожал проезд' }] },
  ],
  dropped: 150,
};

test('заголовок называет канал и день по местной зоне', () => {
  const heading = digestHeading(META);
  assert.match(heading, /Новости Нови-Сада/);
  assert.match(heading, /3 сентября/);
});

test('сводка содержит темы и пункты', () => {
  const [text] = renderDigest(SUMMARY, META);
  assert.match(text, /Город/);
  assert.match(text, /Ремонт моста/);
  assert.match(text, /Транспорт/);
  assert.match(text, /Автобус 72/);
});

test('видно, сколько просмотрено и сколько отброшено', () => {
  const [text] = renderDigest(SUMMARY, META);
  assert.match(text, /214/);
  assert.match(text, /150/);
});

test('ссылка на оригинал попадает в текст, а её отсутствие не ломает строку', () => {
  const [text] = renderDigest(SUMMARY, META);
  assert.match(text, /https:\/\/t\.me\/c\/1\/10/);
  assert.match(text, /Подорожал проезд/);
  assert.ok(!text.includes('undefined'));
});

test('пустая сводка говорит об этом прямо, а не молчит', () => {
  const [text] = renderDigest({ groups: [], dropped: 40 }, META);
  assert.match(text, /ничего существенного/i);
  assert.strictEqual(renderDigest({ groups: [], dropped: 40 }, META).length, 1);
});

test('длинная сводка режется на части по границам тем', () => {
  const big = {
    groups: Array.from({ length: 40 }, (_, i) => ({
      topic: `Тема ${i}`,
      items: [{ text: 'я'.repeat(300) }],
    })),
    dropped: 0,
  };
  const parts = renderDigest(big, META);
  assert.ok(parts.length > 1, 'должно быть несколько сообщений');
  for (const part of parts) assert.ok(part.length <= TELEGRAM_LIMIT, `часть длиннее лимита: ${part.length}`);
  assert.match(parts.join('\n'), /Тема 39/);
});

test('одна непомерно длинная тема обрезается, но не роняет отправку', () => {
  const huge = { groups: [{ topic: 'Огромная', items: [{ text: 'я'.repeat(20000) }] }], dropped: 0 };
  const parts = renderDigest(huge, META);
  for (const part of parts) assert.ok(part.length <= TELEGRAM_LIMIT);
});

test('сырой текст модели вместо структуры всё равно доходит', () => {
  const parts = renderDigest({ raw: 'Модель ответила текстом, а не структурой' }, META);
  assert.match(parts[0], /Модель ответила текстом/);
});
