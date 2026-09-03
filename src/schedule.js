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

module.exports = { isDue, dueMomentOf, localDayOf };
