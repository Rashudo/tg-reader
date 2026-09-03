const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setEnvVar } = require('./envfile');

function tmpEnv(content) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-env-')), '.env');
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
}

test('существующая строка заменяется, соседние не трогаются', () => {
  const file = tmpEnv('TG_API_ID=1\nTG_SESSION=старое\nTARGET=me\n');
  setEnvVar(file, 'TG_SESSION', 'новое');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'TG_API_ID=1\nTG_SESSION=новое\nTARGET=me\n');
});

test('отсутствующая переменная дописывается', () => {
  const file = tmpEnv('TG_API_ID=1\n');
  setEnvVar(file, 'ALERT_CHAT_ID', '42');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'TG_API_ID=1\nALERT_CHAT_ID=42\n');
});

test('файл без завершающего перевода строки не склеивается', () => {
  const file = tmpEnv('TG_API_ID=1');
  setEnvVar(file, 'ALERT_CHAT_ID', '42');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'TG_API_ID=1\nALERT_CHAT_ID=42\n');
});

test('символы $ и & в значении не толкуются как ссылки на группы', () => {
  const file = tmpEnv('TG_SESSION=x\n');
  setEnvVar(file, 'TG_SESSION', 'a$&b$1c');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'TG_SESSION=a$&b$1c\n');
});

test('права на файл ужимаются до 600 — там доступ к аккаунту', () => {
  const file = tmpEnv('TG_API_ID=1\n');
  fs.chmodSync(file, 0o644);
  setEnvVar(file, 'TG_SESSION', 'секрет');
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('несуществующий файл создаётся', () => {
  const file = tmpEnv();
  setEnvVar(file, 'ALERT_CHAT_ID', '42');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'ALERT_CHAT_ID=42\n');
});
