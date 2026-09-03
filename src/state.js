const fs = require('fs');
const path = require('path');

const STATE_PATH = process.env.TG_STATE_PATH || path.join(__dirname, '..', 'state.json');
const FLUSH_DELAY_MS = 2000;
const SENT_MEMORY = 300;
const SERVICE_KEY = '_service';

function read(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Не удалось прочитать ${file} (${err.message}) — начинаем с чистой позиции`);
    }
    return {};
  }
}

function normalizeEntry(value) {
  const empty = { lastId: null, sent: [], lastMessageAt: null, checked: 0, forwarded: 0, digestUpToId: null };
  if (Number.isInteger(value)) return { ...empty, lastId: value };
  if (!value || typeof value !== 'object') return empty;
  return {
    lastId: Number.isInteger(value.lastId) ? value.lastId : null,
    sent: Array.isArray(value.sent) ? value.sent.filter(Number.isInteger) : [],
    lastMessageAt: Number.isInteger(value.lastMessageAt) ? value.lastMessageAt : null,
    checked: Number.isInteger(value.checked) ? value.checked : 0,
    forwarded: Number.isInteger(value.forwarded) ? value.forwarded : 0,
    digestUpToId: Number.isInteger(value.digestUpToId) ? value.digestUpToId : null,
  };
}

function createState(file = STATE_PATH) {
  const raw = read(file);
  const data = new Map();
  let service = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === SERVICE_KEY) {
      service = value && typeof value === 'object' ? value : {};
      continue;
    }
    data.set(key, normalizeEntry(value));
  }
  let timer = null;

  function entry(key) {
    if (!data.has(key)) data.set(key, normalizeEntry(null));
    return data.get(key);
  }

  function schedule() {
    if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      const tmp = `${file}.tmp`;
      const dump = { ...Object.fromEntries(data), [SERVICE_KEY]: service };
      fs.writeFileSync(tmp, JSON.stringify(dump, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error(`Не удалось сохранить ${file}: ${err.message}`);
    }
  }

  return {
    lastId(key) {
      return entry(key).lastId;
    },
    advance(key, messageId) {
      if (!Number.isInteger(messageId)) return;
      const current = entry(key);
      if (current.lastId !== null && current.lastId >= messageId) return;
      current.lastId = messageId;
      schedule();
    },
    wasSent(key, messageId) {
      return entry(key).sent.includes(messageId);
    },
    digestUpTo(key) {
      return entry(key).digestUpToId;
    },
    setDigestUpTo(key, messageId) {
      if (!Number.isInteger(messageId)) return;
      const current = entry(key);
      if (current.digestUpToId !== null && current.digestUpToId >= messageId) return;
      current.digestUpToId = messageId;
      schedule();
    },
    lastDigestRunAt() {
      return Number.isInteger(service.lastDigestRunAt) ? service.lastDigestRunAt : null;
    },
    setDigestRunAt(at) {
      service = { ...service, lastDigestRunAt: at };
      schedule();
    },
    startedAt() {
      return Number.isInteger(service.startedAt) ? service.startedAt : null;
    },
    setStartedAt(at) {
      service = { ...service, startedAt: at };
      schedule();
    },
    noteSeen(key, count, at) {
      const current = entry(key);
      current.checked += count;
      if (Number.isInteger(at) && (current.lastMessageAt === null || at > current.lastMessageAt)) {
        current.lastMessageAt = at;
      }
      schedule();
    },
    lastMessageAt() {
      let newest = null;
      for (const current of data.values()) {
        if (current.lastMessageAt !== null && (newest === null || current.lastMessageAt > newest)) {
          newest = current.lastMessageAt;
        }
      }
      return newest;
    },
    totals() {
      let checked = 0;
      let forwarded = 0;
      for (const current of data.values()) {
        checked += current.checked;
        forwarded += current.forwarded;
      }
      return { checked, forwarded };
    },
    markSent(key, messageId) {
      if (!Number.isInteger(messageId)) return;
      const current = entry(key);
      if (current.sent.includes(messageId)) return;
      current.sent.push(messageId);
      current.forwarded += 1;
      if (current.sent.length > SENT_MEMORY) current.sent.splice(0, current.sent.length - SENT_MEMORY);
      schedule();
    },
    flush,
  };
}

module.exports = { createState, STATE_PATH, SENT_MEMORY };
