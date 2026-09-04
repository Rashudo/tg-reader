const fs = require('fs');
const path = require('path');

const STATE_PATH = process.env.TG_STATE_PATH || path.join(__dirname, '..', 'state.json');
const FLUSH_DELAY_MS = 2000;
const SENT_MEMORY = 300;
const ANSWERED_MEMORY = 500;
const SAID_MEMORY = 8;
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
  const empty = {
    lastId: null,
    sent: [],
    lastMessageAt: null,
    checked: 0,
    forwarded: 0,
    digestUpToId: null,
    digestRunAt: null,
  };
  if (Number.isInteger(value)) return { ...empty, lastId: value };
  if (!value || typeof value !== 'object') return empty;
  return {
    lastId: Number.isInteger(value.lastId) ? value.lastId : null,
    sent: Array.isArray(value.sent) ? value.sent.filter(Number.isInteger) : [],
    lastMessageAt: Number.isInteger(value.lastMessageAt) ? value.lastMessageAt : null,
    checked: Number.isInteger(value.checked) ? value.checked : 0,
    forwarded: Number.isInteger(value.forwarded) ? value.forwarded : 0,
    digestUpToId: Number.isInteger(value.digestUpToId) ? value.digestUpToId : null,
    digestRunAt: Number.isInteger(value.digestRunAt) ? value.digestRunAt : null,
  };
}

function normalizeReplies(value) {
  const empty = {
    enabled: true,
    day: null,
    addressed: 0,
    spontaneous: 0,
    lastAddressedAt: 0,
    lastSpontaneousAt: 0,
    answered: [],
    said: [],
    botOffset: 0,
  };
  if (!value || typeof value !== 'object') return empty;
  return {
    enabled: value.enabled !== false,
    day: typeof value.day === 'string' ? value.day : null,
    addressed: Number.isInteger(value.addressed) ? value.addressed : 0,
    spontaneous: Number.isInteger(value.spontaneous) ? value.spontaneous : 0,
    lastAddressedAt: Number.isInteger(value.lastAddressedAt) ? value.lastAddressedAt : 0,
    lastSpontaneousAt: Number.isInteger(value.lastSpontaneousAt) ? value.lastSpontaneousAt : 0,
    answered: Array.isArray(value.answered) ? value.answered.filter(Number.isInteger) : [],
    said: Array.isArray(value.said) ? value.said.filter((item) => typeof item === 'string') : [],
    botOffset: Number.isInteger(value.botOffset) ? value.botOffset : 0,
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
  let replies = normalizeReplies(service.replies);

  const BLANK = normalizeEntry(null);

  function peek(key) {
    return data.get(key) || BLANK;
  }

  function mutable(key) {
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
      const dump = { ...Object.fromEntries(data), [SERVICE_KEY]: { ...service, replies } };
      fs.writeFileSync(tmp, JSON.stringify(dump, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error(`Не удалось сохранить ${file}: ${err.message}`);
    }
  }

  return {
    lastId(key) {
      return peek(key).lastId;
    },
    advance(key, messageId) {
      if (!Number.isInteger(messageId)) return;
      const current = mutable(key);
      if (current.lastId !== null && current.lastId >= messageId) return;
      current.lastId = messageId;
      schedule();
    },
    wasSent(key, messageId) {
      return peek(key).sent.includes(messageId);
    },
    digestUpTo(key) {
      return peek(key).digestUpToId;
    },
    setDigestUpTo(key, messageId) {
      if (!Number.isInteger(messageId)) return;
      const current = mutable(key);
      if (current.digestUpToId !== null && current.digestUpToId >= messageId) return;
      current.digestUpToId = messageId;
      schedule();
    },
    lastDigestRunAt(key) {
      const own = peek(key).digestRunAt;
      if (Number.isInteger(own)) return own;
      return Number.isInteger(service.lastDigestRunAt) ? service.lastDigestRunAt : null;
    },
    setDigestRunAt(key, at) {
      if (!Number.isInteger(at)) return;
      mutable(key).digestRunAt = at;
      schedule();
    },
    forwarding() {
      return service.forwarding !== false;
    },
    setForwarding(on) {
      service = { ...service, forwarding: Boolean(on) };
      schedule();
    },
    probeOkAt() {
      return Number.isInteger(service.probeOkAt) ? service.probeOkAt : null;
    },
    setProbeOkAt(at) {
      if (!Number.isInteger(at)) return;
      service = { ...service, probeOkAt: at };
      schedule();
    },
    startedAt() {
      return Number.isInteger(service.startedAt) ? service.startedAt : null;
    },
    setStartedAt(at) {
      service = { ...service, startedAt: at };
      schedule();
    },
    repliesEnabled() {
      return replies.enabled !== false;
    },
    setRepliesEnabled(on) {
      replies = { ...replies, enabled: Boolean(on) };
      schedule();
    },
    replyCounters(day) {
      if (replies.day !== day) {
        return { addressed: 0, spontaneous: 0, lastAddressedAt: 0, lastSpontaneousAt: 0 };
      }
      return {
        addressed: replies.addressed,
        spontaneous: replies.spontaneous,
        lastAddressedAt: replies.lastAddressedAt,
        lastSpontaneousAt: replies.lastSpontaneousAt,
      };
    },
    noteReply(kind, at, day) {
      const fresh = replies.day === day ? replies : { ...replies, day, addressed: 0, spontaneous: 0, lastAddressedAt: 0, lastSpontaneousAt: 0 };
      const field = kind === 'addressed' ? 'addressed' : 'spontaneous';
      const stamp = kind === 'addressed' ? 'lastAddressedAt' : 'lastSpontaneousAt';
      replies = { ...fresh, [field]: fresh[field] + 1, [stamp]: at };
      schedule();
    },
    wasAnswered(messageId) {
      return replies.answered.includes(messageId);
    },
    noteAnswered(messageId) {
      if (!Number.isInteger(messageId) || replies.answered.includes(messageId)) return;
      const answered = [...replies.answered, messageId];
      if (answered.length > ANSWERED_MEMORY) answered.splice(0, answered.length - ANSWERED_MEMORY);
      replies = { ...replies, answered };
      schedule();
    },
    resetReplyCounters() {
      replies = { ...replies, addressed: 0, spontaneous: 0, lastAddressedAt: 0, lastSpontaneousAt: 0 };
      schedule();
    },
    recentReplies() {
      return [...replies.said];
    },
    noteSaid(text) {
      if (typeof text !== 'string' || !text.trim()) return;
      const said = [...replies.said, text];
      if (said.length > SAID_MEMORY) said.splice(0, said.length - SAID_MEMORY);
      replies = { ...replies, said };
      schedule();
    },
    botOffset() {
      return replies.botOffset;
    },
    setBotOffset(value) {
      if (!Number.isInteger(value)) return;
      replies = { ...replies, botOffset: value };
      schedule();
    },
    noteSeen(key, count, at) {
      const current = mutable(key);
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
      const current = mutable(key);
      if (current.sent.includes(messageId)) return;
      current.sent.push(messageId);
      current.forwarded += 1;
      if (current.sent.length > SENT_MEMORY) current.sent.splice(0, current.sent.length - SENT_MEMORY);
      schedule();
    },
    flush,
  };
}

module.exports = { createState, STATE_PATH, SENT_MEMORY, ANSWERED_MEMORY, SAID_MEMORY };
