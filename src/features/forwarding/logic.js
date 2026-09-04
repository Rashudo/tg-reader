const { findHits, describeHits } = require('./matcher');

function decide({ posts, keywords, lastId, isSent }) {
  const text = posts.map((post) => post.text || '').filter(Boolean).join('\n');
  const newestId = Math.max(...posts.map((post) => post.id));
  const at = Math.max(...posts.map((post) => post.at || 0));
  const fresh = posts.filter((post) => lastId === null || post.id > lastId).length;
  const hits = findHits(text, keywords);

  if (hits.length === 0) return { fresh, newestId, at, what: null, ids: [], text };

  const ids = posts
    .filter((post) => !isSent(post.id))
    .map((post) => post.id)
    .sort((a, b) => a - b);
  return { fresh, newestId, at, what: describeHits(hits), ids, text };
}

module.exports = { decide };
