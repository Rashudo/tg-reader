function createDigestStore(db) {
  const ensure = db.prepare('INSERT OR IGNORE INTO digest_cursor(chat_key) VALUES(?)');
  const row = db.prepare('SELECT up_to_id, last_run_at FROM digest_cursor WHERE chat_key = ?');
  const bump = db.prepare('UPDATE digest_cursor SET up_to_id = ? WHERE chat_key = ? AND (up_to_id IS NULL OR up_to_id < ?)');
  const ran = db.prepare('UPDATE digest_cursor SET last_run_at = ? WHERE chat_key = ?');

  const field = (chatKey, name) => {
    const found = row.get(chatKey);
    return found && found[name] !== null ? found[name] : null;
  };

  return {
    upTo: (chatKey) => field(chatKey, 'up_to_id'),
    lastRunAt: (chatKey) => field(chatKey, 'last_run_at'),
    setUpTo(chatKey, messageId) {
      if (!Number.isInteger(messageId)) return;
      ensure.run(chatKey);
      bump.run(messageId, chatKey, messageId);
    },
    setRunAt(chatKey, at) {
      if (!Number.isInteger(at)) return;
      ensure.run(chatKey);
      ran.run(at, chatKey);
    },
  };
}

module.exports = { createDigestStore };
