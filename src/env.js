function numFromEnv(raw, fallback) {
  const text = (raw === undefined || raw === null ? '' : String(raw)).trim();
  if (text === '') return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function hourOrOff(raw) {
  const text = (raw === undefined || raw === null ? '' : String(raw)).trim().toLowerCase();
  if (text === '' || text === 'off' || text === 'нет') return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0 || value > 23) return null;
  return value;
}

function pauseMsFrom(rawSeconds, rawMinutes, fallbackMinutes) {
  const seconds = numFromEnv(rawSeconds, null);
  if (seconds !== null) return seconds * 1000;
  return numFromEnv(rawMinutes, fallbackMinutes) * 60 * 1000;
}

function listFromEnv(raw) {
  return String(raw === undefined || raw === null ? '' : raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function listOr(raw, fallback) {
  const list = listFromEnv(raw);
  return list.length ? list : fallback;
}

module.exports = { numFromEnv, hourOrOff, pauseMsFrom, listFromEnv, listOr };
