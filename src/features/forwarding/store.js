const FORGET_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

function createForwardingStore(db, { forgetAfterMs = FORGET_AFTER_MS } = {}) {
  const row = db.prepare('SELECT last_id, checked, forwarded FROM forward_cursor WHERE chat_key = ?');
  const ensure = db.prepare('INSERT OR IGNORE INTO forward_cursor(chat_key) VALUES(?)');
  const bump = db.prepare('UPDATE forward_cursor SET last_id = ? WHERE chat_key = ? AND (last_id IS NULL OR last_id < ?)');
  const seen = db.prepare(
    'UPDATE forward_cursor SET checked = checked + ?, last_post_at = MAX(COALESCE(last_post_at, 0), ?) WHERE chat_key = ?'
  );
  const sent = db.prepare('INSERT OR IGNORE INTO forward_sent(chat_key, message_id, sent_at) VALUES(?, ?, ?)');
  const counted = db.prepare('UPDATE forward_cursor SET forwarded = forwarded + ? WHERE chat_key = ?');
  const asked = db.prepare('SELECT 1 AS yes FROM forward_sent WHERE chat_key = ? AND message_id = ?');
  const sums = db.prepare(
    'SELECT COALESCE(SUM(checked), 0) AS checked, COALESCE(SUM(forwarded), 0) AS forwarded FROM forward_cursor'
  );
  const newest = db.prepare('SELECT MAX(last_post_at) AS at FROM forward_cursor');
  const forget = db.prepare('DELETE FROM forward_sent WHERE sent_at < ?');

  return {
    lastId(chatKey) {
      const found = row.get(chatKey);
      return found && found.last_id !== null ? found.last_id : null;
    },
    advance(chatKey, id) {
      if (!Number.isInteger(id)) return;
      ensure.run(chatKey);
      bump.run(id, chatKey, id);
    },
    wasSent(chatKey, messageId) {
      return Boolean(asked.get(chatKey, messageId));
    },
    noteSeen(chatKey, count, at) {
      ensure.run(chatKey);
      seen.run(count, Number.isInteger(at) ? at : 0, chatKey);
    },
    commitForward(chatKey, { ids, newestId, at }) {
      ensure.run(chatKey);
      db.exec('BEGIN');
      try {
        let added = 0;
        for (const id of ids) added += sent.run(chatKey, id, at).changes;
        if (added > 0) counted.run(added, chatKey);
        if (Number.isInteger(newestId)) bump.run(newestId, chatKey, newestId);
        forget.run(at - forgetAfterMs);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    totals() {
      return { ...sums.get() };
    },
    lastMessageAt() {
      const found = newest.get();
      return found && found.at ? found.at : null;
    },
  };
}

module.exports = { createForwardingStore, FORGET_AFTER_MS };
