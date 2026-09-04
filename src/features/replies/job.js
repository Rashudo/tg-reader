const { isAddressed, decideAddressed, decideSpontaneous } = require('./rules');
const { repeatsRecent } = require('./repetition');
const { rememberInto, supersededByOwner, splitDue, isStale, windowFor, delayFor } = require('./logic');
const { createResponder } = require('./prompt');
const { pollCommands, OFF_DATA } = require('./commands');
const { localDayOf } = require('../../platform/clock');

const OFF_BUTTON = [[{ text: 'Больше не отвечать', data: OFF_DATA }]];

function createRepliesJob({
  gateway,
  chat,
  store,
  llm,
  notifier,
  meId,
  meName = 'я',
  model,
  samples = [],
  aliases = [],
  limits,
  clock,
  compose: composeOverride = null,
  log = console.log,
  random = Math.random,
  ownerCancel = 'answer',
  ownerAnswerMs = 60 * 1000,
  staleAfterMs = 10 * 60 * 1000,
  echoGuard = 2,
  flushEveryMs = 30 * 1000,
  tickEveryMs = 25 * 60 * 1000,
  pollEveryMs = 30 * 1000,
}) {
  const window = [];
  const byId = new Map();
  const queue = [];
  const timers = [];
  let unsubscribe = null;
  let ownerSpokeAt = null;
  let freshCount = 0;

  const now = () => clock.now();
  const counters = () => store.counters(localDayOf(now(), limits.quiet.timeZone));

  const responder = createResponder({ llm, model, samples, maxChars: limits.maxChars, name: meName, log });
  const compose = composeOverride || responder.compose;

  async function speak({ mode, trigger }) {
    const composed = await compose({
      mode,
      trigger: trigger ? { id: trigger.id, author: trigger.author, text: trigger.text } : null,
      window: windowFor(window, meId),
      avoid: store.recent(echoGuard),
    });
    if (!composed.reply) {
      log(`Ответчик: модель решила промолчать (${mode})`);
      return false;
    }

    if (repeatsRecent(composed.text, store.recent(echoGuard))) {
      log(`Ответчик: повтор недавней шутки — молчу («${composed.text}»)`);
      return false;
    }

    const posted = await gateway.sendText(chat, composed.text, { replyTo: composed.replyToId || undefined });

    const at = now();
    store.noteSaid(composed.text, at);

    if (posted && Number.isInteger(posted.id)) {
      rememberInto(window, byId, {
        id: posted.id,
        from: String(meId),
        author: 'ты',
        replyTo: composed.replyToId || null,
        text: composed.text,
      }, limits.context);
    }

    if (trigger) store.noteAnswered(trigger.id, at);
    store.noteReply(mode === 'addressed' ? 'addressed' : 'spontaneous', at, localDayOf(at, limits.quiet.timeZone));
    log(`Ответчик: отправлено (${mode}) — ${composed.text}`);
    await notifier.send(`💬 Ответил в чате: ${composed.text}`, { buttons: OFF_BUTTON });
    return true;
  }

  function seed(messages) {
    for (const msg of messages) {
      const text = (msg.text || '').trim();
      if (!text) continue;
      rememberInto(window, byId, { ...msg, text }, limits.context);
      if (String(msg.from) === String(meId)) store.noteSaid(text, now());
    }
  }

  async function onMessage(msg) {
    const text = (msg.text || '').trim();
    if (!text) return;

    rememberInto(window, byId, { ...msg, text }, limits.context);

    if (String(msg.from) === String(meId)) {
      const at = now();
      ownerSpokeAt = at;
      for (const id of supersededByOwner(queue, msg, { at, ownerCancel, ownerAnswerMs })) {
        const index = queue.findIndex((item) => item.trigger.id === id);
        if (index < 0) continue;
        log(`Ответчик: хозяин ответил сам — снимаю ${id} с очереди`);
        queue.splice(index, 1);
      }
      return;
    }

    freshCount += 1;
    if (!isAddressed(msg, { meId, aliases, messageById: byId })) return;
    if (store.wasAnswered(msg.id)) return;
    if (queue.some((item) => item.trigger.id === msg.id)) return;

    queue.push({ trigger: { ...msg, text }, queuedAt: now(), dueAt: now() + delayFor(limits, random) });
    log(`Ответчик: обращение ${msg.id} в очереди`);
  }

  async function flush() {
    const at = now();
    const { due, waiting } = splitDue(queue, at);
    if (due.length === 0) return;
    queue.length = 0;
    queue.push(...waiting);

    for (const item of due) {
      if (isStale(item, at, staleAfterMs)) {
        log(`Ответчик: вопрос ${item.trigger.id} устарел, отвечать поздно`);
        continue;
      }

      const seen = counters();
      const verdict = decideAddressed({
        now: at,
        enabled: store.enabled(),
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
        await speak({ mode: 'addressed', trigger: item.trigger });
      } catch (err) {
        log(`Ответчик: ответ не сложился (${err.message}) — молчу`);
      }
    }
  }

  async function tick() {
    const at = now();
    const seen = counters();
    const verdict = decideSpontaneous({
      now: at,
      enabled: store.enabled(),
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
  }

  async function poll() {
    await pollCommands({ notifier, store, now, timeZone: limits.quiet.timeZone, log });
  }

  return {
    name: 'replies',
    window: () => window,
    pending: () => queue.length,
    seed,
    onMessage,
    flush,
    tick,
    poll,

    async start() {
      unsubscribe = gateway.onPost((posts) => {
        for (const post of posts) {
          if (post.chatKey !== chat.key) continue;
          onMessage(post).catch((err) => log(`Ответчик споткнулся на сообщении: ${err.message}`));
        }
      });
      timers.push(clock.every(flushEveryMs, () => flush().catch((err) => log(`Ответчик: очередь не разобралась (${err.message})`))));
      timers.push(clock.every(tickEveryMs, () => tick().catch((err) => log(`Ответчик: проверка не удалась (${err.message})`))));
      timers.push(clock.every(pollEveryMs, () => poll().catch((err) => log(`Бот: опрос споткнулся (${err.message})`))));
    },

    async stop() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      for (const cancel of timers) cancel();
      timers.length = 0;
      queue.length = 0;
    },
  };
}

module.exports = { createRepliesJob, OFF_BUTTON };
