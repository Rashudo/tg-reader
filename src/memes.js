const fs = require('fs');
const path = require('path');

const MEMES_PATH = process.env.TG_MEMES_PATH || path.join(__dirname, '..', 'memes.json');
const NOTE_MAX = 140;

function kindOf(value) {
  return value === 'gif' ? 'gif' : 'sticker';
}

function normalizeCatalogue(raw) {
  const items = Array.isArray(raw) ? raw : (raw && raw.items) || [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue;
    const note = String(item.note || '').trim().replace(/\s+/g, ' ').slice(0, NOTE_MAX);
    if (!note) continue;
    seen.add(item.id);
    out.push({
      id: item.id,
      kind: kindOf(item.kind),
      emoji: typeof item.emoji === 'string' ? item.emoji : '',
      note,
    });
  }
  return out;
}

function loadMemes(file = MEMES_PATH) {
  try {
    return normalizeCatalogue(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Не удалось прочитать ${file} (${err.message})`);
    return [];
  }
}

function titleOf(item) {
  if (item.kind === 'gif') return 'гифка';
  return `стикер ${item.emoji}`.trim();
}

function catalogueBlock(items) {
  if (!items || items.length === 0) return '';
  return [
    '',
    'Картинки, которые у тебя под рукой. Каждая описана словами, сам ты их не видишь:',
    ...items.map((item) => `— ${item.id}: ${titleOf(item)} — ${item.note}`),
    'Иногда картинка отвечает лучше слов. Тогда верни её id в поле meme, а text оставь пустым.',
    'Это редкий ход, реже одного раза в день: словами — почти всегда.',
    'Картинка вместо ответа на прямой вопрос — отговорка, так не делай.',
    '',
  ].join('\n');
}

function pickMeme(items, id) {
  if (!id || typeof id !== 'string') return null;
  return (items || []).find((item) => item.id === id) || null;
}

function freshMemes(items, used, { now, cooldownMs }) {
  const lastUse = new Map();
  for (const entry of used || []) {
    if (!entry || typeof entry.id !== 'string') continue;
    const at = Number.isInteger(entry.at) ? entry.at : 0;
    lastUse.set(entry.id, Math.max(lastUse.get(entry.id) || 0, at));
  }
  return (items || []).filter((item) => {
    const at = lastUse.get(item.id);
    return !at || now - at >= cooldownMs;
  });
}

function sampleMemes(items, count, random = Math.random) {
  const list = [...(items || [])];
  if (!count || list.length <= count) return list;
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, count);
}

module.exports = { loadMemes, normalizeCatalogue, catalogueBlock, pickMeme, freshMemes, sampleMemes, titleOf, MEMES_PATH };
