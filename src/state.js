const path = require('path');
const { openDb } = require('./platform/db/open');
const { importLegacyState } = require('./platform/db/import-state-json');
const { createForwardingStore } = require('./features/forwarding/store');
const { createDigestStore } = require('./features/digest/store');
const { createRepliesStore } = require('./features/replies/store');
const { createStatusWriter, readStatus } = require('./features/health/status');

const DB_PATH = process.env.TG_DB_PATH || path.join(__dirname, '..', 'state.db');
const LEGACY_PATH = process.env.TG_STATE_PATH || path.join(__dirname, '..', 'state.json');
const SAID_MEMORY = 8;

function createState(file = DB_PATH, { legacyFile = LEGACY_PATH } = {}) {
  const db = openDb(file);
  importLegacyState(db, legacyFile);

  const forwarding = createForwardingStore(db);
  const digest = createDigestStore(db);
  const replies = createRepliesStore(db);
  const status = createStatusWriter(db);

  const known = readStatus(file);
  const service = known.ok
    ? { startedAt: known.status.startedAt, forwarding: known.status.forwarding, probeOkAt: known.status.probeOkAt }
    : { startedAt: null, forwarding: null, probeOkAt: null };

  function writeStatus() {
    const totals = forwarding.totals();
    status.write(
      {
        startedAt: service.startedAt,
        forwarding: service.forwarding,
        digestEnabled: null,
        repliesEnabled: replies.enabled(),
        lastPostAt: forwarding.lastMessageAt(),
        probeOkAt: service.probeOkAt,
        checked: totals.checked,
        forwarded: totals.forwarded,
      },
      Date.now()
    );
  }

  return {
    lastId: (key) => forwarding.lastId(key),
    advance: (key, id) => forwarding.advance(key, id),
    wasSent: (key, messageId) => forwarding.wasSent(key, messageId),
    markSent(key, messageId) {
      if (!Number.isInteger(messageId)) return;
      forwarding.commitForward(key, { ids: [messageId], newestId: null, at: Date.now() });
      writeStatus();
    },
    noteSeen(key, count, at) {
      forwarding.noteSeen(key, count, at);
      writeStatus();
    },
    lastMessageAt: () => forwarding.lastMessageAt(),
    totals: () => forwarding.totals(),

    digestUpTo: (key) => digest.upTo(key),
    setDigestUpTo: (key, messageId) => digest.setUpTo(key, messageId),
    lastDigestRunAt: (key) => digest.lastRunAt(key),
    setDigestRunAt: (key, at) => digest.setRunAt(key, at),

    repliesEnabled: () => replies.enabled(),
    setRepliesEnabled(on) {
      replies.setEnabled(on);
      writeStatus();
    },
    replyCounters: (day) => replies.counters(day),
    noteReply: (kind, at, day) => replies.noteReply(kind, at, day),
    resetReplyCounters: () => replies.resetCounters(),
    wasAnswered: (messageId) => replies.wasAnswered(messageId),
    noteAnswered: (messageId) => replies.noteAnswered(messageId, Date.now()),
    recentReplies: () => replies.recent(SAID_MEMORY).reverse(),
    noteSaid: (text) => replies.noteSaid(text, Date.now()),
    botOffset: () => replies.botOffset(),
    setBotOffset: (value) => replies.setBotOffset(value),

    forwarding: () => service.forwarding === true,
    setForwarding(on) {
      service.forwarding = Boolean(on);
      writeStatus();
    },
    startedAt: () => (Number.isInteger(service.startedAt) ? service.startedAt : null),
    setStartedAt(at) {
      service.startedAt = at;
      writeStatus();
    },
    probeOkAt: () => (Number.isInteger(service.probeOkAt) ? service.probeOkAt : null),
    setProbeOkAt(at) {
      if (!Number.isInteger(at)) return;
      service.probeOkAt = at;
      writeStatus();
    },

    writeStatus,
    flush() {},
    close: () => db.close(),
  };
}

module.exports = { createState, DB_PATH, STATE_PATH: LEGACY_PATH };
