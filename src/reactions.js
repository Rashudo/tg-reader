function normalize(emoji) {
  return String(emoji || '').replace(/\uFE0F/g, '');
}

function emojiCounts(results) {
  const counts = {};
  for (const item of results || []) {
    const reaction = item && item.reaction;
    if (!reaction || reaction.className !== 'ReactionEmoji') continue;
    const emoji = String(reaction.emoticon || '');
    if (!emoji) continue;
    counts[emoji] = (counts[emoji] || 0) + (Number(item.count) || 0);
  }
  return counts;
}

function emojiVotes(reactions) {
  const counts = {};
  for (const item of reactions || []) {
    if (!item || item.type !== 'emoji') continue;
    const emoji = String(item.emoji || '');
    if (!emoji) continue;
    counts[emoji] = (counts[emoji] || 0) + 1;
  }
  return counts;
}

function tally(counts, { good = [], bad = [] } = {}) {
  const liked = new Set(good.map(normalize));
  const disliked = new Set(bad.map(normalize));
  const sum = { good: 0, bad: 0 };
  for (const [emoji, count] of Object.entries(counts || {})) {
    const key = normalize(emoji);
    if (liked.has(key)) sum.good += count;
    else if (disliked.has(key)) sum.bad += count;
  }
  return sum;
}

function sideOf(score) {
  const good = (score && score.good) || 0;
  const bad = (score && score.bad) || 0;
  if (good > bad) return 'good';
  if (bad > good) return 'bad';
  return null;
}

function chatReactionOf(update) {
  if (!update || update.className !== 'UpdateMessageReactions') return null;
  const id = Number(update.msgId);
  if (!Number.isInteger(id)) return null;
  const results = (update.reactions && update.reactions.results) || [];
  return { peer: update.peer, id, results };
}

function verdictOf(record) {
  return sideOf(record && record.note) || sideOf(record && record.chat);
}

module.exports = { emojiCounts, emojiVotes, tally, verdictOf, chatReactionOf, normalize };
