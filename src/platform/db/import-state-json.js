const fs = require('fs');

const MARK = 'imported_from_json';
const SERVICE_KEY = '_service';

function importLegacyState(db, file, { log = console.error } = {}) {
  const already = db.prepare('SELECT value FROM meta WHERE key = ?').get(MARK);
  if (already) return { imported: false, chats: 0 };

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log(`Не удалось прочитать ${file} (${err.message}) — начинаем с чистой позиции`);
    return { imported: false, chats: 0 };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('не объект');
  } catch (err) {
    log(`Не удалось разобрать ${file} (${err.message}) — начинаем с чистой позиции`);
    return { imported: false, chats: 0 };
  }

  const service = parsed[SERVICE_KEY] && typeof parsed[SERVICE_KEY] === 'object' ? parsed[SERVICE_KEY] : {};
  const replies = service.replies && typeof service.replies === 'object' ? service.replies : {};
  const sharedRunAt = Number.isInteger(service.lastDigestRunAt) ? service.lastDigestRunAt : null;

  const cursor = db.prepare(
    'INSERT OR REPLACE INTO forward_cursor(chat_key, last_id, last_post_at, checked, forwarded) VALUES(?, ?, ?, ?, ?)'
  );
  const sent = db.prepare('INSERT OR IGNORE INTO forward_sent(chat_key, message_id, sent_at) VALUES(?, ?, ?)');
  const digest = db.prepare('INSERT OR REPLACE INTO digest_cursor(chat_key, up_to_id, last_run_at) VALUES(?, ?, ?)');
  const state = db.prepare(
    'INSERT OR REPLACE INTO reply_state(id, enabled, day, addressed, spontaneous, last_addressed_at, last_spontaneous_at, bot_offset) VALUES(1, ?, ?, ?, ?, ?, ?, ?)'
  );
  const answered = db.prepare('INSERT OR IGNORE INTO reply_answered(message_id, answered_at) VALUES(?, ?)');
  const said = db.prepare('INSERT INTO reply_said(text, said_at) VALUES(?, ?)');
  const mark = db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)');

  const whole = (value, fallback = null) => (Number.isInteger(value) ? value : fallback);
  const at = Date.now();
  let chats = 0;

  db.exec('BEGIN');
  try {
    for (const [key, value] of Object.entries(parsed)) {
      if (key === SERVICE_KEY) continue;
      const entry = Number.isInteger(value) ? { lastId: value } : value && typeof value === 'object' ? value : {};
      cursor.run(
        key,
        whole(entry.lastId),
        whole(entry.lastMessageAt),
        whole(entry.checked, 0),
        whole(entry.forwarded, 0)
      );
      for (const id of Array.isArray(entry.sent) ? entry.sent.filter(Number.isInteger) : []) {
        sent.run(key, id, whole(entry.lastMessageAt, at));
      }
      const runAt = Number.isInteger(entry.digestRunAt) ? entry.digestRunAt : sharedRunAt;
      if (entry.digestUpToId !== undefined || runAt !== null) {
        digest.run(key, whole(entry.digestUpToId), runAt);
      }
      chats += 1;
    }

    state.run(
      replies.enabled === false ? 0 : 1,
      typeof replies.day === 'string' ? replies.day : null,
      whole(replies.addressed, 0),
      whole(replies.spontaneous, 0),
      whole(replies.lastAddressedAt, 0),
      whole(replies.lastSpontaneousAt, 0),
      whole(replies.botOffset, 0)
    );
    for (const id of Array.isArray(replies.answered) ? replies.answered.filter(Number.isInteger) : []) {
      answered.run(id, at);
    }
    for (const text of Array.isArray(replies.said) ? replies.said : []) {
      if (typeof text === 'string' && text.trim()) said.run(text, at);
    }

    mark.run(MARK, new Date(at).toISOString());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    log(`Перенос состояния из ${file} не удался (${err.message}) — начинаем с чистой позиции`);
    return { imported: false, chats: 0 };
  }

  return { imported: true, chats };
}

module.exports = { importLegacyState, MARK };
