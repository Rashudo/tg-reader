const { isDue } = require('../../platform/clock');

const DAY_MS = 24 * 60 * 60 * 1000;

function toItems(posts, { since, maxMessages, includeLinks }) {
  return posts
    .filter((post) => (post.text || '').trim())
    .filter((post) => (since === null ? true : post.at >= since))
    .sort((a, b) => a.id - b.id)
    .slice(-maxMessages)
    .map((post) => ({
      id: post.id,
      text: post.text,
      ...(includeLinks ? { link: post.link || undefined } : {}),
    }));
}

function windowStart(upTo, now) {
  return upTo === null ? now - DAY_MS : null;
}

function due({ chats, lastRunAt, now, hour, timeZone }) {
  return chats.some((chat) => isDue(now, { hour, timeZone, lastRunAt: lastRunAt(chat.key) }));
}

module.exports = { toItems, windowStart, due, DAY_MS };
