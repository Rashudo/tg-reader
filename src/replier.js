const { isAddressed, decideAddressed, decideSpontaneous } = require('./reply-rules');
const { localDayOf } = require('./schedule');

const OFF_BUTTON = [[{ text: 'Больше не отвечать', data: 'replies:off' }]];

function createReplier({
  client,
  chat,
  state,
  responder,
  notifier,
  meId,
  aliases = [],
  limits,
  log = console.log,
  now = Date.now,
  random = Math.random,
  ownerCancel = 'answer',
  ownerAnswerMs = 60 * 1000,
}) {
  const window = [];
  const byId = new Map();
  const queue = [];
  let ownerSpokeAt = null;
  let freshCount = 0;

  function remember(msg) {
    window.push(msg);
    byId.set(msg.id, msg);
    while (window.length > limits.context) {
      const gone = window.shift();
      byId.delete(gone.id);
    }
  }

  function delayMs() {
    const spread = Math.max(0, limits.delayMaxMs - limits.delayMinMs);
    return limits.delayMinMs + Math.round(random() * spread);
  }

  function counters() {
    return state.replyCounters(localDayOf(now(), limits.quiet.timeZone));
  }

  async function speak({ mode, trigger }) {
    const composed = await responder.compose({
      window: window.map((msg) => ({ id: msg.id, author: msg.author, text: msg.text })),
      trigger: trigger ? { id: trigger.id, author: trigger.author, text: trigger.text } : null,
      mode,
    });
    if (!composed.reply) {
      log(`Ответчик: модель решила промолчать (${mode})`);
      return false;
    }

    await client.sendMessage(chat, {
      message: composed.text,
      ...(composed.replyToId ? { replyTo: composed.replyToId } : {}),
      parseMode: false,
    });

    const at = now();
    if (trigger) state.noteAnswered(trigger.id);
    state.noteReply(mode === 'addressed' ? 'addressed' : 'spontaneous', at, localDayOf(at, limits.quiet.timeZone));
    log(`Ответчик: отправлено (${mode}) — ${composed.text}`);
    await notifier.send(`💬 Ответил в чате: ${composed.text}`, { buttons: OFF_BUTTON });
    return true;
  }

  return {
    window: () => window,
    pending: () => queue.length,

    async onMessage(msg) {
      const text = (msg.text || '').trim();
      if (!text) return;

      remember({ ...msg, text });
      if (String(msg.from) === String(meId)) {
        const at = now();
        ownerSpokeAt = at;
        for (let i = queue.length - 1; i >= 0; i -= 1) {
          const item = queue[i];
          const answersIt =
            ownerCancel === 'any' ||
            msg.replyTo === item.trigger.id ||
            at - item.queuedAt <= ownerAnswerMs;
          if (!answersIt) continue;
          log(`Ответчик: хозяин ответил сам — снимаю ${item.trigger.id} с очереди`);
          queue.splice(i, 1);
        }
        return;
      }

      freshCount += 1;
      if (!isAddressed(msg, { meId, aliases, messageById: byId })) return;
      if (state.wasAnswered(msg.id)) return;
      if (queue.some((item) => item.trigger.id === msg.id)) return;

      queue.push({ trigger: { ...msg, text }, queuedAt: now(), dueAt: now() + delayMs() });
      log(`Ответчик: обращение ${msg.id} в очереди`);
    },

    async flush() {
      const at = now();
      const due = queue.filter((item) => item.dueAt <= at);
      if (due.length === 0) return;
      const waiting = queue.filter((item) => item.dueAt > at);
      queue.length = 0;
      queue.push(...waiting);

      for (const item of due) {
        const seen = counters();
        const verdict = decideAddressed({
          now: at,
          enabled: state.repliesEnabled(),
          quiet: limits.quiet,
          used: seen.addressed,
          budget: limits.addressedBudget,
          lastAt: seen.lastAddressedAt,
          pauseMs: limits.addressedPauseMs,
        });
        if (!verdict.allow) {
          log(`Ответчик: на обращение ${item.trigger.id} не отвечаю — ${verdict.why}`);
          continue;
        }
        try {
          await speak({ mode: 'addressed', trigger: item.trigger });
        } catch (err) {
          log(`Ответчик: ответ не сложился (${err.message}) — молчу`);
        }
      }
    },

    async tick() {
      const at = now();
      const seen = counters();
      const verdict = decideSpontaneous({
        now: at,
        enabled: state.repliesEnabled(),
        quiet: limits.quiet,
        used: seen.spontaneous,
        budget: limits.dailyBudget,
        lastAt: seen.lastSpontaneousAt,
        pauseMs: limits.spontaneousPauseMs,
        ownerSpokeAt,
        ownerSilenceMs: limits.ownerSilenceMs,
        freshCount,
        minFresh: limits.minFresh,
      });
      freshCount = 0;
      if (!verdict.allow) {
        log(`Ответчик: своей репликой не встреваю — ${verdict.why}`);
        return;
      }
      try {
        await speak({ mode: 'spontaneous', trigger: null });
      } catch (err) {
        log(`Ответчик: реплика не сложилась (${err.message}) — молчу`);
      }
    },
  };
}

module.exports = { createReplier, OFF_BUTTON };
