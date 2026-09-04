function pickSamples(messages, { limit = 60, minWords = 3, maxChars = 200 } = {}) {
  const seen = new Set();
  const picked = [];
  for (const message of messages) {
    const text = (message.text || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > maxChars) continue;
    if (/https?:\/\//i.test(text)) continue;
    if (text.split(/\s+/).length < minWords) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(text);
    if (picked.length >= limit) break;
  }
  return picked;
}

function samplesOf(parsed) {
  return Array.isArray(parsed && parsed.samples)
    ? parsed.samples.filter((item) => typeof item === 'string' && item.trim())
    : [];
}

module.exports = { pickSamples, samplesOf };
