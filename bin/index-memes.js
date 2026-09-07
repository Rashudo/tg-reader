const fs = require('fs');
const os = require('os');
const path = require('path');
const bigInt = require('big-integer');
const { Api } = require('telegram');
const { config } = require('../src/config');
const { createClient } = require('../src/client');
const { createAnthropicCall } = require('../src/news');
const { describeImage, sniffImage, DEFAULT_MODEL } = require('../src/memes-vision');
const { MEMES_PATH } = require('../src/memes');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1];
};

const CACHE = valueOf('--cache', path.join(os.tmpdir(), 'tg-memes-cache'));
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function emojiOf(doc) {
  const attr = (doc.attributes || []).find((item) => typeof item.alt === 'string' && item.alt);
  return attr ? attr.alt : '';
}

function biggestThumb(doc) {
  const thumbs = (doc.thumbs || []).filter((thumb) => thumb.className !== 'PhotoPathSize');
  if (thumbs.length === 0) return null;
  const weight = (thumb) =>
    thumb.size || (thumb.bytes && thumb.bytes.length) || (thumb.sizes ? Math.max(...thumb.sizes) : 0);
  return [...thumbs].sort((a, b) => weight(a) - weight(b)).pop();
}

async function pictureOf(client, doc) {
  if (doc.mimeType === 'image/webp') {
    const full = await client.downloadMedia(doc, {});
    if (full && full.length) return full;
  }
  const thumb = biggestThumb(doc);
  if (!thumb) return null;
  return client.downloadMedia(doc, { thumb });
}

async function collect(client) {
  const wanted = valueOf('--only', 'все');
  const items = [];
  if (wanted !== 'gifs') {
    const faved = await client.invoke(new Api.messages.GetFavedStickers({ hash: bigInt(0) }));
    for (const doc of faved.stickers || []) items.push({ id: String(doc.id), kind: 'sticker', emoji: emojiOf(doc), doc });
    const recent = await client.invoke(new Api.messages.GetRecentStickers({ hash: bigInt(0) }));
    for (const doc of recent.stickers || []) {
      if (items.some((item) => item.id === String(doc.id))) continue;
      items.push({ id: String(doc.id), kind: 'sticker', emoji: emojiOf(doc), doc });
    }
  }
  if (wanted !== 'stickers') {
    const saved = await client.invoke(new Api.messages.GetSavedGifs({ hash: bigInt(0) }));
    for (const doc of saved.gifs || []) items.push({ id: String(doc.id), kind: 'gif', emoji: '', doc });
  }
  return items;
}

async function fetchPhase() {
  console.log('Скрипт подключается к Telegram: сервис должен быть остановлен.');
  const client = createClient();
  if (client.setLogLevel) client.setLogLevel('error');
  await client.connect();
  if (!(await client.isUserAuthorized())) {
    console.error('Сессия недействительна. Выполните: npm run login');
    process.exit(1);
  }

  const items = await collect(client);
  const stickers = items.filter((item) => item.kind === 'sticker').length;
  console.log(`Нашлось: стикеров ${stickers}, гифок ${items.length - stickers}`);

  if (has('--list')) {
    await client.disconnect();
    return;
  }

  fs.mkdirSync(CACHE, { recursive: true });
  const limit = Number(valueOf('--limit', items.length)) || items.length;
  const saved = [];
  for (const item of items.slice(0, limit)) {
    let buffer = null;
    try {
      buffer = await pictureOf(client, item.doc);
    } catch (err) {
      console.log(`  ${item.id}: картинку не скачать (${err.message})`);
    }
    const type = sniffImage(buffer);
    if (!type) continue;
    const file = path.join(CACHE, `${item.kind}-${item.id}.${EXT[type]}`);
    fs.writeFileSync(file, buffer);
    saved.push({ id: item.id, kind: item.kind, emoji: item.emoji, file });
  }
  await client.disconnect();
  fs.writeFileSync(path.join(CACHE, 'index.json'), JSON.stringify(saved, null, 2));
  console.log(`Картинок сложено: ${saved.length} → ${CACHE}`);
  console.log('Теперь можно поднять сервис и запустить: npm run memes -- --describe');
}

async function describePhase() {
  if (!config.anthropicKey) {
    console.error('Нет ANTHROPIC_API_KEY — описывать картинки нечем');
    process.exit(1);
  }
  const listing = path.join(CACHE, 'index.json');
  if (!fs.existsSync(listing)) {
    console.error(`Нет выгрузки в ${CACHE}. Сначала: systemctl stop tg-reader && npm run memes -- --fetch`);
    process.exit(1);
  }
  const items = JSON.parse(fs.readFileSync(listing, 'utf8'));
  const model = valueOf('--model', DEFAULT_MODEL);
  const createMessage = createAnthropicCall(config.anthropicKey);
  const limit = Number(valueOf('--limit', items.length)) || items.length;
  const described = [];
  let skipped = 0;

  for (const item of items.slice(0, limit)) {
    let out;
    try {
      out = await describeImage({
        createMessage,
        buffer: fs.readFileSync(item.file),
        kind: item.kind,
        emoji: item.emoji,
        model,
      });
    } catch (err) {
      console.log(`  ${item.id}: модель не ответила (${err.message})`);
      skipped += 1;
      continue;
    }
    if (!out.note) {
      console.log(`  ${item.id}: ${out.why}`);
      skipped += 1;
      continue;
    }
    described.push({ id: item.id, kind: item.kind, emoji: item.emoji, note: out.note });
    console.log(`  ${item.id} ${item.kind === 'gif' ? 'гифка' : `стикер ${item.emoji}`}: ${out.note}`);
  }

  fs.writeFileSync(MEMES_PATH, JSON.stringify({ builtAt: Date.now(), model, items: described }, null, 2));
  console.log(`\nОписано ${described.length}, пропущено ${skipped} → ${MEMES_PATH}`);
}

(async () => {
  if (has('--describe')) return describePhase();
  return fetchPhase();
})().catch((err) => {
  console.error('Каталог собрать не удалось:', err.message);
  process.exit(1);
});
