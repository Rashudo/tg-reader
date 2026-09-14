const { prepare, groupNames, sameName } = require('./matcher');

function normalizeRef(ref) {
  return String(ref || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^t\.me\//, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '');
}

function parseChannelOnly(raw) {
  const only = new Map();
  for (const entry of String(raw || '').split(';')) {
    const at = entry.indexOf('=');
    if (at === -1) continue;
    const ref = normalizeRef(entry.slice(0, at));
    const groups = entry
      .slice(at + 1)
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    if (!ref || groups.length === 0) continue;
    only.set(ref, groups);
  }
  return only;
}

function keywordsForRef(ref, { keywords, disabled = [], only }) {
  const prepared = prepare(keywords, disabled);
  const allowed = only.get(normalizeRef(ref));
  if (!allowed) return prepared;
  return prepared.filter((word) => allowed.some((name) => sameName(name, word.group)));
}

function unknownOnlyGroups(only, keywords) {
  const known = groupNames(keywords);
  const unknown = [];
  for (const groups of only.values()) {
    for (const name of groups) {
      if (!known.some((real) => sameName(real, name)) && !unknown.includes(name)) unknown.push(name);
    }
  }
  return unknown;
}

function strayOnlyRefs(only, channels) {
  const listed = new Set(channels.map(normalizeRef));
  return [...only.keys()].filter((ref) => !listed.has(ref));
}

module.exports = { parseChannelOnly, normalizeRef, keywordsForRef, unknownOnlyGroups, strayOnlyRefs };
