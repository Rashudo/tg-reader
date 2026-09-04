const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { loadConfig } = require('../src/platform/config');
const { openTelegram } = require('../src/runtime/boot');
const { pickSamples } = require('../src/features/replies/voice');

const LIMIT = 80;
const SCAN = 1000;
const VOICE_PATH = process.env.TG_VOICE_PATH || path.join(__dirname, '..', 'voice.json');

function fromFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : raw.messages || [];
}

function log(...args) {
  console.log(...args);
}

async function main() {
  const { config, errors } = loadConfig(process.env);
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    return 1;
  }

  const fileArg = process.argv.indexOf('--from-file');
  let messages;

  if (fileArg !== -1) {
    messages = fromFile(process.argv[fileArg + 1]);
  } else {
    if (!config.replies.chat) {
      console.error('REPLY_CHAT не задан');
      return 1;
    }
    const telegram = await openTelegram({ config, log });
    try {
      const chat = await telegram.gateway.resolveChat(config.replies.chat);
      const posts = await telegram.gateway.recent(chat, { limit: SCAN, fromMe: true });
      messages = posts.map((post) => ({ text: post.text }));
    } finally {
      await telegram.close();
    }
  }

  const samples = pickSamples(messages, { limit: LIMIT, minWords: 3, maxChars: 200 });
  fs.writeFileSync(VOICE_PATH, JSON.stringify({ samples }, null, 2));
  console.log(`Образцов речи: ${samples.length} из ${messages.length} сообщений → ${VOICE_PATH}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Не удалось собрать образцы:', err.message);
    process.exit(1);
  });
