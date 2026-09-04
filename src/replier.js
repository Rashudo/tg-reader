const { isAddressed, mentionsAlias, decideAddressed, decideSpontaneous } = require('./reply-rules');
const { botTurns, isFiller } = require('./thread');
const { repeatsRecent } = require('./repetition');
const { emojiCounts, emojiVotes, tally, verdictOf } = require('./reactions');
const { localDayOf } = require('./schedule');

const GRADED_SHOWN = 5;

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
  reactions = { good: [], bad: [] },
  ownerCancel = 'answer',
  ownerAnswerMs = 60 * 1000,
  staleAfterMs = 10 * 60 * 1000,
  echoGuard = 2,
}) {
  const window = [];
  const byId = new Map();
  const own = new Set();
  const queue = [];
  let ownerSpokeAt = null;
  let freshCount = 0;

  function remember(msg) {
    if (byId.has(msg.id)) return;
    window.push(msg);
    byId.set(msg.id, msg);
    while (window.length > limits.context) {
      const gone = window.shift();
      byId.delete(gone.id);
    }
  }

  function graded() {
    const posted = state.postedReplies ? state.postedReplies() : [];
    const pick = (side) =>
      posted
        .filter((item) => item.text && verdictOf(item) === side)
        .slice(-GRADED_SHOWN)
        .map((item) => item.text);
    return { liked: pick('good'), disliked: pick('bad') };
  }

  function score(counts) {
    return tally(counts, reactions);
  }

  function delayMs() {
    const spread = Math.max(0, limits.delayMaxMs - limits.delayMinMs);
    return limits.delayMinMs + Math.round(random() * spread);
  }

  function counters() {
    return state.replyCounters(localDayOf(now(), limits.quiet.timeZone));
  }

  function turnsBefore(msg) {
    return botTurns(msg, { messageById: byId, mine: (parent) => own.has(parent.id) });
  }

  async function speak({ mode, trigger, followUp = false }) {
    const said = state.recentReplies();
    const composed = await responder.compose({
      avoid: said,
      graded: graded(),
      window: window.map((msg) => ({
        id: msg.id,
        author: msg.author,
        text: msg.text,
        mine: String(msg.from) === String(meId),
      })),
      trigger: trigger ? { id: trigger.id, author: trigger.author, text: trigger.text } : null,
      mode,
      followUp,
    });
    if (!composed.reply) {
      log(`Ответчик: модель решила промолчать (${mode})`);
      return false;
    }

    if (repeatsRecent(composed.text, said.slice(-echoGuard))) {
      log(`Ответчик: повтор недавней шутки — молчу («${composed.text}»)`);
      return false;
    }

    const posted = await client.sendMessage(chat, {
      message: composed.text,
      ...(composed.replyToId ? { replyTo: composed.replyToId } : {}),
      parseMode: false,
    });

    state.noteSaid(composed.text);

    const at = now();
    if (posted && Number.isInteger(posted.id)) {
      own.add(posted.id);
      remember({
        id: posted.id,
        from: String(meId),
        author: 'ты',
        replyTo: composed.replyToId || null,
        text: composed.text,
      });
    }

    if (trigger) state.noteAnswered(trigger.id);
    state.noteReply(mode === 'addressed' ? 'addressed' : 'spontaneous', at, localDayOf(at, limits.quiet.timeZone));
    log(`Ответчик: отправлено (${mode}) — ${composed.text}`);
    const note = await notifier.deliver(`💬 Ответил в чате: ${composed.text}`, { buttons: OFF_BUTTON });
    if (posted && Number.isInteger(posted.id) && state.notePosted) {
      state.notePosted({ id: posted.id, noteId: (note && note.id) || null, text: composed.text, at });
    }
    return true;
  }

  return {
    window: () => window,
    pending: () => queue.length,

    async onChatReaction({ id, results }) {
      const hit = state.gradeFromChat(id, score(emojiCounts(results)));
      if (hit) log(`Ответчик: оценка чата ${verdictOf(hit) || 'снята'} — «${hit.text}»`);
    },

    async onNoteReaction({ noteId, reactions: given }) {
      const hit = state.gradeFromNote(noteId, score(emojiVotes(given)));
      if (hit) log(`Ответчик: твоя оценка ${verdictOf(hit) || 'снята'} — «${hit.text}»`);
    },

    seed(messages) {
      const posted = state.postedReplies ? state.postedReplies() : [];
      for (const item of posted) if (Number.isInteger(item.id)) own.add(item.id);
      for (const msg of messages) {
        const text = (msg.text || '').trim();
        if (!text) continue;
        remember({ ...msg, text });
        if (String(msg.from) === String(meId)) state.noteSaid(text);
      }
    },

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

      const turns = turnsBefore(msg);
      if (!mentionsAlias(text, aliases)) {
        if (turns >= limits.threadLimit) {
          log(`Ответчик: в ветке ${msg.id} уже ответил дважды — молчу`);
          return;
        }
        if (turns > 0 && isFiller(text)) {
          log(`Ответчик: пустое продолжение ${msg.id} — молчу`);
          return;
        }
      }

      queue.push({ trigger: { ...msg, text }, queuedAt: now(), dueAt: now() + delayMs(), followUp: turns > 0 });
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
        if (at - item.queuedAt > staleAfterMs) {
          log(`Ответчик: вопрос ${item.trigger.id} устарел, отвечать поздно`);
          continue;
        }

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
          if (!item.blocked) log(`Ответчик: на обращение ${item.trigger.id} пока не отвечаю — ${verdict.why}`);
          queue.push({ ...item, blocked: true });
          continue;
        }
        try {
          await speak({ mode: 'addressed', trigger: item.trigger, followUp: Boolean(item.followUp) });
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
