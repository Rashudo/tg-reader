const FORGET_AFTER_MS = 90 * 24 * 60 * 60 * 1000;
const SAID_MEMORY = 8;

const EMPTY_COUNTERS = { addressed: 0, spontaneous: 0, lastAddressedAt: 0, lastSpontaneousAt: 0 };

function createRepliesStore(db, { forgetAfterMs = FORGET_AFTER_MS, saidMemory = SAID_MEMORY } = {}) {
  db.prepare('INSERT OR IGNORE INTO reply_state(id) VALUES(1)').run();

  const readState = db.prepare('SELECT * FROM reply_state WHERE id = 1');
  const setEnabled = db.prepare('UPDATE reply_state SET enabled = ? WHERE id = 1');
  const resetDay = db.prepare(
    'UPDATE reply_state SET day = ?, addressed = 0, spontaneous = 0, last_addressed_at = 0, last_spontaneous_at = 0 WHERE id = 1'
  );
  const noteAddressed = db.prepare(
    'UPDATE reply_state SET addressed = addressed + 1, last_addressed_at = ? WHERE id = 1'
  );
  const noteSpontaneous = db.prepare(
    'UPDATE reply_state SET spontaneous = spontaneous + 1, last_spontaneous_at = ? WHERE id = 1'
  );
  const setOffset = db.prepare('UPDATE reply_state SET bot_offset = ? WHERE id = 1');

  const askAnswered = db.prepare('SELECT 1 AS yes FROM reply_answered WHERE message_id = ?');
  const addAnswered = db.prepare('INSERT OR IGNORE INTO reply_answered(message_id, answered_at) VALUES(?, ?)');
  const forgetAnswered = db.prepare('DELETE FROM reply_answered WHERE answered_at < ?');

  const addSaid = db.prepare('INSERT INTO reply_said(text, said_at) VALUES(?, ?)');
  const trimSaid = db.prepare('DELETE FROM reply_said WHERE id NOT IN (SELECT id FROM reply_said ORDER BY id DESC LIMIT ?)');
  const lastSaid = db.prepare('SELECT text FROM reply_said ORDER BY id DESC LIMIT ?');

  return {
    enabled() {
      return readState.get().enabled !== 0;
    },
    setEnabled(on) {
      setEnabled.run(on ? 1 : 0);
    },
    counters(day) {
      const state = readState.get();
      if (state.day !== day) return { ...EMPTY_COUNTERS };
      return {
        addressed: state.addressed,
        spontaneous: state.spontaneous,
        lastAddressedAt: state.last_addressed_at,
        lastSpontaneousAt: state.last_spontaneous_at,
      };
    },
    noteReply(kind, at, day) {
      const state = readState.get();
      if (state.day !== day) resetDay.run(day);
      if (kind === 'addressed') noteAddressed.run(at);
      else noteSpontaneous.run(at);
    },
    resetCounters() {
      resetDay.run(readState.get().day);
    },
    wasAnswered(messageId) {
      return Boolean(askAnswered.get(messageId));
    },
    noteAnswered(messageId, at) {
      if (!Number.isInteger(messageId)) return;
      addAnswered.run(messageId, at);
      forgetAnswered.run(at - forgetAfterMs);
    },
    recent(limit = saidMemory) {
      return lastSaid.all(limit).map((row) => row.text);
    },
    noteSaid(text, at) {
      if (typeof text !== 'string' || !text.trim()) return;
      addSaid.run(text, at);
      trimSaid.run(saidMemory);
    },
    botOffset() {
      return readState.get().bot_offset;
    },
    setBotOffset(value) {
      if (!Number.isInteger(value)) return;
      setOffset.run(value);
    },
  };
}

module.exports = { createRepliesStore, SAID_MEMORY, FORGET_AFTER_MS };
