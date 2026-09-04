const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { loadConfig } = require('../src/platform/config');
const { createRepliesJob } = require('../src/features/replies/job');
const { createRepliesStore } = require('../src/features/replies/store');
const { samplesOf } = require('../src/features/replies/voice');
const { readJson } = require('../src/platform/json-file');
const { openDb } = require('../src/platform/db/open');
const { createLlm } = require('../src/platform/llm/anthropic');

const { config, errors: configErrors } = loadConfig(process.env);

const VOICE_PATH = process.env.TG_VOICE_PATH || path.join(__dirname, '..', 'voice.json');

const ME = process.env.REPLY_ME_ID || '6307473828';
const TICK_MS = 25 * 60 * 1000;

function nameFor(id, names) {
  if (id === ME) return 'Стас';
  if (!names.has(id)) names.set(id, `Друг${names.size + 1}`);
  return names.get(id);
}

function scratchStore() {
  return createRepliesStore(openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'replies-dry-')), 'state.db')));
}

async function main() {
  if (configErrors.length > 0) {
    console.error(configErrors.join('\n'));
    return 1;
  }
  const fileArg = process.argv.indexOf('--from-file');
  if (fileArg === -1) {
    console.error('Использование: npm run replies -- --from-file <выгрузка.json>');
    return 1;
  }

  const day = JSON.parse(fs.readFileSync(process.argv[fileArg + 1], 'utf8')).sort((a, b) => a.date - b.date);
  const names = new Map();
  const samples = samplesOf(readJson(VOICE_PATH, null));
  const store = scratchStore();
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

  console.log(`Прогон без отправки: ${day.length} сообщений, образцов речи ${samples.length}`);

  const chat = { key: 'файл', title: 'файл', username: null, id: 0 };
  const replier = createRepliesJob({
    gateway: {
      async resolveChat() { return chat; },
      async sendText(target, text, options = {}) {
        const post = { id: 0, chatKey: chat.key, at: clock, text, from: ME, author: 'Стас', replyTo: options.replyTo || null, groupId: null, link: '' };
        sent.push({ at: clock, message: text, replyTo: post.replyTo });
        return post;
      },
      onPost() { return () => {}; },
    },
    chat,
    store,
    llm: createLlm({ apiKey: config.anthropicKey, log: () => {} }),
    model: config.replies.model,
    samples,
    meName: 'Стас',
    notifier: { enabled: false, send: async () => true },
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
      maxChars: config.replies.maxChars,
    },
    ownerCancel: config.replies.ownerCancel,
    staleAfterMs: config.replies.staleAfterMin * 60 * 1000,
    log: note,
    clock: { now: () => clock, every: () => () => {}, after: () => () => {}, cancelAll: () => {} },
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
  console.log(`Итого: сказано ${sent.length} раз`);
  console.log('\nПочему молчал:');
  for (const [key, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Прогон упал:', err.message);
    process.exit(1);
  });
