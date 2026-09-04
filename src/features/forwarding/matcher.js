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

function isGrouped(keywords) {
  return keywords.some((entry) => entry && typeof entry === 'object' && typeof entry.group === 'string');
}

function sameName(a, b) {
  return normalize(a).trim() === normalize(b).trim();
}

function groupNames(keywords) {
  if (!isGrouped(keywords)) return [];
  return keywords.filter((entry) => entry && typeof entry.group === 'string').map((entry) => entry.group);
}

function prepareWord(entry, group) {
  if (typeof entry === 'string') {
    const needle = normalize(entry);
    return needle ? { raw: entry, group, test: (text) => text.includes(needle) } : null;
  }
  if (entry && typeof entry.word === 'string' && entry.word.trim()) {
    const re = wholeWordRegExp(normalize(entry.word.trim()));
    return { raw: entry.word, group, test: (text) => re.test(text) };
  }
  console.warn('keywords.js: пропущен непонятный элемент', entry);
  return null;
}

function prepare(keywords, disabledGroups = []) {
  if (!isGrouped(keywords)) {
    return keywords.map((entry) => prepareWord(entry, null)).filter(Boolean);
  }

  const prepared = [];
  for (const entry of keywords) {
    if (!entry || typeof entry.group !== 'string') {
      console.warn('keywords.js: пропущена группа без имени', entry);
      continue;
    }
    if (disabledGroups.some((name) => sameName(name, entry.group))) continue;
    for (const word of entry.words || []) {
      const ready = prepareWord(word, entry.group);
      if (ready) prepared.push(ready);
    }
  }
  return prepared;
}

function findHits(text, prepared) {
  const haystack = normalize(text);
  if (!haystack) return [];
  return prepared.filter((k) => k.test(haystack));
}

function findMatches(text, prepared) {
  return findHits(text, prepared).map((k) => k.raw);
}

function describeHits(hits) {
  const byGroup = new Map();
  for (const hit of hits) {
    const key = hit.group || '';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(hit.raw);
  }
  return [...byGroup]
    .map(([group, words]) => (group ? `${group}: ${words.join(', ')}` : words.join(', ')))
    .join('; ');
}

function summary(keywords, prepared) {
  const all = groupNames(keywords);
  if (all.length === 0) return `Ключевых слов: ${prepared.length}`;
  const working = new Set(prepared.map((k) => k.group));
  const off = all.filter((name) => !working.has(name));
  return `Ключевых слов: ${prepared.length} в ${all.length - off.length} из ${all.length} групп, выключено: ${
    off.length ? off.join(', ') : 'нет'
  }`;
}

function unknownGroups(disabledGroups, keywords) {
  const known = groupNames(keywords);
  return disabledGroups.filter((name) => !known.some((real) => sameName(real, name)));
}

module.exports = {
  normalize,
  prepare,
  findMatches,
  findHits,
  describeHits,
  groupNames,
  unknownGroups,
  summary,
};
