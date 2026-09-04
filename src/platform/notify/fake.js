function createFakeNotifier({ chatId = '42', queued = [] } = {}) {
  const sent = [];
  const confirmed = [];
  let at = 0;

  return {
    enabled: true,
    chatId,
    sent,
    confirmed,
    async send(text, options = {}) {
      sent.push({ text, ...options });
      return true;
    },
    async updates(offset) {
      const batch = queued[at] || [];
      at += 1;
      const nextOffset = batch.length ? batch[batch.length - 1].update_id + 1 : offset;
      return { updates: batch, nextOffset };
    },
    async confirmButton(id, text) {
      confirmed.push({ id, text });
      return true;
    },
  };
}

module.exports = { createFakeNotifier };
