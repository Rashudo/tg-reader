const test = require('node:test');
const assert = require('node:assert');
const { toItems, windowStart, due, DAY_MS } = require('./logic');

const post = (id, text, at) => ({ id, chatKey: 'c1', at, text, link: `https://t.me/c/1/${id}` });
const NOW = Date.UTC(2026, 8, 4, 12);

test('на первом прогоне окно — сутки назад', () => {
  assert.strictEqual(windowStart(null, NOW), NOW - DAY_MS);
});

test('на последующих прогонах окна по времени нет — отсекает курсор', () => {
  assert.strictEqual(windowStart(500, NOW), null);
});

test('пустые сообщения выбрасываются', () => {
  const items = toItems([post(1, '   ', NOW), post(2, 'дело', NOW)], { since: null, maxMessages: 10, includeLinks: false });
  assert.deepStrictEqual(items.map((i) => i.id), [2]);
});

test('старее окна не попадает', () => {
  const items = toItems([post(1, 'старое', NOW - 2 * DAY_MS), post(2, 'свежее', NOW)], {
    since: NOW - DAY_MS, maxMessages: 10, includeLinks: false,
  });
  assert.deepStrictEqual(items.map((i) => i.id), [2]);
});

test('лимит режет с конца — остаются самые свежие', () => {
  const posts = [1, 2, 3, 4].map((id) => post(id, `текст ${id}`, NOW));
  const items = toItems(posts, { since: null, maxMessages: 2, includeLinks: false });
  assert.deepStrictEqual(items.map((i) => i.id), [3, 4]);
});

test('ссылки добавляются только когда их просят', () => {
  const [withLink] = toItems([post(1, 'дело', NOW)], { since: null, maxMessages: 10, includeLinks: true });
  const [without] = toItems([post(1, 'дело', NOW)], { since: null, maxMessages: 10, includeLinks: false });
  assert.match(withLink.link, /t\.me/);
  assert.strictEqual('link' in without, false);
});

test('порядок всегда по возрастанию id', () => {
  const items = toItems([post(3, 'в', NOW), post(1, 'а', NOW)], { since: null, maxMessages: 10, includeLinks: false });
  assert.deepStrictEqual(items.map((i) => i.id), [1, 3]);
});

const chats = [{ key: 'c1' }];

test('до назначенного часа сводка не пора', () => {
  const at = Date.UTC(2026, 8, 4, 3);
  assert.strictEqual(due({ chats, lastRunAt: () => null, now: at, hour: 7, timeZone: 'UTC' }), false);
});

test('после назначенного часа сводка пора', () => {
  assert.strictEqual(due({ chats, lastRunAt: () => null, now: NOW, hour: 7, timeZone: 'UTC' }), true);
});

test('второй раз в те же сутки сводка не пора', () => {
  const ranAt = Date.UTC(2026, 8, 4, 8);
  assert.strictEqual(due({ chats, lastRunAt: () => ranAt, now: NOW, hour: 7, timeZone: 'UTC' }), false);
});

test('на следующие сутки снова пора', () => {
  const ranAt = Date.UTC(2026, 8, 3, 8);
  assert.strictEqual(due({ chats, lastRunAt: () => ranAt, now: NOW, hour: 7, timeZone: 'UTC' }), true);
});

test('хватает одного канала, которому пора', () => {
  const two = [{ key: 'a' }, { key: 'b' }];
  const lastRunAt = (key) => (key === 'a' ? NOW : null);
  assert.strictEqual(due({ chats: two, lastRunAt, now: NOW, hour: 7, timeZone: 'UTC' }), true);
});
