const FIELDS = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };

function zonedParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', ...FIELDS })
    .formatToParts(timestamp)
    .filter((part) => part.type !== 'literal');
  const values = {};
  for (const part of parts) values[part.type] = Number(part.value);
  return values;
}

function dueMomentOf(timestamp, hour, timeZone) {
  let local;
  try {
    local = zonedParts(timestamp, timeZone);
  } catch (err) {
    local = zonedParts(timestamp, 'UTC');
  }
  const asIfUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const offset = asIfUtc - timestamp;
  return Date.UTC(local.year, local.month - 1, local.day, hour) - offset;
}

function localDayOf(timestamp, timeZone) {
  let local;
  try {
    local = zonedParts(timestamp, timeZone);
  } catch (err) {
    local = zonedParts(timestamp, 'UTC');
  }
  return `${local.year}-${local.month}-${local.day}`;
}

function isDue(now, { hour, timeZone, lastRunAt }) {
  if (now < dueMomentOf(now, hour, timeZone)) return false;
  if (!Number.isInteger(lastRunAt)) return true;
  return localDayOf(lastRunAt, timeZone) !== localDayOf(now, timeZone);
}

function createClock() {
  const live = new Set();
  const drop = (handle) => { live.delete(handle); };
  return {
    now: () => Date.now(),
    after(ms, fn) {
      const handle = setTimeout(() => { drop(handle); fn(); }, ms);
      if (handle.unref) handle.unref();
      live.add(handle);
      return () => { clearTimeout(handle); drop(handle); };
    },
    every(ms, fn) {
      const handle = setInterval(fn, ms);
      if (handle.unref) handle.unref();
      live.add(handle);
      return () => { clearInterval(handle); drop(handle); };
    },
    cancelAll() {
      for (const handle of live) { clearTimeout(handle); clearInterval(handle); }
      live.clear();
    },
  };
}

function createManualClock(startAt = 0) {
  let current = startAt;
  let seq = 0;
  const jobs = new Map();
  return {
    now: () => current,
    after(ms, fn) {
      const id = (seq += 1);
      jobs.set(id, { at: current + ms, every: null, fn });
      return () => jobs.delete(id);
    },
    every(ms, fn) {
      const id = (seq += 1);
      jobs.set(id, { at: current + ms, every: ms, fn });
      return () => jobs.delete(id);
    },
    cancelAll() { jobs.clear(); },
    pending: () => jobs.size,
    advance(ms) {
      const until = current + ms;
      for (;;) {
        let next = null;
        for (const [id, job] of jobs) {
          if (job.at <= until && (next === null || job.at < jobs.get(next).at)) next = id;
        }
        if (next === null) break;
        const job = jobs.get(next);
        current = job.at;
        if (job.every === null) jobs.delete(next);
        else job.at = current + job.every;
        job.fn();
      }
      current = until;
    },
  };
}

module.exports = { createClock, createManualClock, isDue, dueMomentOf, localDayOf };
