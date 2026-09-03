const LETTER = '[\\p{L}\\p{N}]';

function normalize(text) {
  return String(text || '').toLowerCase().replace(/ё/g, 'е');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wholeWordRegExp(word) {
  return new RegExp(`(?<!${LETTER})${escapeRegExp(word)}(?!${LETTER})`, 'u');
}

function prepare(keywords) {
  return keywords
    .map((entry) => {
      if (typeof entry === 'string') {
        const needle = normalize(entry);
        return needle ? { raw: entry, test: (text) => text.includes(needle) } : null;
      }
      if (entry && typeof entry.word === 'string' && entry.word.trim()) {
        const re = wholeWordRegExp(normalize(entry.word.trim()));
        return { raw: entry.word, test: (text) => re.test(text) };
      }
      console.warn('keywords.js: пропущен непонятный элемент', entry);
      return null;
    })
    .filter(Boolean);
}

function findMatches(text, prepared) {
  const haystack = normalize(text);
  if (!haystack) return [];
  return prepared.filter((k) => k.test(haystack)).map((k) => k.raw);
}

module.exports = { normalize, prepare, findMatches };
