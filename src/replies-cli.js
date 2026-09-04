const fs = require('fs');
const { config } = require('./config');
const { createReplier } = require('./replier');
const { createResponder } = require('./responder');
const { loadVoice } = require('./voice');
const { createAnthropicCall } = require('./news');

const ME = process.env.REPLY_ME_ID || '6307473828';
const TICK_MS = 25 * 60 * 1000;

function nameFor(id, names) {
  if (id === ME) return 'Стас';
  if (!names.has(id)) names.set(id, `Друг${names.size + 1}`);
  return names.get(id);
}

function memoryState() {
  const answered = new Set();
  const counters = { addressed: 0, spontaneous: 0, lastAddressedAt: 0, lastSpontaneousAt: 0 };
  return {
    repliesEnabled: () => true,
    replyCounters: () => ({ ...counters }),
    noteReply: (kind, at) => {
      counters[kind] += 1;
      counters[kind === 'addressed' ? 'lastAddressedAt' : 'lastSpontaneousAt'] = at;
    },
    wasAnswered: (id) => answered.has(id),
    noteAnswered: (id) => answered.add(id),
    totals: () => counters,
  };
}

(async () => {
  const fileArg = process.argv.indexOf('--from-file');
  if (fileArg === -1) {
    console.error('Использование: npm run replies -- --from-file <выгрузка.json>');
    process.exit(1);
  }

  const day = JSON.parse(fs.readFileSync(process.argv[fileArg + 1], 'utf8')).sort((a, b) => a.date - b.date);
  const names = new Map();
  const voice = loadVoice();
  const state = memoryState();
  const sent = [];
  const reasons = new Map();
  const note = (line) => {
    const key = /промолчать/.test(line)
      ? 'модель решила промолчать'
      : /не встреваю — (.+)/.test(line)
        ? `своей волей: ${line.replace(/.*не встреваю — /, '')}`
        : /снимаю .* с очереди/.test(line)
          ? 'снято: хозяин заговорил сам'
          : /не отвечаю — (.+)/.test(line)
            ? `обращение: ${line.replace(/.*не отвечаю — /, '')}`
            : /в очереди/.test(line)
              ? 'обращений замечено'
              : null;
    if (key) reasons.set(key, (reasons.get(key) || 0) + 1);
  };
  let clock = day[0].date * 1000;

  console.log(`Прогон без отправки: ${day.length} сообщений, образцов речи ${voice.samples.length}`);

  const replier = createReplier({
    client: {
      sendMessage: async (chat, options) => {
        sent.push({ at: clock, ...options });
        return { id: 0 };
      },
    },
    chat: 'файл',
    state,
    responder: createResponder({
      model: config.replies.model,
      createMessage: createAnthropicCall(config.anthropicKey),
      samples: voice.samples,
      maxChars: config.replies.maxChars,
      name: 'Стас',
      log: () => {},
    }),
    notifier: { send: async () => true },
    meId: ME,
    aliases: config.replies.aliases.length ? config.replies.aliases : ['стас', 'станислав'],
    limits: {
      dailyBudget: config.replies.dailyBudget,
      addressedBudget: config.replies.addressedBudget,
      spontaneousPauseMs: config.replies.spontaneousPauseMs,
      addressedPauseMs: config.replies.addressedPauseMs,
      delayMinMs: config.replies.delayMinSec * 1000,
      delayMaxMs: config.replies.delayMaxSec * 1000,
      quiet: { from: config.replies.quietFrom, to: config.replies.quietTo, timeZone: config.replies.timeZone },
      context: config.replies.context,
      minFresh: config.replies.minFresh,
      ownerSilenceMs: config.replies.ownerSilenceMin * 60 * 1000,
    },
    ownerCancel: config.replies.ownerCancel,
    log: note,
    now: () => clock,
    random: () => 0.5,
  });

  const byId = new Map(day.map((msg) => [msg.id, msg]));
  let nextTick = clock + TICK_MS;

  for (const msg of day) {
    clock = msg.date * 1000;
    await replier.onMessage({
      id: msg.id,
      from: msg.from,
      author: nameFor(msg.from, names),
      replyTo: msg.replyTo,
      text: msg.text,
    });
    await replier.flush();
    if (clock >= nextTick) {
      await replier.tick();
      nextTick = clock + TICK_MS;
    }
  }
  clock += 10 * 60 * 1000;
  await replier.flush();

  const when = (at) =>
    new Intl.DateTimeFormat('ru-RU', { timeZone: config.replies.timeZone, hour: '2-digit', minute: '2-digit' }).format(at);

  console.log(`\nБот сказал бы ${sent.length} раз:\n`);
  for (const item of sent) {
    const target = item.replyTo ? byId.get(item.replyTo) : null;
    if (target) {
      console.log(`${when(item.at)}  ${nameFor(target.from, names)}: ${target.text.slice(0, 120)}`);
      console.log(`          → ${item.message}\n`);
    } else {
      console.log(`${when(item.at)}  (без привязки) → ${item.message}\n`);
    }
  }
  console.log(`Итого: на обращения ${state.totals().addressed}, своих реплик ${state.totals().spontaneous}`);
  console.log('\nПочему молчал:');
  for (const [key, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`);
  }
})().catch((err) => {
  console.error('Прогон упал:', err.message);
  process.exit(1);
});
