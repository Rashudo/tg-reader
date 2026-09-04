const test = require('node:test');
const assert = require('node:assert');
const { loadConfig } = require('./config');

const full = {
  TG_API_ID: '12345',
  TG_API_HASH: 'hash',
  TG_SESSION: 'сессия',
  CHANNEL: '@one, @two',
  NEWS_CHANNELS: '@news',
  ANTHROPIC_API_KEY: 'key',
};

test('пустое окружение даёт ошибки, а не смерть процесса', () => {
  const { errors } = loadConfig({});
  assert.match(errors.join('\n'), /TG_API_ID/);
  assert.match(errors.join('\n'), /TG_API_HASH/);
});

test('нечисловой TG_API_ID — отдельная ошибка', () => {
  const { errors } = loadConfig({ ...full, TG_API_ID: 'двенадцать' });
  assert.match(errors.join('\n'), /TG_API_ID должен быть числом/);
});

test('полное окружение читается без ошибок', () => {
  const { config, errors } = loadConfig(full);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(config.apiId, 12345);
  assert.deepStrictEqual(config.channels, ['@one', '@two']);
});

test('значения по умолчанию не зависят от .env на диске', () => {
  const { config } = loadConfig(full);
  assert.strictEqual(config.news.model, 'claude-haiku-4-5');
  assert.strictEqual(config.news.hour, 7);
  assert.strictEqual(config.news.timeZone, 'Europe/Belgrade');
  assert.strictEqual(config.replies.dailyBudget, 4);
  assert.strictEqual(config.replies.spontaneousPauseMs, 90 * 60 * 1000);
  assert.strictEqual(config.health.digestHour, null);
});

test('зона автоответов берётся из NEWS_TZ', () => {
  const { config } = loadConfig({ ...full, NEWS_TZ: 'Europe/Moscow' });
  assert.strictEqual(config.replies.timeZone, 'Europe/Moscow');
});

test('loadConfig не читает process.env', () => {
  process.env.TG_API_ID = '999';
  try {
    const { config } = loadConfig(full);
    assert.strictEqual(config.apiId, 12345);
  } finally {
    delete process.env.TG_API_ID;
  }
});
