const fs = require('fs');
const path = require('path');

const VOICE_PATH = process.env.TG_VOICE_PATH || path.join(__dirname, '..', 'voice.json');

function pickSamples(messages, { limit = 60, minWords = 3, maxChars = 200 } = {}) {
  const seen = new Set();
  const picked = [];
  for (const message of messages) {
    const text = (message.text || '').trim();
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

function loadVoice(file = VOICE_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const samples = Array.isArray(parsed && parsed.samples)
      ? parsed.samples.filter((item) => typeof item === 'string' && item.trim())
      : [];
    return { samples };
  } catch (err) {
    return { samples: [] };
  }
}

module.exports = { loadVoice, pickSamples, VOICE_PATH };
