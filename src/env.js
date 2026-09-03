function numFromEnv(raw, fallback) {
  const text = (raw === undefined || raw === null ? '' : String(raw)).trim();
  if (text === '') return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

module.exports = { numFromEnv };
