const STOPWORDS = new Set([
  'а','и','но','да','нет','не','ни','же','ли','бы','то','это','вот','там','тут','так','как','что','чо',
  'я','ты','он','она','мы','вы','они','мне','тебе','его','её','их','нам','вам','им','себе','себя',
  'у','в','во','на','за','до','по','из','от','с','со','к','ко','о','об','про','для','без','над','под',
  'уже','ещё','еще','только','просто','очень','весь','всё','все','ага','ну','вообще','тоже','тебя','меня',
]);

const STEM_TAIL = /(ами|ями|ов|ев|ей|ий|ый|ая|ое|ые|ой|ом|ем|ах|ях|ую|ю|я|и|ы|а|е|у|о)$/;

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function stem(word) {
  return word.length > 4 ? word.replace(STEM_TAIL, '') : word;
}

function bigrams(text, { forms }) {
  const list = words(text).map((word) => (forms ? stem(word) : word));
  const raw = words(text);
  const out = new Set();
  for (let i = 0; i + 1 < list.length; i += 1) {
    if (STOPWORDS.has(raw[i]) || STOPWORDS.has(raw[i + 1])) continue;
    out.add(`${list[i]} ${list[i + 1]}`);
  }
  return out;
}

function repeatsRecent(text, recent, { forms = true } = {}) {
  const fresh = bigrams(text, { forms });
  if (fresh.size === 0) return false;
  for (const older of recent) {
    for (const gram of bigrams(older, { forms })) {
      if (fresh.has(gram)) return true;
    }
  }
  return false;
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/ё/g, 'е');
}

function hitsBanned(text, banned) {
  const haystack = normalize(text);
  const tokens = words(haystack);
  for (const entry of banned) {
    const needle = normalize(entry).trim();
    if (!needle) continue;
    if (needle.includes(' ')) {
      if (haystack.includes(needle)) return needle;
      continue;
    }
    if (tokens.includes(needle)) return needle;
  }
  return null;
}

module.exports = { repeatsRecent, bigrams, words, hitsBanned };
