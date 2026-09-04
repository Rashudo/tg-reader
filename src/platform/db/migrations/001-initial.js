const sql = `
CREATE TABLE forward_cursor (
  chat_key TEXT PRIMARY KEY,
  last_id INTEGER,
  last_post_at INTEGER,
  checked INTEGER NOT NULL DEFAULT 0,
  forwarded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE forward_sent (
  chat_key TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (chat_key, message_id)
);

CREATE TABLE digest_cursor (
  chat_key TEXT PRIMARY KEY,
  up_to_id INTEGER,
  last_run_at INTEGER
);

CREATE TABLE reply_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1,
  day TEXT,
  addressed INTEGER NOT NULL DEFAULT 0,
  spontaneous INTEGER NOT NULL DEFAULT 0,
  last_addressed_at INTEGER NOT NULL DEFAULT 0,
  last_spontaneous_at INTEGER NOT NULL DEFAULT 0,
  bot_offset INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE reply_answered (
  message_id INTEGER PRIMARY KEY,
  answered_at INTEGER NOT NULL
);

CREATE TABLE reply_said (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  said_at INTEGER NOT NULL
);

CREATE TABLE status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  contract INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  forwarding INTEGER,
  digest_enabled INTEGER,
  replies_enabled INTEGER,
  last_post_at INTEGER,
  probe_ok_at INTEGER,
  checked_total INTEGER,
  forwarded_total INTEGER
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

module.exports = { version: 1, sql };
