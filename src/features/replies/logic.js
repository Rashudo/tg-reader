function rememberInto(window, byId, msg, limit) {
  if (byId.has(msg.id)) return;
  window.push(msg);
  byId.set(msg.id, msg);
  while (window.length > limit) {
    const gone = window.shift();
    byId.delete(gone.id);
  }
}

function supersededByOwner(queue, msg, { at, ownerCancel, ownerAnswerMs }) {
  return queue
    .filter(
      (item) =>
        ownerCancel === 'any' || msg.replyTo === item.trigger.id || at - item.queuedAt <= ownerAnswerMs
    )
    .map((item) => item.trigger.id);
}

function splitDue(queue, at) {
  return {
    due: queue.filter((item) => item.dueAt <= at),
    waiting: queue.filter((item) => item.dueAt > at),
  };
}

function isStale(item, at, staleAfterMs) {
  return at - item.queuedAt > staleAfterMs;
}

function windowFor(window, meId) {
  return window.map((msg) => ({
    id: msg.id,
    author: msg.author,
    text: msg.text,
    mine: String(msg.from) === String(meId),
  }));
}

function delayFor({ delayMinMs, delayMaxMs }, random) {
  const spread = Math.max(0, delayMaxMs - delayMinMs);
  return delayMinMs + Math.round(random() * spread);
}

module.exports = { rememberInto, supersededByOwner, splitDue, isStale, windowFor, delayFor };
