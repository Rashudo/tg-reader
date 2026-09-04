const { openDb } = require('../../platform/db/open');

const STATUS_CONTRACT = 1;

function createStatusWriter(db) {
  const write = db.prepare(`
    INSERT INTO status(id, contract, updated_at, started_at, forwarding, digest_enabled,
                       replies_enabled, last_post_at, probe_ok_at, checked_total, forwarded_total)
    VALUES(1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      contract = excluded.contract,
      updated_at = excluded.updated_at,
      started_at = excluded.started_at,
      forwarding = excluded.forwarding,
      digest_enabled = excluded.digest_enabled,
      replies_enabled = excluded.replies_enabled,
      last_post_at = excluded.last_post_at,
      probe_ok_at = excluded.probe_ok_at,
      checked_total = excluded.checked_total,
      forwarded_total = excluded.forwarded_total
  `);

  const flag = (value) => (value === null || value === undefined ? null : value ? 1 : 0);
  const number = (value) => (Number.isInteger(value) ? value : null);

  return {
    write(snapshot, at) {
      write.run(
        STATUS_CONTRACT,
        at,
        number(snapshot.startedAt),
        flag(snapshot.forwarding),
        flag(snapshot.digestEnabled),
        flag(snapshot.repliesEnabled),
        number(snapshot.lastPostAt),
        number(snapshot.probeOkAt),
        number(snapshot.checked),
        number(snapshot.forwarded)
      );
    },
  };
}

function readStatus(file) {
  let db = null;
  try {
    db = openDb(file, { readOnly: true });
    const row = db.prepare('SELECT * FROM status WHERE id = 1').get();
    if (!row) return { ok: false, reason: 'в хранилище нет строки статуса — сервис ещё ни разу её не писал' };
    if (row.contract !== STATUS_CONTRACT) {
      return { ok: false, reason: `незнакомая версия контракта статуса: ${row.contract}` };
    }
    return {
      ok: true,
      status: {
        contract: row.contract,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        forwarding: row.forwarding === null ? null : row.forwarding === 1,
        digestEnabled: row.digest_enabled === null ? null : row.digest_enabled === 1,
        repliesEnabled: row.replies_enabled === null ? null : row.replies_enabled === 1,
        lastPostAt: row.last_post_at,
        probeOkAt: row.probe_ok_at,
        checked: row.checked_total,
        forwarded: row.forwarded_total,
      },
    };
  } catch (err) {
    return { ok: false, reason: `не удалось открыть хранилище (${err.message})` };
  } finally {
    if (db) {
      try {
        db.close();
      } catch (err) {
        db = null;
      }
    }
  }
}

function createStatusJob({ writer, snapshot, clock, everyMs = 30 * 1000, log = console.log }) {
  const timers = [];

  function write() {
    try {
      writer.write(snapshot(), clock.now());
    } catch (err) {
      log(`Состояние не записалось: ${err.message}`);
    }
  }

  return {
    name: 'status',
    write,
    async start() {
      write();
      timers.push(clock.every(everyMs, write));
    },
    async stop() {
      for (const cancel of timers) cancel();
      timers.length = 0;
    },
  };
}

module.exports = { createStatusWriter, createStatusJob, readStatus, STATUS_CONTRACT };
